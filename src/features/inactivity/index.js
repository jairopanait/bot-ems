const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const cron = require("node-cron");
const { createJsonStore } = require("../../storage");

const REQUEST_BUTTON_ID = "inactivity:request";
const REMOVE_BUTTON_ID = "inactivity:remove";
const ADMIN_REQUEST_BUTTON_ID = "inactivity:admin:request";
const SUBMIT_MODAL_ID = "inactivity:submit";
const ADMIN_SUBMIT_MODAL_ID = "inactivity:admin:submit";
const TYPE_SELECT_ID = "inactivity:type:select";
const ADMIN_TYPE_SELECT_ID = "inactivity:admin:type:select";
const DATE_YEAR_ID = "inactivity:date:year";
const DATE_MONTH_ID = "inactivity:date:month";
const DATE_DAY_ID = "inactivity:date:day";
const DATE_CONFIRM_ID = "inactivity:date:confirm";
const DATE_INDEFINITE_ID = "inactivity:date:indefinite";

const commands = [
  new SlashCommandBuilder()
    .setName("inactividades")
    .setDescription("Muestra las inactividades vigentes")
];

function dateKey(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function madridParts(timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function parseSpanishDate(value) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, date };
}

function parseRange(value) {
  const parts = value.split(/\s+(?:a|hasta|-)\s+/i);
  if (parts.length !== 2) return null;
  const start = parseSpanishDate(parts[0]);
  const end = parseSpanishDate(parts[1]);
  if (!start || !end || end.key < start.key) return null;
  return { start, end };
}

function formatKey(key) {
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

function dayAfter(key) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function addDays(key, amount) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateParts(key) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

function keyFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isWeekend(timezone) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date());
  return weekday === "Sat" || weekday === "Sun";
}

function exceedsOneCalendarMonth(start, end) {
  const year = start.date.getUTCFullYear();
  const month = start.date.getUTCMonth();
  const day = start.date.getUTCDate();
  const lastDayOfNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const limit = new Date(Date.UTC(year, month + 1, Math.min(day, lastDayOfNextMonth)));
  return end.date > limit;
}

function normalizeType(value) {
  const normalized = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normalized === "total") return "total";
  if (normalized === "parcial") return "parcial";
  return null;
}

