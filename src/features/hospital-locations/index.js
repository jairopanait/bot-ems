const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");
const receptionImage = require("./reception-image");

const CHANNEL_ID = "1573736527434088571";
const RECEPTION_IMAGE_NAME = "ubicacion-recepcion.jpg";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "hospital-locations.json", { receptionMessageId: null });

  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal de ubicaciones del hospital no válido.");
    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("🏥 RECEPCIÓN")
      .setDescription("**Acceso a vestuarios y armarios personales**\n\nEs la puerta por donde entramos a los vestuarios y armarios personales.")
      .setImage("attachment://" + RECEPTION_IMAGE_NAME)
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊 · Ubicaciones del hospital" });
    const payload = {
      embeds: [embed],
      files: [{ attachment: Buffer.from(receptionImage, "base64"), name: RECEPTION_IMAGE_NAME }],
      allowedMentions: { parse: [] }
    };
    const data = store.read();
    const existing = data.receptionMessageId ? await channel.messages.fetch(data.receptionMessageId).catch(() => null) : null;
    // Al adjuntar una imagen, Discord no siempre incorpora archivos nuevos al editar
    // mensajes ya existentes. Se publica uno nuevo para garantizar que la foto se vea.
    if (existing) await existing.delete().catch(() => null);
    const message = await channel.send(payload);
    store.write({ receptionMessageId: message.id });
  }

  client.once(Events.ClientReady, () => publish().catch((error) => console.error("No se pudo publicar la ubicación de Recepción:", error)));
}

module.exports = { name: "ubicaciones del hospital", commands: [], register };
