const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, Events,
  LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");

const OUTPUT_CHANNEL_ID = "1129103844517888131";
const NOTIFY_ROLE_ID = "1129103460361576589";
const ALLOWED_ROLE_ID = "1129103467294769214";
const BUTTON_PREFIX = "rank-request:open:";
const MODAL_PREFIX = "rank-request:form:";
const RANKS = [
  "Director/a general", "Director/a", "Subdirector/a", "Jefe/a", "Subjefe/a",
  "Jefe/a Doctores", "Doctor/a Experto/a", "Doctor/a", "Médicos Adscritos",
  "Medico Residente", "Medico Pasante", "Médico Interno", "Paramédico",
  "Enfermero/a", "Enfermero/a Aprendiz"
].map((label, index) => ({ label, grade: String(14 - index) }));

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
    let token;
    try {
      const requester = await message.guild.members.fetch(message.author.id);
      if (!requester.roles.cache.has(ALLOWED_ROLE_ID)) {
        await message.delete();
        await message.author.send("No tienes permiso para usar `!rango`.").catch(() => {});
        return;
      }
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
      token = `${message.id}:${message.author.id}`;
      const modalId = `${MODAL_PREFIX}${token}`;
      sessions.set(token, { userId: message.author.id, expiresAt: Date.now() + 300000 });
      const modal = new ModalBuilder().setCustomId(modalId)
        .setTitle("Solicitud de rango IC")
        .addLabelComponents(
          new LabelBuilder().setLabel("Rango IC").setStringSelectMenuComponent(
            new StringSelectMenuBuilder().setCustomId("rank")
              .setPlaceholder("Selecciona tu rango IC").setRequired(true)
              .setMinValues(1).setMaxValues(1)
              .addOptions(RANKS.map((rank) => ({ label: rank.label, value: rank.grade })))
          ),
          new LabelBuilder().setLabel("ID").setTextInputComponent(
            new TextInputBuilder().setCustomId("id")
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
          )
        );
      await opener.showModal(modal);
      await prompt.delete().catch(() => {});
      prompt = null;
      let submission;
      try {
        submission = await opener.awaitModalSubmit({ time: 300000, filter: (interaction) => interaction.customId === modalId && onlyRequester(interaction) });
      } catch (error) {
        if (error.code === "InteractionCollectorError") return;
        throw error;
      }
      const session = sessions.get(token);
      sessions.delete(token);
      if (!session || session.userId !== submission.user.id || Date.now() >= session.expiresAt) {
        return submission.reply({ content: "El formulario ha caducado. Ejecuta !rango de nuevo.", ephemeral: true });
      }
      const selected = submission.fields.getStringSelectValues("rank");
      const rank = selected.length === 1 ? RANKS.find((item) => item.grade === selected[0]) : null;
      if (!rank) return submission.reply({ content: "Selecciona un rango válido del desplegable.", ephemeral: true });
      await submission.deferReply({ ephemeral: true });
      const id = submission.fields.getTextInputValue("id").trim();
      await publishRequest(submission, `${rank.label} // ambulance ${rank.grade}`, id);
      await submission.editReply("✅ Solicitud de rango enviada correctamente.");
    } catch (error) {
      console.error("Error en !rango:", error);
      message.author.send("No se pudo enviar tu solicitud de rango. Inténtalo de nuevo.").catch(() => {});
    } finally {
      if (token) sessions.delete(token);
      if (prompt) await prompt.delete().catch(() => {});
    }
  });
}

module.exports = { name: "solicitudes de rango", commands: [], register };