function register(client, rootConfig) {
  const config = rootConfig.inactivity;
  const store = createJsonStore(rootConfig.dataDir, "inactivities.json", { panelMessageId: null, entries: {} });
  const dateSessions = new Map();

  async function notificationChannel() {
    const channel = await client.channels.fetch(config.notificationChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal de avisos de inactividad no es válido.");
    return channel;
  }

  async function publishPanel() {
    const channel = await client.channels.fetch(config.requestChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal de solicitudes de inactividad no es válido.");
    const embed = new EmbedBuilder()
      .setTitle("SOLICITAR INACTIVIDAD")
      .setDescription("Solicita su inactividad parcial o total.")
      .setColor(0xc0392b);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(REQUEST_BUTTON_ID).setLabel("SOLICITAR INACTIVIDAD").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(REMOVE_BUTTON_ID).setLabel("ELIMINAR MI INACTIVIDAD").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(ADMIN_REQUEST_BUTTON_ID).setLabel("AÑADIR INACTIVIDAD MANUAL").setStyle(ButtonStyle.Secondary)
    );
    const data = store.read();
    if (data.panelMessageId) {
      const existing = await channel.messages.fetch(data.panelMessageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed], components: [row] });
        console.log(`Panel de inactividad actualizado en el canal ${config.requestChannelId}.`);
        return;
      }
    }
    const message = await channel.send({ embeds: [embed], components: [row] });
    data.panelMessageId = message.id;
    store.write(data);
    console.log(`Panel de inactividad publicado en el canal ${config.requestChannelId}.`);
  }

  function buildModal() {
    return new ModalBuilder()
      .setCustomId(SUBMIT_MODAL_ID)
      .setTitle("Solicitar inactividad")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("Nombre IC")
          .setTextInputComponent(new TextInputBuilder().setCustomId("icName").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
        new LabelBuilder()
          .setLabel("Razón")
          .setTextInputComponent(new TextInputBuilder().setCustomId("reason").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500))
      );
  }

  function buildAdminModal() {
    return new ModalBuilder()
      .setCustomId(ADMIN_SUBMIT_MODAL_ID)
      .setTitle("Añadir inactividad manual")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("ID de Discord del usuario")
          .setTextInputComponent(new TextInputBuilder().setCustomId("userId").setStyle(TextInputStyle.Short).setRequired(true).setMinLength(17).setMaxLength(20)),
        new LabelBuilder()
          .setLabel("Nombre IC")
          .setTextInputComponent(new TextInputBuilder().setCustomId("icName").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
        new LabelBuilder()
          .setLabel("Razón")
          .setTextInputComponent(new TextInputBuilder().setCustomId("reason").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500))
      );
  }

  function buildTypePicker(customId = TYPE_SELECT_ID) {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder("Selecciona Total o Parcial")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("Total").setValue("total"),
          new StringSelectMenuOptionBuilder().setLabel("Parcial").setValue("parcial")
        )
    );
  }

  function buildDatePicker(session) {
    const selected = dateParts(session.selectedDate);
    const minimum = dateParts(session.minimumDate);
    const yearOptions = [];
    for (let year = minimum.year; year <= minimum.year + 5; year += 1) {
      yearOptions.push(new StringSelectMenuOptionBuilder()
        .setLabel(String(year)).setValue(String(year)).setDefault(year === selected.year));
    }
    const monthOptions = [];
    for (let month = 1; month <= 12; month += 1) {
      const label = new Intl.DateTimeFormat("es-ES", { month: "long", timeZone: "UTC" })
        .format(new Date(Date.UTC(2026, month - 1, 1)));
      monthOptions.push(new StringSelectMenuOptionBuilder()
        .setLabel(label.charAt(0).toUpperCase() + label.slice(1))
        .setValue(String(month))
        .setDefault(month === selected.month));
    }
    const maximumDay = daysInMonth(selected.year, selected.month);
    const dayOptions = [];
    if (session.dayPage === 2) {
      dayOptions.push(new StringSelectMenuOptionBuilder().setLabel("← Días 1–24").setValue("back"));
      for (let day = 25; day <= maximumDay; day += 1) {
        dayOptions.push(new StringSelectMenuOptionBuilder()
          .setLabel(String(day)).setValue(String(day)).setDefault(day === selected.day));
      }
    } else {
      for (let day = 1; day <= Math.min(24, maximumDay); day += 1) {
        dayOptions.push(new StringSelectMenuOptionBuilder()
          .setLabel(String(day)).setValue(String(day)).setDefault(day === selected.day));
      }
      if (maximumDay >= 25) dayOptions.push(new StringSelectMenuOptionBuilder().setLabel("Días 25–31 →").setValue("more"));
    }
    const yearRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(DATE_YEAR_ID).setPlaceholder("Selecciona el año").addOptions(yearOptions)
    );
    const monthRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(DATE_MONTH_ID).setPlaceholder("Selecciona el mes").addOptions(monthOptions)
    );
    const dayRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(DATE_DAY_ID).setPlaceholder("Selecciona el día").addOptions(dayOptions)
    );
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(DATE_CONFIRM_ID)
        .setLabel(session.stage === "start" ? "Confirmar inicio" : "Confirmar final")
        .setStyle(ButtonStyle.Success)
    );
    if (session.stage === "end" && session.type === "parcial") {
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(DATE_INDEFINITE_ID)
          .setLabel("INDEFINIDA")
          .setStyle(ButtonStyle.Primary)
      );
    }
    return [yearRow, monthRow, dayRow, buttons];
  }

  function datePickerContent(session) {
    const step = session.stage === "start" ? "1/2 — Fecha de inicio" : "2/2 — Fecha de finalización";
    return `**${step}**\nFecha seleccionada: **${formatKey(session.selectedDate)}**`;
  }

  async function applyRole(entry) {
    const guild = await client.guilds.fetch(rootConfig.guildId);
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) return;
    const roleId = entry.type === "total" ? config.totalRoleId : config.partialRoleId;
    const otherRoleId = entry.type === "total" ? config.partialRoleId : config.totalRoleId;
    if (member.roles.cache.has(otherRoleId)) await member.roles.remove(otherRoleId);
    if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, "Inactividad vigente");
    entry.roleApplied = true;
  }

  async function finishEntry(entry) {
    const guild = await client.guilds.fetch(rootConfig.guildId);
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    const roleId = entry.type === "total" ? config.totalRoleId : config.partialRoleId;
    if (member?.roles.cache.has(roleId)) await member.roles.remove(roleId, "Inactividad finalizada");
    const channel = await notificationChannel();
    await channel.send({
      content: `<@${entry.userId}> ¡Su inactividad ${entry.type} finalizó! Para renovarla vuelva a solicitarla en el canal correspondiente.`,
      allowedMentions: { users: [entry.userId] }
    });
    entry.finished = true;
  }

  async function processEntries() {
    const now = madridParts(rootConfig.timezone);
    const data = store.read();
    let changed = false;
    for (const entry of Object.values(data.entries)) {
      if (entry.finished) continue;
      if (!entry.roleApplied && now.date >= entry.startDate) {
        await applyRole(entry);
        changed = true;
      }
      if (entry.cleanupDate && (now.date > entry.cleanupDate || (now.date === entry.cleanupDate && now.hour >= 10))) {
        await finishEntry(entry);
        changed = true;
      }
    }
    if (changed) store.write(data);
  }

  async function handleDetailsSubmission(interaction) {
    const session = dateSessions.get(interaction.user.id);
    if (!session?.type) return interaction.reply({ content: "La selección ha caducado. Vuelve a pulsar SOLICITAR INACTIVIDAD.", ephemeral: true });
    const type = session.type;
    const icName = interaction.fields.getTextInputValue("icName").trim();
    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (!type) return interaction.reply({ content: "El tipo debe ser Total o Parcial.", ephemeral: true });

    const today = dateKey(new Date(), rootConfig.timezone);
    Object.assign(session, {
      icName, reason, stage: "start", minimumDate: today, selectedDate: today,
      dayPage: dateParts(today).day >= 25 ? 2 : 1
    });
    dateSessions.set(interaction.user.id, session);
    await interaction.reply({
      content: datePickerContent(session),
      components: buildDatePicker(session),
      ephemeral: true
    });
  }

  async function handleAdminDetailsSubmission(interaction) {
    const session = dateSessions.get(interaction.user.id);
    if (!session?.type || !session.admin) {
      return interaction.reply({ content: "La selección ha caducado. Vuelve a pulsar AÑADIR INACTIVIDAD MANUAL.", ephemeral: true });
    }

    const userId = interaction.fields.getTextInputValue("userId").trim();
    if (!/^\d{17,20}$/.test(userId)) {
      return interaction.reply({ content: "El ID de Discord introducido no es válido.", ephemeral: true });
    }
    const guild = await client.guilds.fetch(rootConfig.guildId);
    const targetMember = await guild.members.fetch(userId).catch(() => null);
    if (!targetMember) {
      return interaction.reply({ content: "No encuentro a ese usuario dentro del servidor.", ephemeral: true });
    }

    const today = dateKey(new Date(), rootConfig.timezone);
    Object.assign(session, {
      targetUserId: targetMember.id,
      targetDiscordName: targetMember.user.tag,
      icName: interaction.fields.getTextInputValue("icName").trim(),
      reason: interaction.fields.getTextInputValue("reason").trim(),
      stage: "start",
      minimumDate: today,
      selectedDate: today,
      dayPage: dateParts(today).day >= 25 ? 2 : 1
    });
    dateSessions.set(interaction.user.id, session);
    await interaction.reply({
      content: datePickerContent(session),
      components: buildDatePicker(session),
      ephemeral: true
    });
  }

  async function handleRequest(interaction) {
    const guild = await client.guilds.fetch(rootConfig.guildId);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    const canTestOnWeekends = member?.roles.cache.has(config.viewerRoleId) === true;
    if (!isWeekend(rootConfig.timezone) || canTestOnWeekends) {
      return interaction.reply({
        content: "Selecciona el tipo de inactividad:",
        components: [buildTypePicker()],
        ephemeral: true
      });
    }
    const channel = await notificationChannel();
    const message = "¡Lo sentimos, inactividad rechazada, solicitala de Lunes a Viernes!";
    await channel.send({
      content: `<@${interaction.user.id}> ${message}`,
      embeds: [new EmbedBuilder()
        .setColor(0xc0392b)
        .setImage("https://media.discordapp.net/stickers/1389588947792822333.webp?size=160&quality=lossless")],
      allowedMentions: { users: [interaction.user.id] }
    });
    await interaction.reply({ content: message, ephemeral: true });
  }

  async function handleAdminRequest(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member?.roles.cache.has(config.viewerRoleId)) {
      return interaction.reply({ content: "No tienes permiso para añadir inactividades manualmente.", ephemeral: true });
    }
    return interaction.reply({
      content: "Selecciona el tipo de inactividad que quieres asignar:",
      components: [buildTypePicker(ADMIN_TYPE_SELECT_ID)],
      ephemeral: true
    });
  }

  async function handleTypeSelection(interaction) {
    const type = normalizeType(interaction.values[0]);
    if (!type) return interaction.reply({ content: "Selecciona Total o Parcial.", ephemeral: true });
    dateSessions.set(interaction.user.id, { type });
    await interaction.showModal(buildModal());
  }

  async function handleAdminTypeSelection(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member?.roles.cache.has(config.viewerRoleId)) {
      return interaction.reply({ content: "No tienes permiso para añadir inactividades manualmente.", ephemeral: true });
    }
    const type = normalizeType(interaction.values[0]);
    if (!type) return interaction.reply({ content: "Selecciona Total o Parcial.", ephemeral: true });
    dateSessions.set(interaction.user.id, { type, admin: true, administeredBy: interaction.user.id });
    await interaction.showModal(buildAdminModal());
  }

  async function finishDateSelection(interaction, session) {
    if (session.stage === "start") {
      session.startDate = session.selectedDate;
      session.stage = "end";
      session.minimumDate = session.startDate;
      session.selectedDate = session.startDate;
      session.dayPage = dateParts(session.startDate).day >= 25 ? 2 : 1;
      return interaction.update({ content: datePickerContent(session), components: buildDatePicker(session) });
    }

    const start = parseSpanishDate(formatKey(session.startDate));
    const end = session.indefinite ? null : parseSpanishDate(formatKey(session.selectedDate));
    if (!session.admin && session.type === "total" && exceedsOneCalendarMonth(start, end)) {
      const channel = await notificationChannel();
      await channel.send({
        content: `<@${interaction.user.id}> ¡Lo sentimos. supera su inactividad total más de un mes, abra ticket para hablarlo con directiva!`,
        allowedMentions: { users: [interaction.user.id] }
      });
      dateSessions.delete(interaction.user.id);
      return interaction.update({ content: "La inactividad total supera un mes. Se ha enviado el aviso correspondiente.", components: [] });
    }

    const today = dateKey(new Date(), rootConfig.timezone);
    const data = store.read();
    const entryUserId = session.admin ? session.targetUserId : interaction.user.id;
    const entry = {
      userId: entryUserId,
      discordName: session.admin ? session.targetDiscordName : interaction.user.tag,
      icName: session.icName,
      reason: session.reason,
      type: session.type,
      startDate: session.startDate,
      endDate: session.indefinite ? null : session.selectedDate,
      cleanupDate: session.indefinite ? null : dayAfter(session.selectedDate),
      indefinite: session.indefinite === true,
      roleApplied: false,
      finished: false,
      requestedAt: new Date().toISOString(),
      administeredBy: session.admin ? session.administeredBy : null
    };
    data.entries[entryUserId] = entry;
    if (entry.startDate <= today) await applyRole(entry);
    store.write(data);
    dateSessions.delete(interaction.user.id);
    const channel = await notificationChannel();
    const finalDate = entry.indefinite ? "sin fecha final" : formatKey(entry.endDate);
    await channel.send({
      content: `¡Su inactividad ${entry.type} está vigente desde ${formatKey(entry.startDate)} hasta ${finalDate} <@${entry.userId}>!`,
      allowedMentions: { users: [entry.userId] }
    });
    const confirmation = entry.indefinite
      ? `Inactividad parcial indefinida registrada para <@${entry.userId}> desde el ${formatKey(entry.startDate)}.`
      : `Inactividad ${entry.type} registrada para <@${entry.userId}> del ${formatKey(entry.startDate)} al ${formatKey(entry.endDate)}. El rol se retirará el ${formatKey(entry.cleanupDate)} a las 10:00.`;
    await interaction.update({
      content: confirmation,
      components: []
    });
  }

  async function handleDateComponent(interaction) {
    const session = dateSessions.get(interaction.user.id);
    if (!session) return interaction.reply({ content: "Esta selección ha caducado. Vuelve a abrir el formulario.", ephemeral: true });

    if (interaction.isStringSelectMenu()) {
      const value = interaction.values[0];
      const selected = dateParts(session.selectedDate);
      if (interaction.customId === DATE_YEAR_ID) {
        selected.year = Number(value);
        selected.day = Math.min(selected.day, daysInMonth(selected.year, selected.month));
      } else if (interaction.customId === DATE_MONTH_ID) {
        selected.month = Number(value);
        selected.day = Math.min(selected.day, daysInMonth(selected.year, selected.month));
      } else if (value === "more") {
        session.dayPage = 2;
        return interaction.update({ content: datePickerContent(session), components: buildDatePicker(session) });
      } else if (value === "back") {
        session.dayPage = 1;
        return interaction.update({ content: datePickerContent(session), components: buildDatePicker(session) });
      } else {
        selected.day = Number(value);
      }
      session.selectedDate = keyFromParts(selected.year, selected.month, selected.day);
      session.dayPage = selected.day >= 25 ? 2 : 1;
      return interaction.update({ content: datePickerContent(session), components: buildDatePicker(session) });
    }
    if (interaction.customId === DATE_INDEFINITE_ID && session.stage === "end" && session.type === "parcial") {
      session.indefinite = true;
      return finishDateSelection(interaction, session);
    }
    if (session.selectedDate < session.minimumDate) {
      return interaction.update({
        content: `${datePickerContent(session)}\n⚠️ La fecha no puede ser anterior al ${formatKey(session.minimumDate)}.`,
        components: buildDatePicker(session)
      });
    }
    return finishDateSelection(interaction, session);
  }

  async function removeInactivity(interaction) {
    const data = store.read();
    const entry = data.entries[interaction.user.id];
    if (!entry || entry.finished) {
      return interaction.reply({ content: "No tienes ninguna inactividad vigente para retirar.", ephemeral: true });
    }

    const guild = await client.guilds.fetch(rootConfig.guildId);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    const roleId = entry.type === "total" ? config.totalRoleId : config.partialRoleId;
    if (member?.roles.cache.has(roleId)) await member.roles.remove(roleId, "Inactividad retirada por el usuario");

    entry.finished = true;
    entry.cancelled = true;
    entry.cancelledAt = new Date().toISOString();
    store.write(data);

    const channel = await notificationChannel();
    await channel.send({
      content: `<@${interaction.user.id}> ¡Inactividad retirada con éxito!`,
      allowedMentions: { users: [interaction.user.id] }
    });
    await interaction.reply({ content: "Tu inactividad ha sido retirada correctamente.", ephemeral: true });
  }

  async function listEntries(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(config.viewerRoleId)) {
      return interaction.reply({ content: "No tienes permiso para consultar las inactividades.", ephemeral: true });
    }
    const entries = Object.values(store.read().entries).filter((entry) => !entry.finished);
    if (!entries.length) return interaction.reply({ content: "No hay inactividades vigentes.", ephemeral: true });
    const chunks = [];
    for (let index = 0; index < entries.length; index += 10) chunks.push(entries.slice(index, index + 10));
    const embeds = chunks.slice(0, 10).map((chunk, index) => new EmbedBuilder()
      .setTitle(index === 0 ? "Inactividades vigentes" : `Inactividades vigentes (${index + 1})`)
      .setColor(0xc0392b)
      .setDescription(chunk.map((entry) =>
        `**${entry.icName}** — <@${entry.userId}> (${entry.discordName})\n` +
        `Tipo: ${entry.type}${entry.indefinite ? " indefinida" : ""} · ${formatKey(entry.startDate)} → ${entry.indefinite ? "Sin fecha final" : formatKey(entry.endDate)}\n` +
        `Razón: ${entry.reason}`
      ).join("\n\n")));
    await interaction.reply({ embeds, ephemeral: true, allowedMentions: { parse: [] } });
  }

  client.once(Events.ClientReady, async () => {
    await publishPanel().catch((error) => console.error("No se pudo publicar el panel de inactividad:", error));
    await processEntries().catch((error) => console.error("No se pudieron procesar inactividades:", error));
    cron.schedule("* * * * *", () => processEntries().catch(console.error), { timezone: rootConfig.timezone });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === REQUEST_BUTTON_ID) return handleRequest(interaction);
      if (interaction.isButton() && interaction.customId === REMOVE_BUTTON_ID) return removeInactivity(interaction);
      if (interaction.isButton() && interaction.customId === ADMIN_REQUEST_BUTTON_ID) return handleAdminRequest(interaction);
      if (interaction.isModalSubmit() && interaction.customId === SUBMIT_MODAL_ID) return handleDetailsSubmission(interaction);
      if (interaction.isModalSubmit() && interaction.customId === ADMIN_SUBMIT_MODAL_ID) return handleAdminDetailsSubmission(interaction);
      if (interaction.isStringSelectMenu() && interaction.customId === TYPE_SELECT_ID) return handleTypeSelection(interaction);
      if (interaction.isStringSelectMenu() && interaction.customId === ADMIN_TYPE_SELECT_ID) return handleAdminTypeSelection(interaction);
      if (interaction.isStringSelectMenu() && [DATE_YEAR_ID, DATE_MONTH_ID, DATE_DAY_ID].includes(interaction.customId)) return handleDateComponent(interaction);
      if (interaction.isButton() && [DATE_CONFIRM_ID, DATE_INDEFINITE_ID].includes(interaction.customId)) return handleDateComponent(interaction);
      if (interaction.isChatInputCommand() && interaction.commandName === "inactividades") return listEntries(interaction);
    } catch (error) {
      console.error("Error en inactividades:", error);
      const response = { content: "No se pudo gestionar la inactividad. Revisa los permisos del bot.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    }
  });
}

module.exports = { name: "inactividades", commands, register };
