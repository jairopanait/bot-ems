const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");
const receptionImage = require("./reception-image");
const floor2Image = require("./floor2-image");
const icuImage = require("./icu-image");

const CHANNEL_ID = "1573736527434088571";
const RECEPTION_IMAGE_NAME = "ubicacion-recepcion.jpg";
const FLOOR2_IMAGE_NAME = "ubicacion-segunda-planta.jpg";
const ICU_IMAGE_NAME = "ubicacion-cuidados-intensivos.jpg";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "hospital-locations.json", {
    receptionMessageId: null,
    floor2MessageId: null,
    icuMessageId: null
  });

  async function publishLocation({ messageKey, title, description, fileName, image }) {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
      throw new Error("Canal de ubicaciones del hospital no válido.");
    }

    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle(title)
      .setDescription(description)
      .setImage("attachment://" + fileName)
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊 · Ubicaciones del hospital" });

    const payload = {
      embeds: [embed],
      files: [{ attachment: Buffer.from(image, "base64"), name: fileName }],
      allowedMentions: { parse: [] }
    };

    const data = store.read();
    const existing = data[messageKey]
      ? await channel.messages.fetch(data[messageKey]).catch(() => null)
      : null;

    // Discord no siempre adjunta archivos nuevos al editar mensajes existentes.
    // Se publica uno nuevo para garantizar que la foto se vea.
    if (existing) await existing.delete().catch(() => null);
    const message = await channel.send(payload);
    store.write({ ...data, [messageKey]: message.id });
  }

  async function publish() {
    await publishLocation({
      messageKey: "receptionMessageId",
      title: "🏥 RECEPCIÓN",
      description: "**Acceso a vestuarios y armarios personales**\n\nEs la puerta por donde entramos a los vestuarios y armarios personales.",
      fileName: RECEPTION_IMAGE_NAME,
      image: receptionImage
    });

    await publishLocation({
      messageKey: "floor2MessageId",
      title: "🏢 2ª PLANTA",
      description: "**Cuidados intensivos, Rayos X, tomografías y quirófanos**\n\nEn esta planta se encuentran las áreas de **Cuidados Intensivos**, **Rayos X**, **Tomografías** y **Quirófanos**.",
      fileName: FLOOR2_IMAGE_NAME,
      image: floor2Image
    });

    await publishLocation({
      messageKey: "icuMessageId",
      title: "🩺 CUIDADOS INTENSIVOS",
      description: "**Área para pacientes postoperatorios**\n\nSala destinada a la atención y vigilancia de pacientes en periodo **postoperatorio**.",
      fileName: ICU_IMAGE_NAME,
      image: icuImage
    });
  }

  client.once(Events.ClientReady, () => publish().catch((error) => {
    console.error("No se pudieron publicar las ubicaciones del hospital:", error);
  }));
}

module.exports = { name: "ubicaciones del hospital", commands: [], register };
