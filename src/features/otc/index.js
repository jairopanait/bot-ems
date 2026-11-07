const { randomUUID } = require("node:crypto");
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const { createJsonStore } = require("../../storage");
const { createOtcClient, OtcError, OtcAuthError, COMPANY_NAME } = require("./client");

const { createCredentialStore } = require("./credentials");

const PANEL_CHANNEL_ID = "1568448649833480360";
const BUTTON_ACTIONS = { "otc:in": "in", "otc:out": "out", "otc:subtract": "subtract" };
const MODAL_PREFIX = "otc:password:";
const CONFIRM_OUT_PREFIX = "otc:confirm-out:";
const SUBTRACT_MODAL_PREFIX = "otc:subtract:";
const HOURS_DEDUCTION_CHANNEL_ID = "1129103832346017842";
const ACTIVITY_CHECK_PREFIX = "otc:active:";
const ACTIVITY_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVITY_GRACE_MS = 5 * 60 * 1000;

function formatTime(date, timeZone) {
  return new Intl.DateTimeFormat("es-ES", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function timeFromOtc(value) {
  const match = String(value ?? "").match(/(?:T|\s)(\d{1,2}:\d{2})/);
  return match ? match[1].padStart(5, "0") : "No disponible";
}

function formatDuration(startedAt, finishedAt) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "No disponible";
  const minutes = Math.max(0, Math.floor((finishedAt.getTime() - start) / 60000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function exitReceipt(result) {
  const exitTime = formatTime(result.confirmedAt, result.timeZone || "Europe/Madrid");
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🔴 Salida de Servicio")
    .addFields(
      { name: "👤 Empleado", value: String(result.employeeName || "No disponible"), inline: true },
      { name: "🟢 Entrada", value: timeFromOtc(result.startedAt), inline: true },
      { name: "🔴 Salida", value: exitTime, inline: true },
      { name: "⏱️ Duración", value: formatDuration(result.startedAt, result.confirmedAt), inline: false }
    )
    .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊" })
    .setTimestamp(result.confirmedAt);
}

function register(client, config, { otc = createOtcClient(), now = Date.now, credentials = createCredentialStore(config.dataDir, config.guildId) } = {}) {
  const store = createJsonStore(config.dataDir, "otc-panel.json", { panelMessageId: null });
  const activityStore = createJsonStore(config.dataDir, "otc-activity-checks.json", { active: {} });
  const sessions = new Map();
  const inFlight = new Set();
  const lastAttempt = new Map();
  const activityTimers = new Map();
  const activitySessions = new Map();

  function activityData() {
    const data = activityStore.read();
    return { active: data.active && typeof data.active === "object" ? data.active : {} };
  }

  function saveActivity(active) {
    activityStore.write({ active });
  }

  function cancelActivityTimer(userId) {
    const timer = activityTimers.get(userId);
    if (timer) clearTimeout(timer);
    activityTimers.delete(userId);
  }

  function removeActivityCheck(userId) {
    cancelActivityTimer(userId);
    const data = activityData();
    if (data.active[userId]) {
      delete data.active[userId];
      saveActivity(data.active);
    }
    for (const [token, session] of activitySessions) if (session.userId === userId) activitySessions.delete(token);
  }

  function scheduleActivityCheck(userId, delay) {
    cancelActivityTimer(userId);
    activityTimers.set(userId, setTimeout(() => {
      const record = activityData().active[userId];
      if (!record) return;
      const task = record.pending
        ? closeForNoActivity(userId, record.startedAt)
        : requestActivityCheck(userId);
      task.catch(() => {});
    }, Math.max(0, delay)));
  }

  function startActivityCheck(userId, startedAt) {
    const data = activityData();
    data.active[userId] = { startedAt, nextCheckAt: now() + ACTIVITY_INTERVAL_MS, pending: false };
    saveActivity(data.active);
    scheduleActivityCheck(userId, ACTIVITY_INTERVAL_MS);
  }

  async function disconnectFromVoice(userId) {
    const guild = await client.guilds.fetch(config.guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (member?.voice?.channelId) await member.voice.disconnect("Fichaje cerrado por falta de confirmación").catch(() => {});
  }

  async function closeForNoActivity(userId, expectedStartedAt) {
    const data = activityData();
    const record = data.active[userId];
    if (!record || record.startedAt !== expectedStartedAt) return;
    const credential = credentials.get(userId);
    if (!credential) return removeActivityCheck(userId);
    const shift = await otc.getCurrentShift({ discordId: userId, credential });
    if (shift.state.toio !== "out" || shift.state.sInDateTime !== expectedStartedAt) return removeActivityCheck(userId);
    await otc.clock({ discordId: userId, credential, action: "out" });
    removeActivityCheck(userId);
    await disconnectFromVoice(userId);
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ content: `⏱️ <@${userId}> no confirmó que seguía de servicio en 5 minutos. Su fichaje se ha cerrado.`, allowedMentions: { users: [userId] } }).catch(() => {});
    }
  }

  async function requestActivityCheck(userId) {
    const data = activityData();
    const record = data.active[userId];
    if (!record) return;
    const credential = credentials.get(userId);
    if (!credential) return removeActivityCheck(userId);
    const shift = await otc.getCurrentShift({ discordId: userId, credential });
    if (shift.state.toio !== "out" || shift.state.sInDateTime !== record.startedAt) return removeActivityCheck(userId);
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) throw new OtcError("No se encontró el canal del panel OTC.");
    const token = randomUUID();
    record.pending = true;
    record.nextCheckAt = now() + ACTIVITY_GRACE_MS;
    saveActivity(data.active);
    activitySessions.set(token, { userId, startedAt: record.startedAt, expiresAt: record.nextCheckAt });
    scheduleActivityCheck(userId, ACTIVITY_GRACE_MS);
    await channel.send({
      content: `<@${userId}> ¿sigues de servicio? Pulsa el botón **Sigo de servicio** en los próximos 5 minutos para mantener tu fichaje abierto.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ACTIVITY_CHECK_PREFIX}${token}`).setLabel("Sigo de servicio").setStyle(ButtonStyle.Success)
      )],
      allowedMentions: { users: [userId] }
    });
  }

  async function confirmActivityCheck(interaction) {
    const token = interaction.customId.slice(ACTIVITY_CHECK_PREFIX.length);
    const session = activitySessions.get(token);
    if (!session || session.userId !== interaction.user.id || now() >= session.expiresAt) {
      return interaction.reply({ content: "Esta comprobación ha caducado.", ephemeral: true });
    }
    const data = activityData();
    const record = data.active[interaction.user.id];
    if (!record || record.startedAt !== session.startedAt || !record.pending) {
      return interaction.reply({ content: "Ya no tienes una comprobación de servicio pendiente.", ephemeral: true });
    }
    activitySessions.delete(token);
    record.pending = false;
    record.nextCheckAt = now() + ACTIVITY_INTERVAL_MS;
    saveActivity(data.active);
    scheduleActivityCheck(interaction.user.id, ACTIVITY_INTERVAL_MS);
    await interaction.update({ content: `✅ <@${interaction.user.id}> ha confirmado que sigue de servicio.`, components: [], allowedMentions: { users: [interaction.user.id] } });
  }

  async function resumeActivityChecks() {
    const data = activityData();
    for (const record of Object.values(data.active)) record.pending = false;
    // An active shift may have been started before a Railway restart or deploy.
    // Recover it from OTC so it receives the next hourly verification as well.
    const storedUserIds = typeof credentials.listUserIds === "function" ? credentials.listUserIds() : [];
    for (const userId of storedUserIds) {
      if (data.active[userId]) continue;
      try {
        const shift = await otc.getCurrentShift({ discordId: userId, credential: credentials.get(userId) });
        if (shift.state.toio === "out") {
          data.active[userId] = { startedAt: shift.state.sInDateTime, nextCheckAt: now() + ACTIVITY_INTERVAL_MS, pending: false };
        }
      } catch {
        // A single unavailable or invalid OTC account must not block the other checks.
      }
    }
    saveActivity(data.active);
    for (const [userId, record] of Object.entries(data.active)) {
      scheduleActivityCheck(userId, Math.max(0, Number(record.nextCheckAt || now()) - now()));
    }
  }

  async function publishPanel() {
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal OTC no válido.");
    const payload = {
      embeds: [new EmbedBuilder().setTitle("🕒 Fichaje OTC · EMS")
        .setDescription(`**${COMPANY_NAME}**\n\nPulsa **ENTRADA** para comenzar o **SALIDA** para terminar.\nIntroduce tu contraseña de OTC solo la primera vez en el formulario privado. Tu usuario es tu ID de Discord. El acceso se guarda cifrado para fichar después con un clic.`)
        .setColor(0x1f2240)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("otc:in").setLabel("ENTRADA").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("otc:out").setLabel("SALIDA").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("otc:subtract").setLabel("RESTAR HORAS").setStyle(ButtonStyle.Secondary)
      )], allowedMentions: { parse: [] }
    };
    const data = store.read();
    const existing = data.panelMessageId ? await channel.messages.fetch(data.panelMessageId).catch(() => null) : null;
    if (existing) await existing.edit(payload);
    else {
      const message = await channel.send(payload);
      store.write({ panelMessageId: message.id });
    }
  }

  client.once(Events.ClientReady, () => {
    publishPanel().catch(() => console.error("No se pudo publicar el panel de fichaje OTC."));
    resumeActivityChecks().catch(() => console.error("No se pudieron recuperar los fichajes OTC activos."));
  });
  async function openHoursDeductionForm(interaction) {
    for (const [key, session] of sessions) if (now() >= session.expiresAt) sessions.delete(key);
    const token = randomUUID();
    const modal = new ModalBuilder().setCustomId(`${SUBTRACT_MODAL_PREFIX}${token}`)
      .setTitle("Solicitar resta de horas")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("hours").setLabel("Horas a restar")
            .setPlaceholder("Ejemplo: 1").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("minutes").setLabel("Minutos a restar")
            .setPlaceholder("Ejemplo: 30").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("reason").setLabel("Razón")
            .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
        )
      );
    sessions.set(token, { userId: interaction.user.id, kind: "subtract", expiresAt: now() + 300000 });
    try { await interaction.showModal(modal); }
    catch (error) { sessions.delete(token); throw error; }
  }

  async function submitHoursDeduction(interaction, session) {
    await interaction.deferReply({ ephemeral: true });
    const credential = credentials.get(interaction.user.id);
    if (!credential) throw new OtcAuthError("Primero vincula tu cuenta OTC usando ENTRADA o SALIDA.");
    const authenticated = await otc.authenticate({ discordId: interaction.user.id, credential });
    const user = authenticated.user;
    const nameIc = user.FullName || [user.FirstName, user.LastName].filter(Boolean).join(" ") || user.Name || user.UserName || interaction.user.username;
    const output = await client.channels.fetch(HOURS_DEDUCTION_CHANNEL_ID).catch(() => null);
    if (!output?.isTextBased() || output.guildId !== config.guildId) throw new OtcError("No se encontró el canal de solicitudes de resta de horas.");
    const hours = interaction.fields.getTextInputValue("hours").trim();
    const minutes = interaction.fields.getTextInputValue("minutes").trim();
    if (!/^\d{1,3}$/.test(hours) || !/^\d{1,2}$/.test(minutes) || Number(minutes) > 59 || (Number(hours) === 0 && Number(minutes) === 0)) {
      throw new OtcError("Indica horas y minutos válidos. Los minutos deben estar entre 0 y 59.");
    }
    const time = `${Number(hours)} hora(s) y ${Number(minutes)} minuto(s)`;
    const reason = interaction.fields.getTextInputValue("reason").trim();
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle("⏳ Solicitud de resta de horas")
      .addFields(
        { name: "👤 Nombre IC", value: nameIc },
        { name: "🆔 Discord ID", value: `\`${interaction.user.id}\`` },
        { name: "⏱️ Tiempo", value: time },
        { name: "📝 Razón", value: reason }
      )
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊" })
      .setTimestamp();
    await output.send({ embeds: [embed], allowedMentions: { parse: [] } });
    await interaction.editReply("✅ Tu solicitud de resta de horas ha sido enviada.");
  }

  async function openPasswordForm(interaction, action) {
    for (const [key, session] of sessions) if (now() >= session.expiresAt) sessions.delete(key);
    for (const [userId, attempt] of lastAttempt) if (now() - attempt.at >= 30000 && !inFlight.has(userId)) lastAttempt.delete(userId);
    const token = randomUUID();
    const modal = new ModalBuilder().setCustomId(`${MODAL_PREFIX}${token}`)
      .setTitle(action === "in" ? "Vincular OTC · ENTRADA" : "Vincular OTC · SALIDA")
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("password").setLabel("Tu contraseña de OpenTimeClock")
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256)
      ));
    sessions.set(token, { userId: interaction.user.id, action, expiresAt: now() + 300000 });
    try { await interaction.showModal(modal); }
    catch (error) { sessions.delete(token); throw error; }
  }

  async function execute(interaction, action, password, skipShortShiftConfirmation = false) {
    const userId = interaction.user.id;
    const previousAttempt = lastAttempt.get(userId);
    if (inFlight.has(userId) || (previousAttempt && previousAttempt.action === action && now() - previousAttempt.at < 30000)) {
      return interaction.reply({ content: "Espera 30 segundos y comprueba tu estado en OTC antes de volver a fichar.", ephemeral: true });
    }
    inFlight.add(userId);
    try {
      await interaction.deferReply({ ephemeral: true });
      let credential;
      if (password !== undefined) {
        // Validate before persisting; neither passwords nor plaintext digests go to disk.
        const authenticated = await otc.authenticate({ discordId: userId, password });
        credential = authenticated.credential;
        credentials.set(userId, credential);
        password = null;
      } else credential = credentials.get(userId);
      if (!credential) throw new OtcAuthError("Introduce tu contraseña de OTC para vincular tu cuenta.");
      if (action === "out" && !skipShortShiftConfirmation) {
        const shift = await otc.getCurrentShift({ discordId: userId, credential });
        const startedAt = Date.parse(shift.state.sInDateTime);
        const elapsedMs = Date.now() - startedAt;
        if (!Number.isFinite(startedAt) || elapsedMs < 30 * 60 * 1000) {
          const token = randomUUID();
          sessions.set(token, { userId, action, expiresAt: now() + 300000, shortShiftConfirmation: true });
          return interaction.editReply({
            content: "⚠️ **¿Seguro que quieres finalizar el fichaje?** Llevas menos de **30 minutos de servicio**.",
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${CONFIRM_OUT_PREFIX}${token}`).setLabel("Sí, finalizar fichaje").setStyle(ButtonStyle.Danger)
            )],
            allowedMentions: { parse: [] }
          });
        }
      }
      lastAttempt.set(userId, { action, at: now() });
      const result = await otc.clock({ discordId: userId, credential, action });
      if (result.action === "in") startActivityCheck(userId, result.startedAt);
      else removeActivityCheck(userId);
      const payload = result.action === "out"
        ? { content: "", embeds: [exitReceipt(result)], components: [], allowedMentions: { parse: [] } }
        : { content: "✅ ENTRADA registrada en OpenTimeClock.", components: [], allowedMentions: { parse: [] } };
      await interaction.editReply(payload);
    } catch (error) {
      if (!(error instanceof OtcAuthError)) throw error;
      // A changed password requires renewal, not silent repeated login attempts.
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`otc:renew:${action}`).setLabel("Actualizar contraseña").setStyle(ButtonStyle.Primary)
      );
      await interaction.editReply({ content: error.message, components: [row] });
    } finally { inFlight.delete(userId); }
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    const action = interaction.isButton() ? BUTTON_ACTIONS[interaction.customId] : null;
    const renewal = interaction.isButton() && /^otc:renew:(in|out)$/.test(interaction.customId);
    const shortShiftConfirmation = interaction.isButton() && interaction.customId.startsWith(CONFIRM_OUT_PREFIX);
    const activityCheck = interaction.isButton() && interaction.customId.startsWith(ACTIVITY_CHECK_PREFIX);
    const isModal = interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX);
    const isSubtractModal = interaction.isModalSubmit() && interaction.customId.startsWith(SUBTRACT_MODAL_PREFIX);
    if (!action && !renewal && !shortShiftConfirmation && !activityCheck && !isModal && !isSubtractModal) return;
    if (!interaction.inGuild() || interaction.guildId !== config.guildId || interaction.channelId !== PANEL_CHANNEL_ID) return;
    try {
      if (activityCheck) return await confirmActivityCheck(interaction);
      if (renewal) return await openPasswordForm(interaction, interaction.customId.split(":")[2]);
      if (action === "subtract") return await openHoursDeductionForm(interaction);
      if (isSubtractModal) {
        const token = interaction.customId.slice(SUBTRACT_MODAL_PREFIX.length);
        const session = sessions.get(token);
        if (!session || session.kind !== "subtract" || session.userId !== interaction.user.id || now() >= session.expiresAt) {
          return await interaction.reply({ content: "El formulario ha caducado. Pulsa RESTAR HORAS de nuevo.", ephemeral: true });
        }
        sessions.delete(token);
        return await submitHoursDeduction(interaction, session);
      }
      if (shortShiftConfirmation) {
        const token = interaction.customId.slice(CONFIRM_OUT_PREFIX.length);
        const session = sessions.get(token);
        if (!session || !session.shortShiftConfirmation || session.userId !== interaction.user.id || now() >= session.expiresAt) {
          return await interaction.reply({ content: "La confirmación ha caducado. Pulsa SALIDA de nuevo.", ephemeral: true });
        }
        sessions.delete(token);
        return await execute(interaction, "out", undefined, true);
      }
      if (action) {
        if (!credentials.get(interaction.user.id)) return await openPasswordForm(interaction, action);
        return await execute(interaction, action);
      }
      const token = interaction.customId.slice(MODAL_PREFIX.length);
      const session = sessions.get(token);
      if (!session || session.userId !== interaction.user.id || now() >= session.expiresAt) {
        return await interaction.reply({ content: "El formulario ha caducado. Pulsa de nuevo ENTRADA o SALIDA.", ephemeral: true });
      }
      sessions.delete(token);
      await execute(interaction, session.action, interaction.fields.getTextInputValue("password"));
    } catch (error) {
      // Never print interaction objects, remote responses or credential-bearing errors.
      const content = error instanceof OtcError ? error.message : "No se pudo confirmar el fichaje. Revisa tu estado en OpenTimeClock antes de repetirlo.";
      if (interaction.replied || interaction.deferred) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  });
}

module.exports = { name: "fichaje OTC", commands: [], register };
