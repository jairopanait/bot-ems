const { Events, SlashCommandBuilder } = require("discord.js");
const { createJsonStore } = require("../../storage");

const commands = [
  new SlashCommandBuilder().setName("aceptarescrita").setDescription("Aprueba la postulación escrita de un usuario.")
    .addUserOption((option) => option.setName("usuario").setDescription("Usuario aprobado.").setRequired(true)),
  new SlashCommandBuilder().setName("rechazarpostulacion").setDescription("Rechaza la postulación escrita de un usuario.")
    .addUserOption((option) => option.setName("usuario").setDescription("Usuario rechazado.").setRequired(true))
    .addStringOption((option) => option.setName("motivo").setDescription("Motivo del rechazo.").setRequired(true).addChoices(
      { name: "Sanciones administrativas", value: "sanciones" },
      { name: "Edad mínima insuficiente", value: "edad" },
      { name: "Plantilla mal rellenada", value: "plantilla" }
    )),
  new SlashCommandBuilder().setName("aceptaroral").setDescription("Aprueba la entrevista oral de un usuario.")
    .addUserOption((option) => option.setName("usuario").setDescription("Usuario aprobado.").setRequired(true)),
  new SlashCommandBuilder().setName("rechazaroral").setDescription("Rechaza la entrevista oral de un usuario.")
    .addUserOption((option) => option.setName("usuario").setDescription("Usuario rechazado.").setRequired(true))
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
      await announce(`${HEART} ${HEART} ${member} **POSTULACIÓN ESCRITA APROBADA** ${HEART} ${HEART}\n\n${EMS} **Contacta con <@&${config.emsMentionRoleId}> para hacer el examen oral.**\n\n${HEART} **Gracias por querer formar parte de EMS.**`);
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
    if (command === "aceptaroral") {
      await requireAnyRole(interaction, config.oralCommandRoleIds);
      await removeRoles(member, config.oralApprovalRemoveRoleIds);
      await addRoles(member, config.oralApprovedRoleIds);
      await announce(`${HEART} ${EMS} ${member} **POSTULACIÓN ORAL APROBADA** ${EMS} ${HEART}\n\n${HEART} **¡Felicidades! Bienvenido a EMS.**\n${HEART} **Nos encanta tenerte con nosotros. Mucha suerte en esta nueva etapa.**`);
      return interaction.editReply(`${HEART} **Entrevista oral aprobada** para ${member}.`);
    }
    await requireAnyRole(interaction, config.oralCommandRoleIds);
    const attempt = incrementRejection("oral", member.id);
    await addRoles(member, [attemptRole(config.oralRejectedAttemptRoleIds, attempt)]);
    await announce(`${HEART} ${member} **ENTREVISTA ORAL SUSPENSA** ${HEART}\n\n${EMS} **Inténtalo de nuevo en 24h.**\n${HEART} **No te desanimes, puedes prepararte y volver con más fuerza.**`);
    return interaction.editReply(`${HEART} **Entrevista oral rechazada** para ${member}.\n\n${EMS} **Rechazo oral número ${attempt}.**`);
  }

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
