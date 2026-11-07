const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");

const CHANNEL_ID = "1129103789589266432";
const ROLE_ID = "1129103460361576589";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "written-postulations-guide.json", { messageId: null });
  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal de guía de postulaciones no válido.");
    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("📝 Comandos de postulaciones escritas")
      .setDescription(`Comandos disponibles para <@&${ROLE_ID}>.`)
      .addFields(
        { name: "✅ !aceptar @usuario", value: "Aprueba la postulación escrita del usuario, añade los roles de aprobada y publica el anuncio de admisión." },
        { name: "❌ !rechazar @usuario", value: "Abre un selector privado para elegir el motivo del rechazo. Añade los roles de rechazo correspondientes y publica el resultado." }
      )
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊" })
      .setTimestamp();
    const saved = store.read();
    const existing = saved.messageId ? await channel.messages.fetch(saved.messageId).catch(() => null) : null;
    if (existing) await existing.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    else {
      const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      store.write({ messageId: message.id });
    }
  }
  client.once(Events.ClientReady, () => publish().catch((error) => console.error("No se pudo publicar la guía de postulaciones:", error)));
}
module.exports = { name: "guía de postulaciones", commands: [], register };
