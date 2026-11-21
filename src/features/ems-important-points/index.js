const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");
const helicopterGarageImage = require("./helicopter-garage-image");
const ambulanceGarageImage = require("./ambulance-garage-image");
const medicalLockerImage = require("./medical-locker-combined-image");
const lockerRoomImage = require("./locker-room-image");
const policeTabletImage = require("./police-tablet-image");
const radioImage = require("./radio-image");
const referencesImage = require("./references-image");

const MAIN_CHANNEL_ID = "1573737316068098098";
const OPERATIONS_CHANNEL_ID = "1573736946054725652";
const COLOR = 0x7b1113;
const FOOTER = "Doctor Salidorro EMS - LaNaranjaRP🍊 · Puntos importantes EMS";

const POINTS = [
  {
    key: "helicopterGarage",
    title: "🚁 GARAJE DE HELICÓPTEROS",
    description: "**Solo la unidad UEA puede sacar helicópteros.**",
    imageName: "punto-garaje-helicopteros.jpg",
    image: helicopterGarageImage,
    channelId: MAIN_CHANNEL_ID
  },
  {
    key: "ambulanceGarage",
    title: "🚑 GARAJE DE AMBULANCIAS Y MOTOS",
    description: "**Las motos son exclusivas de UEM; usa la ambulancia que corresponde a tu rango según <#1493633203116708081>.**",
    imageName: "punto-garaje-ambulancias.jpg",
    image: ambulanceGarageImage,
    channelId: MAIN_CHANNEL_ID
  },
  {
    key: "medicalLocker",
    title: "🗄️ ARMARIO DE MATERIAL MÉDICO",
    description: "**1.** Comprar items\n**2.** Armario personal de cada EMS\n**3.** Inventario colectivo de todas las facciones — **NO USAR**",
    imageName: "punto-armario-medico.jpg",
    image: medicalLockerImage,
    channelId: MAIN_CHANNEL_ID
  },
  {
    key: "lockerRoom",
    title: "👕 VESTUARIO",
    description: "**Zona destinada a cambiar o crear uniformes.**",
    imageName: "punto-vestuario.jpg",
    image: lockerRoomImage,
    channelId: MAIN_CHANNEL_ID
  },
  {
    key: "policeTablet",
    title: "📱 TABLET POLICIAL",
    description: "**Para entrar o salir de servicio con el botón verde Servicio y acceder a la radio interna.**",
    imageName: "punto-tablet-policial.jpg",
    image: policeTabletImage,
    channelId: OPERATIONS_CHANNEL_ID,
    previousChannelId: MAIN_CHANNEL_ID
  },
  {
    key: "radio",
    title: "📻 RADIO",
    description: "**Usa la frecuencia 20 e indica tu rango y nombre IC.**",
    imageName: "punto-radio.jpg",
    image: radioImage,
    channelId: OPERATIONS_CHANNEL_ID,
    previousChannelId: MAIN_CHANNEL_ID
  },
  {
    key: "references",
    title: "📍 REFERENCIAS",
    description: "**En F7 → Referencias, selecciona el icono y color que corresponda.**",
    imageName: "punto-referencias.jpg",
    image: referencesImage,
    channelId: OPERATIONS_CHANNEL_ID,
    previousChannelId: MAIN_CHANNEL_ID
  }
];

function buildEmbed(point) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(point.title)
    .setDescription(point.description)
    .setImage("attachment://" + point.imageName)
    .setFooter({ text: FOOTER });
}

function register(client, config) {
  const store = createJsonStore(config.dataDir, "ems-important-points.json", { messageIds: {} });

  async function publishPoint(point) {
    const channel = await client.channels.fetch(point.channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
      throw new Error("Canal de puntos importantes EMS no válido.");
    }
    const data = store.read();
    const messageIds = data.messageIds || {};
    const oldMessage = messageIds[point.key]
      ? await channel.messages.fetch(messageIds[point.key]).catch(() => null)
      : null;

    if (point.previousChannelId && messageIds[point.key]) {
      const previousChannel = await client.channels.fetch(point.previousChannelId).catch(() => null);
      const previousMessage = previousChannel?.isTextBased()
        ? await previousChannel.messages.fetch(messageIds[point.key]).catch(() => null)
        : null;
      if (previousMessage) await previousMessage.delete().catch(() => null);
    }

    const embeds = [buildEmbed(point)];
    const files = [{ attachment: Buffer.from(point.image, "base64"), name: point.imageName }];

    if (point.extraImage) {
      embeds.push(
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(point.extraTitle)
          .setImage("attachment://" + point.extraImageName)
          .setFooter({ text: FOOTER })
      );
      files.push({ attachment: Buffer.from(point.extraImage, "base64"), name: point.extraImageName });
    }

    if (oldMessage) await oldMessage.delete().catch(() => null);
    const message = await channel.send({ embeds, files, allowedMentions: { parse: [] } });
    store.write({ ...data, messageIds: { ...messageIds, [point.key]: message.id } });
  }

  async function publish() {
    for (const point of POINTS) {
      await publishPoint(point);
    }
  }

  client.once(Events.ClientReady, () => publish().catch((error) => {
    console.error("No se pudieron publicar los puntos importantes EMS:", error);
  }));
}

module.exports = { name: "puntos importantes EMS", commands: [], register };
