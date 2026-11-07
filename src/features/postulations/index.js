const { ActionRowBuilder, ComponentType, Events, SlashCommandBuilder, StringSelectMenuBuilder } = require("discord.js");
const { createJsonStore } = require("../../storage");

const commands = [
  new SlashCommandBuilder().setName("instruccionaprobada").setDescription("Aprueba la instrucción de un usuario.")
    .addUserOption((option) => option.setName("usuario").setDescription("Usuario aprobado.").setRequired(true)),
  new SlashCommandBuilder().setName("instruccionsuspensa").setDescription("Suspende la instrucción de un usuario.")
    .addUserOption((option) => option.setName("usuario").setDescription("Usuario suspenso.").setRequired(true))
];

const HEART = "<:corazon:1325652660556267580>";
const EMS = "<:_ems_:1325652657804677232>";
class UserFacingError extends Error {}

function register(client, rootConfig) {
  const config = rootConfig.postulations;
  const store = createJsonStore(rootConfig.dataDir, "postulations.json", { writtenRejections: {}, oralRejections: {} });

  function incrementRejection(type, userId) {
    const key = type === "oral" ? "oralRejections" : "writtenRejections";
    const data = store.read();
    data[key][userId] = (data[key][userId] || 0) + 1;
    store.write(data);
    return data[key][userId];
  }

  async function requireAnyRole(interaction, roleIds) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !roleIds.some((id) => member.roles.cache.has(id))) throw new UserFacingError(`${HEART} **No tienes permiso para usar este comando.**`);
  }

  async function target(interaction) {
    const user = interaction.options.getUser("usuario", true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) throw new UserFacingError(`${EMS} **No encuentro a ese usuario dentro del servidor.**`);
    return member;
  }

  async function addRoles(member, ids) {
    for (const id of ids.filter(Boolean)) if (!member.roles.cache.has(id)) await member.roles.add(id);
  }

  async function removeRoles(member, ids) {
    for (const id of ids.filter(Boolean)) if (member.roles.cache.has(id)) await member.roles.remove(id);
  }

  function attemptRole(ids, attempt) { return ids[Math.min(attempt, ids.length) - 1]; }

  async function announce(content) {
    const channel = await client.channels.fetch(config.announcementChannelId).catch(() => null);
    if (!channel?.isTextBased()) throw new UserFacingError(`${EMS} **No encuentro el canal de anuncios configurado.**`);
    await channel.send({ content, allowedMentions: { parse: ["users"], roles: [config.emsMentionRoleId] } });
  }

  async function handle(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const command = interaction.commandName;
    const member = await target(interaction);

    if (command === "aceptarescrita") {
      await requireAnyRole(interaction, config.writtenCommandRoleIds);
      await addRoles(member, config.writtenApprovedRoleIds);
      await announce(`${HEART} **¡Felicidades ${member}, su postulación escrita ha sido admitida!**\n\n${EMS} Por el canal correspondiente, **un <@&${config.emsMentionRoleId}> se pondrá en contacto** para establecer una **hora de instrucción**.`);
      return interaction.editReply(`${HEART} **Postulación escrita aprobada** para ${member}.`);
    }
    if (command === "rechazarpostulacion") {
      await requireAnyRole(interaction, config.writtenCommandRoleIds);
      const attempt = incrementRejection("written", member.id);
      await addRoles(member, [config.writtenRejectedBaseRoleId, attemptRole(config.writtenRejectedAttemptRoleIds, attempt)]);
      const reasons = {
        sanciones: `${EMS} **Cuentas con sanciones administrativas recientes.**\n${HEART} **Te animamos a mejorar y volver a intentarlo cuando sea posible.**`,
        edad: `${EMS} **No cuentas con la edad mínima.**\n${HEART} **Gracias por tu interés en EMS. Te esperamos más adelante.**`,
        plantilla: `${EMS} **La plantilla no está correctamente rellenada.**\n${HEART} **Revísala con calma y vuelve a enviarla cuando esté completa.**`
      };
      await announce(`${HEART} ${member} **POSTULACIÓN ESCRITA SUSPENSA** ${HEART}\n\n${reasons[interaction.options.getString("motivo", true)]}`);
      return interaction.editReply(`${HEART} **Postulación escrita rechazada** para ${member}.\n\n${EMS} **Rechazo escrito número ${attempt}.**`);
    }
    if (command === "instruccionaprobada") {
      await requireAnyRole(interaction, config.oralCommandRoleIds);
      await removeRoles(member, config.oralApprovalRemoveRoleIds);
      await addRoles(member, config.oralApprovedRoleIds);
      await announce(`${HEART} **¡Felicidades ${member} por aprobar su instrucción!**\n\n${EMS} **Bienvenido al cuerpo de EMS.**`);
      return interaction.editReply(`${HEART} **Instrucción aprobada** para ${member}.`);
    }
    await requireAnyRole(interaction, config.oralCommandRoleIds);
    await announce(`${EMS} **¡Lo sentimos, ${member}, no consiguió aprobar esta instrucción!**\n\n${HEART} **En la siguiente será. ¡ÁNIMO!**`);
    return interaction.editReply(`${HEART} **Instrucción suspensa** para ${member}. No se ha añadido ningún rol.`);
  }

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot) return;
    const match = message.content.trim().match(/^!(aceptar|rechazar)\s+<@!?(\d{17,20})>\s*$/i);
    if (!match) return;
    let response;
    let reason;
    const context = {
      guild: message.guild,
      user: message.author,
      commandName: match[1].toLowerCase() === "aceptar" ? "aceptarescrita" : "rechazarpostulacion",
      options: { getUser: () => ({ id: match[2] }), getString: () => reason },
      deferReply: async () => {},
      editReply: async (content) => {
        if (response) return response.edit({ content, components: [], allowedMentions: { parse: [] } });
        response = await message.reply({ content, allowedMentions: { parse: [] } });
        return response;
      }
    };
    try {
      await requireAnyRole(context, config.writtenCommandRoleIds);
      await target(context);
      if (context.commandName === "rechazarpostulacion") {
        response = await message.reply({
          content: `Selecciona el motivo del rechazo para <@${match[2]}>.`,
          allowedMentions: { parse: [] },
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`postulations:reject:${message.id}`)
              .setPlaceholder("Motivo del rechazo").addOptions(
                { label: "Sanciones administrativas", value: "sanciones" },
                { label: "Edad mínima insuficiente", value: "edad" },
                { label: "Plantilla mal rellenada", value: "plantilla" }
              )
          )]
        });
        let selection;
        try {
          selection = await response.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 120000,
            filter: (interaction) => {
              if (interaction.user.id === message.author.id) return true;
              interaction.reply({ content: "Solo quien ejecutó el comando puede elegir el motivo.", ephemeral: true }).catch(() => {});
              return false;
            }
          });
        } catch (error) {
          if (error.code !== "InteractionCollectorError") throw error;
          return context.editReply("La selección ha caducado. Ejecuta de nuevo `!rechazar @usuario`.");
        }
        reason = selection.values[0];
        await selection.deferUpdate();
      }
      await handle(context);
    } catch (error) {
      console.error("Error en postulaciones:", error);
      const content = error instanceof UserFacingError ? error.message : `${EMS} **Ha fallado el comando. Revisa permisos y jerarquía de roles.**`;
      await context.editReply(content).catch(() => {});
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || !commands.some((command) => command.name === interaction.commandName)) return;
    try { await handle(interaction); } catch (error) {
      console.error("Error en postulaciones:", error);
      const content = error instanceof UserFacingError ? error.message : `${EMS} **Ha fallado el comando. Revisa permisos y jerarquía de roles.**`;
      if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => {});
      else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  });
}

module.exports = { name: "postulaciones", commands, register };
