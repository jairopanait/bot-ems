const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");
const receptionImage = require("./reception-image");
const floor2Image = require("./floor2-image");
const icuImage = require("./icu-image");
const rayosXImage = require("./rayosx-image");
const tomografiaImage = require("./tomografia-image");
const cirugiaImage = require("./cirugia-image");
const morgueImage = require("./morgue-image");
const ascensorHelipuertoImage = require("./ascensor-helipuerto-image");

const CHANNEL_ID = "1573736527434088571";

const LOCATIONS = [
  {
    messageKey: "receptionMessageId",
    title: "🏥 RECEPCIÓN",
    description: "**Acceso a vestuarios y armarios personales.**",
    fileName: "ubicacion-recepcion.jpg",
    image: receptionImage
  },
  {
    messageKey: "floor2MessageId",
    title: "🏢 2ª PLANTA",
    description: "**Planta que reúne Cuidados Intensivos, Rayos X, Tomografía y Quirófanos.**",
    fileName: "ubicacion-segunda-planta.jpg",
    image: floor2Image
  },
  {
    messageKey: "icuMessageId",
    title: "🩺 CUIDADOS INTENSIVOS",
    description: "**Atención y vigilancia de pacientes en periodo postoperatorio.**",
    fileName: "ubicacion-cuidados-intensivos.jpg",
    image: icuImage
  },
  {
    messageKey: "rayosXMessageId",
    title: "🩻 RAYOS X",
    description: "**Diagnóstico de lesiones mediante estudios radiográficos.**",
    fileName: "ubicacion-rayos-x.jpg",
    image: rayosXImage
  },
  {
    messageKey: "tomografiaMessageId",
    title: "🧠 TOMOGRAFÍA",
    description: "**Obtención de imágenes detalladas para evaluar el estado del paciente.**",
    fileName: "ubicacion-tomografia.jpg",
    image: tomografiaImage
  },
  {
    messageKey: "cirugiaMessageId",
    title: "🩺 SALA DE CIRUGÍA",
    description: "**Espacio destinado a intervenciones quirúrgicas.**",
    fileName: "ubicacion-cirugia.jpg",
    image: cirugiaImage
  },
  {
    messageKey: "morgueMessageId",
    title: "⚰️ MORGUE",
    description: "**Custodia temporal de personas fallecidas.**",
    fileName: "ubicacion-morgue.jpg",
    image: morgueImage
  },
  {
    messageKey: "ascensorHelipuertoMessageId",
    title: "🛗 ASCENSOR HELIPUERTO",
    description: "**Acceso para traslados aéreos desde y hacia el helipuerto.**",
    fileName: "ubicacion-ascensor-helipuerto.jpg",
    image: ascensorHelipuertoImage
  }
];

function register(client, config) {
  const store = createJsonStore(config.dataDir, "hospital-locations.json", {});

  async function publishLocation(channel, location) {
    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle(location.title)
      .setDescription(location.description)
      .setImage("attachment://" + location.fileName)
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊 · Ubicaciones del hospital" });

    const payload = {
      embeds: [embed],
      files: [{ attachment: Buffer.from(location.image, "base64"), name: location.fileName }],
      allowedMentions: { parse: [] }
    };

    const data = store.read();
    const existing = data[location.messageKey]
      ? await channel.messages.fetch(data[location.messageKey]).catch(() => null)
      : null;

    // Discord no siempre adjunta archivos nuevos al editar mensajes existentes.
    // Se publica uno nuevo para garantizar que la foto se vea.
    if (existing) await existing.delete().catch(() => null);
    const message = await channel.send(payload);
    store.write({ ...data, [location.messageKey]: message.id });
  }

  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
      throw new Error("Canal de ubicaciones del hospital no válido.");
    }

    for (const location of LOCATIONS) {
      await publishLocation(channel, location);
    }
  }

  client.once(Events.ClientReady, () => publish().catch((error) => {
    console.error("No se pudieron publicar las ubicaciones del hospital:", error);
  }));
}

module.exports = { name: "ubicaciones del hospital", commands: [], register };
