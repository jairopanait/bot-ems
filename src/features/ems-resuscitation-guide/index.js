const { EmbedBuilder, Events } = require("discord.js");
const path = require("node:path");
const { createJsonStore } = require("../../storage");

const CHANNEL_ID = "1573737079521673388";
const VIDEO_FILE = path.join(__dirname, "reanimar.mp4");

function register(client, config) {
  const store = createJsonStore(config.dataDir, "ems-resuscitation-guide.json", {
    messageId: null,
    videoMessageId: null
  });

  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) {
      throw new Error("Canal de guía de reanimación no válido.");
    }

    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("❤️‍🩹 REANIMAR")
      .setDescription([
        "**1.** Pregunta el pulso.",
        "**2.** Tras la respuesta, lanza el bindeo de ese pulso y pregunta la herida.",
        "**3.** Trata las heridas.",
        "**4.** Reanima desde el menú de la tecla **E**."
      ].join("\n"))
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊 · Guía operativa" });

    const data = store.read();
    const existing = data.messageId
      ? await channel.messages.fetch(data.messageId).catch(() => null)
      : null;

    if (existing) await existing.edit({ embeds: [embed] });
    else {
      const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      data.messageId = message.id;
    }

    // Los vídeos no se reproducen dentro de un rich embed de Discord. Se envían
    // en el mensaje siguiente para que Discord genere su reproductor nativo.
    const videoMessage = data.videoMessageId
      ? await channel.messages.fetch(data.videoMessageId).catch(() => null)
      : null;
    if (!videoMessage) {
      const sentVideo = await channel.send({
        content: "🎬 **Vídeo guía: Reanimar**",
        files: [{ attachment: VIDEO_FILE, name: "guia-reanimar.mp4" }],
        allowedMentions: { parse: [] }
      });
      data.videoMessageId = sentVideo.id;
    }

    store.write(data);
  }

  client.once(Events.ClientReady, () => publish().catch((error) => {
    console.error("No se pudo publicar la guía de reanimación:", error);
  }));
}

module.exports = { name: "guía de reanimación", commands: [], register };
