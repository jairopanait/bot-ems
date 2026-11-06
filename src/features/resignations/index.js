const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const REASON_BUTTON_PREFIX = "resignation:reason:";
const REASON_MODAL_PREFIX = "resignation:reason-modal:";
const BLACKLIST_SELECT_PREFIX = "resignation:blacklist:";

function register(client, rootConfig) {
  const config = rootConfig.resignations;
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
    return `\`\`\`Código de discord: ${member.user.username}\n// ${member.id}\nFecha de salida de la facción: ${formatDate(date)}\nMotivo de la salida: ${reason}\nBlacklisted: ${blacklisted}\`\`\``;
  }

  function hasPermission(member) {
    return config.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
  }

  function getSession(interaction, prefix) {
    const controlMessageId = interaction.customId.slice(prefix.length);
    const session = sessions.get(controlMessageId);
    if (!session) return { controlMessageId, session: null };
    if (session.executorId !== interaction.user.id) return { controlMessageId, session: null, unauthorized: true };
    return { controlMessageId, session };
  }

  async function publishTemplate(session, member) {
    const content = template(member, session.commandMessage.createdAt, session.reason, session.blacklisted);
    const outputChannel = await session.commandMessage.guild.channels.fetch(config.outputChannelId);
    if (!outputChannel?.isTextBased()) throw new Error("El canal de salidas de renuncias no es válido.");
    await outputChannel.send({ content, allowedMentions: { parse: [] } });
    if (session.commandMessage.channelId !== config.outputChannelId) {
      await session.commandMessage.channel.send({ content, allowedMentions: { parse: [] } });
    }
  }

  async function completeResignation(session) {
    const guild = session.commandMessage.guild;
    const me = guild.members.me ?? await guild.members.fetchMe();
    const required = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageNicknames, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    if (!me.permissions.has(required)) throw new Error("Al bot le faltan permisos para gestionar roles, apodos o mensajes.");
    const member = await guild.members.fetch(session.targetUserId);
    const roles = [...new Set([...config.preservedRoleIds, config.exitRoleId])];
    await member.roles.set(roles, `Renuncia gestionada por ${session.executorTag}`);
    await member.setNickname(null, `Renuncia gestionada por ${session.executorTag}`);
    await publishTemplate(session, member);
  }

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot) return;
    const match = message.content.trim().match(/^!renuncia\s+<@!?(\d{17,20})>\s*$/i);
    if (!match) return;

    const executor = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!executor || !hasPermission(executor)) {
      await message.reply("No tienes permiso para usar `!renuncia`.");
      return;
    }
    const target = await message.guild.members.fetch(match[1]).catch(() => null);
    if (!target) {
      await message.reply("No encuentro a ese usuario dentro del servidor.");
      return;
    }

    const control = await message.reply({
      content: `Gestión de renuncia para ${target}. Pulsa para escribir el motivo.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${REASON_BUTTON_PREFIX}${message.id}`).setLabel("ESCRIBIR MOTIVO").setStyle(ButtonStyle.Primary)
      )]
    });
    sessions.set(message.id, {
      executorId: message.author.id,
      executorTag: message.author.tag,
      targetUserId: target.id,
      commandMessage: message,
      controlMessageId: control.id
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;
    try {
      if (interaction.isButton() && interaction.customId.startsWith(REASON_BUTTON_PREFIX)) {
        const { controlMessageId, session, unauthorized } = getSession(interaction, REASON_BUTTON_PREFIX);
        if (unauthorized) return interaction.reply({ content: "Solo quien ejecutó el comando puede continuar.", ephemeral: true });
        if (!session) return interaction.reply({ content: "Esta gestión ha caducado. Ejecuta de nuevo el comando.", ephemeral: true });
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(`${REASON_MODAL_PREFIX}${controlMessageId}`)
            .setTitle("Motivo de la renuncia")
            .addComponents(new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("reason").setLabel("Motivo de la salida").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
            ))
        );
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith(REASON_MODAL_PREFIX)) {
        const { controlMessageId, session, unauthorized } = getSession(interaction, REASON_MODAL_PREFIX);
        if (unauthorized) return interaction.reply({ content: "Solo quien ejecutó el comando puede continuar.", ephemeral: true });
        if (!session) return interaction.reply({ content: "Esta gestión ha caducado. Ejecuta de nuevo el comando.", ephemeral: true });
        session.reason = interaction.fields.getTextInputValue("reason").trim();
        return interaction.reply({
          content: "¿Tiene blacklist?",
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`${BLACKLIST_SELECT_PREFIX}${controlMessageId}`)
              .setPlaceholder("Selecciona una opción")
              .addOptions({ label: "No", value: "no" }, { label: "Sí", value: "sí" })
          )],
          ephemeral: true
        });
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith(BLACKLIST_SELECT_PREFIX)) {
        const { controlMessageId, session, unauthorized } = getSession(interaction, BLACKLIST_SELECT_PREFIX);
        if (unauthorized) return interaction.reply({ content: "Solo quien ejecutó el comando puede continuar.", ephemeral: true });
        if (!session) return interaction.reply({ content: "Esta gestión ha caducado. Ejecuta de nuevo el comando.", ephemeral: true });
        session.blacklisted = interaction.values[0];
        await interaction.deferUpdate();
        await completeResignation(session);
        sessions.delete(controlMessageId);
        await interaction.editReply({ content: "Renuncia registrada correctamente.", components: [] });
        const control = await session.commandMessage.channel.messages.fetch(session.controlMessageId).catch(() => null);
        if (control) await control.edit({ content: `Renuncia de <@${session.targetUserId}> registrada correctamente.`, components: [] });
      }
    } catch (error) {
      console.error("Error en renuncias:", error);
      const response = { content: "No se pudo registrar la renuncia. Revisa permisos y jerarquía de roles.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.editReply(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    }
  });
}

module.exports = { name: "renuncias", commands: [], register };
