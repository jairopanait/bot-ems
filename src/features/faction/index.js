const {
  ActionRowBuilder,
  Events,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const ACTION_SELECT_PREFIX = "faction:action:";
const REASON_SELECT_PREFIX = "faction:reason:";
const BLACKLIST_SELECT_PREFIX = "faction:blacklist:";
const REASON_MODAL_PREFIX = "faction:reason-modal:";
const BLACKLIST_ROLE_ID = "1129583588766122006";
const MISCONDUCT_EXPULSION_ROLE_ID = "1343636194390573186";

function register(client, rootConfig) {
  const config = rootConfig.faction;
  const sessions = new Map();

  function formatDate(date) {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone: rootConfig.timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function template(member, date, reason, blacklisted) {
    return `\`\`\`\nCódigo de discord: ${member.user.username} // ${member.id}\nFecha de salida de la facción: ${formatDate(date)}\nMotivo de la salida: ${reason}\nBlacklisted: ${blacklisted}\n\`\`\``;
  }

  function actionRow(messageId) {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${ACTION_SELECT_PREFIX}${messageId}`)
        .setPlaceholder("Selecciona la gestión")
        .addOptions(
          { label: "Descenso", value: "demotion", description: "No se realizará ninguna acción automática." },
          { label: "Expulsión", value: "expulsion", description: "Gestionar salida, roles y plantilla." }
        )
    );
  }

  function reasonRow(messageId) {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${REASON_SELECT_PREFIX}${messageId}`)
        .setPlaceholder("Selecciona el motivo de la expulsión")
        .addOptions(
          { label: "Expulsión por horas", value: "hours" },
          { label: "Conducta / incumplimiento", value: "misconduct", description: "Escribirás el motivo concreto." }
        )
    );
  }

  function blacklistRow(messageId) {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${BLACKLIST_SELECT_PREFIX}${messageId}`)
        .setPlaceholder("¿Tiene blacklist?")
        .addOptions({ label: "No", value: "no" }, { label: "Sí", value: "sí" })
    );
  }

  async function processMember(message, member, reason, blacklisted, additionalRoleIds) {
    const me = message.guild.members.me ?? await message.guild.members.fetchMe();
    const required = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageNicknames, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    if (!me.permissions.has(required)) throw new Error("Al bot le faltan permisos para gestionar roles, apodos o mensajes.");
    await member.roles.set([...new Set([...config.preservedRoleIds, ...config.rolesToAdd, ...additionalRoleIds])], `Salida solicitada en ${message.id}`);
    await member.setNickname(null, `Salida solicitada en ${message.id}`);
    const channel = await message.guild.channels.fetch(config.outputChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal de salida no existe o no permite mensajes.");
    await channel.send({ content: template(member, message.createdAt, reason, blacklisted), allowedMentions: { parse: [] } });
  }

  async function completeExpulsion(session) {
    let failures = 0;
    const additionalRoleIds = [];
    if (session.isMisconduct) additionalRoleIds.push(MISCONDUCT_EXPULSION_ROLE_ID);
    if (session.blacklisted === "sí") additionalRoleIds.push(BLACKLIST_ROLE_ID);
    for (const userId of session.userIds) {
      try {
        await processMember(session.sourceMessage, await session.sourceMessage.guild.members.fetch(userId), session.reason, session.blacklisted, additionalRoleIds);
      } catch (error) {
        failures += 1;
        console.error(`No se pudo procesar la salida de ${userId}:`, error);
      }
    }
    return failures;
  }

  async function updateControlMessage(session, content) {
    const channel = await session.sourceMessage.guild.channels.fetch(session.channelId).catch(() => null);
    const control = channel?.isTextBased() ? await channel.messages.fetch(session.controlMessageId).catch(() => null) : null;
    if (control) await control.edit({ content, components: [] });
  }

  function getSession(interaction, prefix) {
    const messageId = interaction.customId.slice(prefix.length);
    const session = sessions.get(messageId);
    if (!session) return { messageId, session: null };
    if (session.authorId !== interaction.user.id) return { messageId, session: null, unauthorized: true };
    return { messageId, session };
  }

  async function handleAction(interaction) {
    const { messageId, session, unauthorized } = getSession(interaction, ACTION_SELECT_PREFIX);
    if (unauthorized) return interaction.reply({ content: "Solo quien envió el mensaje original puede seleccionar esta opción.", ephemeral: true });
    if (!session) return interaction.reply({ content: "Esta gestión ha caducado. Envía de nuevo el mensaje con la mención.", ephemeral: true });

    if (interaction.values[0] === "demotion") {
      sessions.delete(messageId);
      return interaction.update({ content: "**Descenso seleccionado.** No se ha realizado ninguna acción automática.", components: [] });
    }
    return interaction.update({ content: "**Expulsión seleccionada.** Indica el motivo:", components: [reasonRow(messageId)] });
  }

  async function handleReason(interaction) {
    const { messageId, session, unauthorized } = getSession(interaction, REASON_SELECT_PREFIX);
    if (unauthorized) return interaction.reply({ content: "Solo quien envió el mensaje original puede seleccionar esta opción.", ephemeral: true });
    if (!session) return interaction.reply({ content: "Esta gestión ha caducado. Envía de nuevo el mensaje con la mención.", ephemeral: true });

    if (interaction.values[0] === "hours") {
      session.reason = "Expulsión horas";
      session.blacklisted = "no";
      session.isMisconduct = false;
      await interaction.deferUpdate();
      const failures = await completeExpulsion(session);
      sessions.delete(messageId);
      return interaction.editReply({
        content: failures ? "La expulsión por horas se completó con algunos errores. Revisa los registros del bot." : "**Expulsión por horas completada.**",
        components: []
      });
    }

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${REASON_MODAL_PREFIX}${messageId}`)
        .setTitle("Motivo de la expulsión")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("¿Qué ha hecho mal?")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000)
          )
        )
    );
  }

  async function handleReasonModal(interaction) {
    const { messageId, session, unauthorized } = getSession(interaction, REASON_MODAL_PREFIX);
    if (unauthorized) return interaction.reply({ content: "No tienes permiso para completar esta gestión.", ephemeral: true });
    if (!session) return interaction.reply({ content: "Esta gestión ha caducado. Envía de nuevo el mensaje con la mención.", ephemeral: true });
    session.reason = interaction.fields.getTextInputValue("reason").trim();
    session.isMisconduct = true;
    await interaction.reply({
      content: "Selecciona si la persona tiene blacklist:",
      components: [blacklistRow(messageId)],
      ephemeral: true
    });
  }

  async function handleBlacklist(interaction) {
    const { messageId, session, unauthorized } = getSession(interaction, BLACKLIST_SELECT_PREFIX);
    if (unauthorized) return interaction.reply({ content: "No tienes permiso para completar esta gestión.", ephemeral: true });
    if (!session) return interaction.reply({ content: "Esta gestión ha caducado. Envía de nuevo el mensaje con la mención.", ephemeral: true });
    session.blacklisted = interaction.values[0];
    await interaction.deferUpdate();
    const failures = await completeExpulsion(session);
    await updateControlMessage(session, failures
      ? "La expulsión se completó con algunos errores. Revisa los registros del bot."
      : "**Expulsión completada.**");
    sessions.delete(messageId);
    await interaction.editReply({
      content: failures ? "La expulsión se completó con algunos errores." : "Expulsión completada.",
      components: []
    });
  }

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.guildId !== config.guildId || message.channelId !== config.triggerChannelId) return;
    if (message.content.trim().toLowerCase().startsWith("!renuncia")) return;
    const userIds = [...message.mentions.users.values()].filter((user) => user.id !== client.user.id).map((user) => user.id);
    if (!userIds.length) return;
    const control = await message.reply({ content: "Selecciona qué gestión deseas realizar:", components: [actionRow(message.id)] });
    sessions.set(message.id, {
      authorId: message.author.id,
      userIds,
      sourceMessage: message,
      channelId: message.channelId,
      controlMessageId: control.id
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
    try {
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith(ACTION_SELECT_PREFIX)) return handleAction(interaction);
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith(REASON_SELECT_PREFIX)) return handleReason(interaction);
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith(BLACKLIST_SELECT_PREFIX)) return handleBlacklist(interaction);
      if (interaction.isModalSubmit() && interaction.customId.startsWith(REASON_MODAL_PREFIX)) return handleReasonModal(interaction);
    } catch (error) {
      console.error("Error en salidas de facción:", error);
      const response = { content: "No se pudo completar la gestión. Revisa permisos y jerarquía de roles.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.editReply(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    }
  });
}

module.exports = { name: "salidas de facción", commands: [], register };
