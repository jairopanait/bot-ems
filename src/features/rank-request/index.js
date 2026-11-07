const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, Events,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const { sendCommandLog } = require("../command-logs");

const OUTPUT_CHANNEL_ID = "1129103844517888131";
const NOTIFY_ROLE_ID = "1129103460361576589";
const BUTTON_PREFIX = "rank-request:open:";
const MODAL_PREFIX = "rank-request:form:";

function register(client, config) {
  const sessions = new Map();

  async function publishRequest(interaction, rango, id) {
    const channel = await client.channels.fetch(OUTPUT_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal de solicitudes de rango no válido.");
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: "Doctor Salidorro EMS · Solicitudes" })
      .setTitle("📨 Nueva solicitud de rango IC")
      .setDescription("Se ha recibido una nueva solicitud para revisar.")
      .addFields(
        { name: "👤 Persona que lo solicita", value: `<@${interaction.user.id}> · ${interaction.user.tag}`, inline: false },
        { name: "🎖️ Rango solicitado", value: rango, inline: true },
        { name: "🆔 ID", value: `\`${id}\``, inline: true }
      )
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊" })
      .setTimestamp();
    await channel.send({
      content: `<@&${NOTIFY_ROLE_ID}>`,
      embeds: [embed],
      allowedMentions: { roles: [NOTIFY_ROLE_ID] }
    });
  }

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot || !/^!rango\s*$/i.test(message.content.trim())) return;
    let prompt;
    try {
      await message.delete();
      prompt = await message.channel.send({
        content: `<@${message.author.id}> abre el formulario para solicitar tu rango IC.`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}${message.id}`).setLabel("Solicitar rango").setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: { users: [message.author.id] }
      });
      const onlyRequester = (interaction) => {
        if (interaction.user.id === message.author.id) return true;
        interaction.reply({ content: "Esta solicitud pertenece a otra persona.", ephemeral: true }).catch(() => {});
        return false;
      };
      let opener;
      try {
        opener = await prompt.awaitMessageComponent({ componentType: ComponentType.Button, time: 300000, filter: onlyRequester });
      } catch (error) {
        if (error.code === "InteractionCollectorError") return;
        throw error;
      }
      const token = `${message.id}:${message.author.id}`;
      sessions.set(token, { userId: message.author.id, expiresAt: Date.now() + 300000 });
      const modal = new ModalBuilder().setCustomId(`${MODAL_PREFIX}${token}`)
        .setTitle("Solicitud de rango IC")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("rank").setLabel("Rango IC")
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("id").setLabel("ID")
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
          )
        );
      await opener.showModal(modal);
      await prompt.delete().catch(() => {});
      prompt = null;
      let submission;
      try {
        submission = await opener.awaitModalSubmit({ time: 300000, filter: onlyRequester });
      } catch (error) {
        if (error.code === "InteractionCollectorError") return;
        throw error;
      }
      const session = sessions.get(token);
      sessions.delete(token);
      if (!session || session.userId !== submission.user.id || Date.now() >= session.expiresAt) {
        return submission.reply({ content: "El formulario ha caducado. Ejecuta !rango de nuevo.", ephemeral: true });
      }
      await submission.deferReply({ ephemeral: true });
      const rango = submission.fields.getTextInputValue("rank").trim();
      const id = submission.fields.getTextInputValue("id").trim();
      await publishRequest(submission, rango, id);
      await sendCommandLog(client, config, {
        executorId: submission.user.id,
        targetIds: [],
        command: `!rango · Rango: ${rango}`,
        createdAt: new Date(),
        guildId: submission.guildId
      });
      await submission.editReply("✅ Solicitud de rango enviada correctamente.");
    } catch (error) {
      console.error("Error en !rango:", error);
      if (prompt) await prompt.delete().catch(() => {});
      message.author.send("No se pudo enviar tu solicitud de rango. Inténtalo de nuevo.").catch(() => {});
    }
  });
}

module.exports = { name: "solicitudes de rango", commands: [], register };
