const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Events, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { createJsonStore } = require("../../storage");

const commands = [];

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

  async function publishInstructionTemplate(nameIc, member) {
    const channel = await client.channels.fetch(config.instructionTemplateChannelId).catch(() => null);
    if (!channel?.isTextBased()) throw new UserFacingError(`${EMS} **No encuentro el canal de plantillas de instrucción configurado.**`);
    await channel.send({
      content: `Nombre Ic: ${nameIc}\nDiscord Id: ${member.id}`,
      allowedMentions: { parse: [] }
    });
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

  }

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot) return;
    const match = message.content.trim().match(/^!(aceptar|rechazar|instruccion)\s+<@!?(\d{17,20})>\s*$/i);
    if (!match) return;
    let response;
    let reason;
    let privatePanel;
    let instructionModal;
    const context = {
      guild: message.guild,
      user: message.author,
      commandName: { aceptar: "aceptarescrita", rechazar: "rechazarpostulacion", instruccion: "instruccionaprobada" }[match[1].toLowerCase()],
      options: { getUser: () => ({ id: match[2] }), getString: () => reason },
      deferReply: async () => {},
      // Prefix commands leave only the final announcement in the server.
      editReply: async () => {}
    };
    async function notifyPrivately(content) {
      const notice = await message.author.send({ content, allowedMentions: { parse: [] } });
      const timer = setTimeout(() => notice.delete().catch(() => {}), 15000);
      timer.unref();
    }
    try {
      // Fail before changing roles if the command cannot be removed.
      await message.delete();
      await requireAnyRole(context, context.commandName === "instruccionaprobada" ? config.oralCommandRoleIds : config.writtenCommandRoleIds);
      await target(context);
      if (context.commandName === "rechazarpostulacion") {
        response = await message.channel.send({
          content: "Abre las opciones de rechazo.",
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`postulations:open:${message.id}`)
              .setLabel("Elegir motivo").setStyle(ButtonStyle.Primary)
          )]
        });
        const onlyExecutor = (interaction) => {
          if (interaction.user.id === message.author.id) return true;
          interaction.reply({ content: "Solo quien ejecutó el comando puede continuar.", ephemeral: true }).catch(() => {});
          return false;
        };
        let opener;
        try {
          opener = await response.awaitMessageComponent({ componentType: ComponentType.Button, time: 120000, filter: onlyExecutor });
        } catch (error) {
          if (error.code !== "InteractionCollectorError") throw error;
          return;
        }
        await opener.reply({
          ephemeral: true,
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
        privatePanel = opener;
        const menu = await opener.fetchReply();
        await response.delete();
        response = null;
        let selection;
        try {
          selection = await menu.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 120000,
            filter: onlyExecutor
          });
        } catch (error) {
          if (error.code !== "InteractionCollectorError") throw error;
          return;
        }
        reason = selection.values[0];
        await selection.deferUpdate();
        await opener.deleteReply();
        privatePanel = null;
      }
      if (context.commandName === "instruccionaprobada") {
        const targetMember = await target(context);
        try {
          const deliveryChannel = await client.channels.fetch(config.instructionDeliveryChannelId).catch(() => null);
          if (!deliveryChannel?.isTextBased()) throw new Error("Canal no válido");
          response = await deliveryChannel.send({
            content: `<@${targetMember.id}> 📋 Debes completar la plantilla obligatoria para finalizar tu instrucción EMS.`,
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`postulations:instruction:${message.id}`)
                .setLabel("Rellenar plantilla").setStyle(ButtonStyle.Primary)
            )],
            allowedMentions: { users: [targetMember.id] }
          });
          const timer = setTimeout(() => response.delete().catch(() => {}), 600000);
          timer.unref();
        } catch {
          throw new UserFacingError(`${EMS} **No puedo enviar la plantilla al canal configurado. Revisa los permisos del bot.**`);
        }
        const onlyTarget = (interaction) => {
          if (interaction.user.id === targetMember.id) return true;
          interaction.reply({ content: "Esta plantilla pertenece a otra persona.", ephemeral: true }).catch(() => {});
          return false;
        };
        let opener;
        try {
          opener = await response.awaitMessageComponent({ componentType: ComponentType.Button, time: 600000, filter: onlyTarget });
        } catch (error) {
          if (error.code !== "InteractionCollectorError") throw error;
          return;
        }
        const modal = new ModalBuilder().setCustomId(`postulations:instruction-form:${message.id}`)
          .setTitle("Plantilla de instrucción")
          .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("name-ic").setLabel("Nombre IC")
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
          ));
        await opener.showModal(modal);
        await response.edit({ content: `<@${targetMember.id}> La plantilla está abierta. Complétala antes de que caduque.`, components: [], allowedMentions: { users: [targetMember.id] } }).catch(() => {});
        response = null;
        try {
          instructionModal = await opener.awaitModalSubmit({ time: 300000, filter: onlyTarget });
        } catch (error) {
          if (error.code !== "InteractionCollectorError") throw error;
          return;
        }
        const nameIc = instructionModal.fields.getTextInputValue("name-ic").trim();
        await instructionModal.deferReply({ ephemeral: true });
        await publishInstructionTemplate(nameIc, targetMember);
        await handle(context);
        await instructionModal.editReply(`${HEART} **Plantilla registrada e instrucción aprobada correctamente.**`);
        return;
      }
      await handle(context);
    } catch (error) {
      console.error("Error en postulaciones:", error);
      const content = error instanceof UserFacingError ? error.message : `${EMS} **Ha fallado el comando. Revisa permisos y jerarquía de roles.**`;
      if (instructionModal?.deferred || instructionModal?.replied) {
        await instructionModal.editReply({ content }).catch(() => {});
      } else {
        await notifyPrivately(content).catch((notificationError) => {
          console.error("No se pudo enviar el aviso privado de postulaciones:", notificationError);
        });
      }
    } finally {
      if (privatePanel) await privatePanel.deleteReply().catch(() => {});
      if (response) await response.delete().catch(() => {});
    }
  });

}

module.exports = { name: "postulaciones", commands, register };
