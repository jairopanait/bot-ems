const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");

const CHANNEL_ID = "1129604228395057293";
const ROLE_ID = "1129103424311541790";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "instruction-guide.json", { messageId: null });
  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal de guía de instrucciones no válido.");
    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("🩸 Comandos de instrucción EMS")
      .setDescription(`Comandos disponibles para <@&${ROLE_ID}>.`)
      .addFields(
        { name: "✅ !instruccion @usuario", value: "Envía al usuario mencionado la plantilla obligatoria de Nombre IC. Al completarla, registra su Nombre IC e ID de Discord, cambia su apodo a `[🩸] Nombre IC`, retira los roles de postulación pendiente, añade los roles EMS y publica el anuncio de bienvenida." }
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
  client.once(Events.ClientReady, () => publish().catch((error) => console.error("No se pudo publicar la guía de instrucciones:", error)));
}
module.exports = { name: "guía de instrucciones", commands: [], register };
