const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { createJsonStore } = require("../../storage");
const emsLogo = require("./logo");

const START_BUTTON_ID = "ems-questionnaire:start";
const NEXT_BUTTON_ID = "ems-questionnaire:next";
const ANSWER_MODAL_ID = "ems-questionnaire:answer";
const LOGO_ATTACHMENT_NAME = "ems-postulacion-logo.png";

const questions = [
  { key: "icName", label: "Nombre IC", prompt: "¿Cuál es tu nombre IC?", style: TextInputStyle.Short, maxLength: 80 },
  { key: "oocAge", label: "Edad OOC", prompt: "¿Cuál es tu edad OOC?", style: TextInputStyle.Short, maxLength: 30 },
  { key: "serverTime", label: "Tiempo en el servidor", prompt: "¿Cuánto tiempo llevas en el servidor?", style: TextInputStyle.Short, maxLength: 150 },
  { key: "whyEms", label: "¿Por qué te gustaría ser EMS?", prompt: "Cuéntanos por qué te gustaría ser EMS.", style: TextInputStyle.Paragraph, maxLength: 1000 },
  { key: "administrativeSanctions", label: "¿Tienes sanciones administrativas?", prompt: "Indica si tienes sanciones administrativas y explícalas si corresponde.", style: TextInputStyle.Paragraph, maxLength: 1000 }
];

function register(client, rootConfig) {
  const config = rootConfig.emsQuestionnaire;
  const store = createJsonStore(rootConfig.dataDir, "ems-questionnaire.json", { panelMessageId: null });
  const sessions = new Map();

  function buildQuestionModal(index) {
    const question = questions[index];
    return new ModalBuilder()
      .setCustomId(ANSWER_MODAL_ID)
      .setTitle(`Plantilla EMS — ${index + 1}/${questions.length}`)
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(question.label)
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId("answer")
              .setStyle(question.style)
              .setPlaceholder(question.prompt)
              .setRequired(true)
              .setMaxLength(question.maxLength)
          )
      );
  }

  async function publishPanel() {
    const channel = await client.channels.fetch(config.panelChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal del cuestionario EMS no es válido.");

    const embed = new EmbedBuilder()
      .setTitle("¿QUIERES POSTULAR A EMS?")
      .setDescription("Estás a punto de iniciar el procedimiento de postulación escrita para ser parte EMS.\n\n**Requisitos**\n‣ No tener sanciones administrativas graves.\n‣ No estar en Blacklist de facciones legales.\n‣ Tener mínimo 16 años.")
      .setColor(0x7b1113)
      .setThumbnail(`attachment://${LOGO_ATTACHMENT_NAME}`);
    const components = [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(START_BUTTON_ID)
        .setLabel("📝 Iniciar Postulación")
        .setStyle(ButtonStyle.Success)
    )];

    const data = store.read();
    if (data.panelMessageId) {
      const existing = await channel.messages.fetch(data.panelMessageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed], components, files: [{ attachment: Buffer.from(emsLogo, "base64"), name: LOGO_ATTACHMENT_NAME }] });
        console.log(`Panel del cuestionario EMS actualizado en el canal ${config.panelChannelId}.`);
        return;
      }
    }

    const message = await channel.send({ embeds: [embed], components, files: [{ attachment: Buffer.from(emsLogo, "base64"), name: LOGO_ATTACHMENT_NAME }] });
    data.panelMessageId = message.id;
    store.write(data);
    console.log(`Panel del cuestionario EMS publicado en el canal ${config.panelChannelId}.`);
  }

  async function startQuestionnaire(interaction) {
    sessions.set(interaction.user.id, { index: 0, answers: {}, startedAt: Date.now(), progressMessageCreated: false });
    await interaction.showModal(buildQuestionModal(0));
  }

  async function continueQuestionnaire(interaction) {
    const session = sessions.get(interaction.user.id);
    if (!session || session.index >= questions.length) {
      return interaction.reply({ content: "El formulario ha caducado. Pulsa de nuevo RELLENAR PLANTILLA EMS.", ephemeral: true });
    }
    await interaction.showModal(buildQuestionModal(session.index));
  }

  async function publishAnswers(interaction, session) {
    const channel = await client.channels.fetch(config.outputChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal de resultados del cuestionario EMS no es válido.");

    const embed = new EmbedBuilder()
      .setTitle("PLANTILLA OBLIGATORIA EMS")
      .setColor(0xc0392b)
      .setDescription(`Postulación enviada por **${interaction.user.tag}**.`)
      .addFields(questions.map((question) => ({
        name: `→ ${question.label}:`,
        value: session.answers[question.key].slice(0, 1024)
      })))
      .setTimestamp();

    await channel.send({
      content: `Usuario: <@${interaction.user.id}>\nDiscord: **${interaction.user.tag}**\nID: \`${interaction.user.id}\``,
      embeds: [embed],
      allowedMentions: { users: [interaction.user.id] }
    });
  }

  async function handleAnswer(interaction) {
    const session = sessions.get(interaction.user.id);
    if (!session || session.index >= questions.length) {
      return interaction.reply({ content: "El formulario ha caducado. Pulsa de nuevo RELLENAR PLANTILLA EMS.", ephemeral: true });
    }

    const question = questions[session.index];
    session.answers[question.key] = interaction.fields.getTextInputValue("answer").trim();
    session.index += 1;

    if (session.index < questions.length) {
      const nextQuestion = questions[session.index];
      const response = {
        content: `Respuesta guardada (**${session.index}/${questions.length}**). Siguiente: **${nextQuestion.prompt}**`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(NEXT_BUTTON_ID).setLabel("SIGUIENTE PREGUNTA").setStyle(ButtonStyle.Success)
        )]
      };
      if (session.progressMessageCreated && interaction.isFromMessage()) {
        return interaction.update(response);
      }
      session.progressMessageCreated = true;
      return interaction.reply({ ...response, ephemeral: true });
    }

    if (session.progressMessageCreated && interaction.isFromMessage()) await interaction.deferUpdate();
    else await interaction.deferReply({ ephemeral: true });
    await publishAnswers(interaction, session);
    sessions.delete(interaction.user.id);
    await interaction.editReply({ content: "Plantilla enviada correctamente. ¡Gracias!", components: [] });
  }

  client.once(Events.ClientReady, () => {
    publishPanel().catch((error) => console.error("No se pudo publicar el cuestionario EMS:", error));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === START_BUTTON_ID) return startQuestionnaire(interaction);
      if (interaction.isButton() && interaction.customId === NEXT_BUTTON_ID) return continueQuestionnaire(interaction);
      if (interaction.isModalSubmit() && interaction.customId === ANSWER_MODAL_ID) return handleAnswer(interaction);
    } catch (error) {
      console.error("Error en el cuestionario EMS:", error);
      const response = { content: "No se pudo completar la plantilla. Inténtalo de nuevo.", ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.editReply(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    }
  });
}

module.exports = { name: "cuestionario EMS", commands: [], register };
