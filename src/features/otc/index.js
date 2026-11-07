const { randomUUID } = require("node:crypto");
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const { createJsonStore } = require("../../storage");
const { sendCommandLog } = require("../command-logs");
const { createOtcClient, OtcError, OtcAuthError, COMPANY_NAME } = require("./client");

const { createCredentialStore } = require("./credentials");

const PANEL_CHANNEL_ID = "1568448649833480360";
const BUTTON_ACTIONS = { "otc:in": "in", "otc:out": "out" };
const MODAL_PREFIX = "otc:password:";

function register(client, config, { otc = createOtcClient(), now = Date.now, credentials = createCredentialStore(config.dataDir, config.guildId) } = {}) {
  const store = createJsonStore(config.dataDir, "otc-panel.json", { panelMessageId: null });
  const sessions = new Map();
  const inFlight = new Set();
  const lastAttempt = new Map();

  async function publishPanel() {
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal OTC no válido.");
    const payload = {
      embeds: [new EmbedBuilder().setTitle("🕒 Fichaje OTC · EMS")
        .setDescription(`**${COMPANY_NAME}**\n\nPulsa **ENTRADA** para comenzar o **SALIDA** para terminar.\nIntroduce tu contraseña de OTC solo la primera vez en el formulario privado. Tu usuario es tu ID de Discord. El acceso se guarda cifrado para fichar después con un clic.`)
        .setColor(0x1f2240)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("otc:in").setLabel("ENTRADA").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("otc:out").setLabel("SALIDA").setStyle(ButtonStyle.Danger)
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
  });
  async function openPasswordForm(interaction, action) {
    for (const [key, session] of sessions) if (now() >= session.expiresAt) sessions.delete(key);
    for (const [userId, attemptedAt] of lastAttempt) if (now() - attemptedAt >= 30000 && !inFlight.has(userId)) lastAttempt.delete(userId);
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

  async function execute(interaction, action, password) {
    const userId = interaction.user.id;
    if (inFlight.has(userId) || now() - (lastAttempt.get(userId) ?? -Infinity) < 30000) {
      return interaction.reply({ content: "Espera 30 segundos y comprueba tu estado en OTC antes de volver a fichar.", ephemeral: true });
    }
    inFlight.add(userId);
    lastAttempt.set(userId, now());
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
      const result = await otc.clock({ discordId: userId, credential, action });
      await sendCommandLog(client, config, {
        executorId: userId, targetIds: [userId],
        command: `OTC ${result.action === "in" ? "ENTRADA" : "SALIDA"} (confirmada)`,
        guildId: config.guildId, createdAt: result.confirmedAt
      });
      await interaction.editReply({ content: `✅ ${result.action === "in" ? "ENTRADA" : "SALIDA"} registrada en OpenTimeClock.`, components: [], allowedMentions: { parse: [] } });
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
    const isModal = interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX);
    if (!action && !renewal && !isModal) return;
    if (!interaction.inGuild() || interaction.guildId !== config.guildId || interaction.channelId !== PANEL_CHANNEL_ID) return;
    try {
      if (renewal) return await openPasswordForm(interaction, interaction.customId.split(":")[2]);
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
