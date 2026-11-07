const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");

const CHANNEL_ID = "1129103990852948018";
const ROLE_ID = "1483489497705611408";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "resignation-guide.json", { messageId: null });
  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal de guía de renuncias no válido.");
    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("📤 Gestión de renuncias")
      .setDescription(`Comando disponible para <@&${ROLE_ID}>.`)
      .addFields(
        { name: "🚪 !renuncia @usuario", value: "Abre un proceso privado para indicar el motivo de la salida y si existe blacklist. Después elimina el apodo, retira los roles que no estén preservados, mantiene solo los roles permitidos que la persona ya tuviera, añade el rol de salida y publica la plantilla de renuncia." },
        { name: "🧾 Registro", value: "El bot registra la salida y los roles que fueron retirados en el canal de logs." }
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
  client.once(Events.ClientReady, () => publish().catch((error) => console.error("No se pudo publicar la guía de renuncias:", error)));
}
module.exports = { name: "guía de renuncias", commands: [], register };
