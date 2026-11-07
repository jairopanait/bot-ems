const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");

const CHANNEL_ID = "1568629823960653944";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "operations-guide-panels.json", { otcMessageId: null, distributionMessageId: null });

  async function upsert(channel, messageId, embed) {
    const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (existing) {
      await existing.edit({ embeds: [embed], allowedMentions: { parse: [] } });
      return existing.id;
    }
    const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return message.id;
  }

  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal de guía operativa no válido.");
    const otcEmbed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("🕒 Fichaje OTC")
      .setDescription("Puedes fichar directamente desde Discord: **no es necesario abrir OpenTimeClock en la web**.")
      .addFields(
        { name: "1️⃣ Primera vez", value: "En el panel OTC pulsa **ENTRADA** o **SALIDA** e introduce tu contraseña de OTC en el formulario privado. Tu usuario de OTC es tu ID de Discord." },
        { name: "2️⃣ Fichajes posteriores", value: "Después de validar la primera vez, usa los botones **ENTRADA** o **SALIDA** con un clic. El acceso queda protegido para no tener que abrir la web." },
        { name: "⚠️ Salida corta", value: "Si llevas menos de 30 minutos de servicio, el bot pide confirmación antes de finalizar." },
        { name: "📸 Comprobante", value: "Al salir se muestra un resumen privado con Nombre IC, entrada, salida y duración para hacer captura." },
        { name: "⏳ Restar horas", value: "El botón **RESTAR HORAS** abre una solicitud con horas, minutos y razón para su revisión." }
      )
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊" })
      .setTimestamp();
    const distributionEmbed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("🔊 Distribución automática")
      .setDescription("La distribución se gestiona automáticamente según los canales de voz; no necesitas usar ningún comando.")
      .addFields(
        { name: "👥 Qué controla", value: "H-50, Unidad UEA, Unidad UEM, Hospital, Ambulancias 1/2/3, Cirugía, Examen y Eventos." },
        { name: "⏱️ Cuándo se publica", value: "Cuando alguien entra, sale o cambia de canal de voz, espera **15 segundos sin más movimientos** y manda la distribución actualizada." },
        { name: "🩺 Rol H-50", value: "También se actualiza si se añade o retira el rol H-50. Los H-50 aparecen en su línea y en el canal de voz donde se encuentren." },
        { name: "🚨 Ciudad sola", value: "Si todos los canales de distribución quedan vacíos, menciona a <@&1129103467294769214> con **CIUDAD SOLA**." },
        { name: "🔇 Sin spam", value: "No envía mensajes si el resultado final no cambia; ignora acciones como silenciarse o ensordecerse." }
      )
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊" })
      .setTimestamp();
    const saved = store.read();
    const otcMessageId = await upsert(channel, saved.otcMessageId, otcEmbed);
    const distributionMessageId = await upsert(channel, saved.distributionMessageId, distributionEmbed);
    store.write({ otcMessageId, distributionMessageId });
  }

  client.once(Events.ClientReady, () => publish().catch((error) => console.error("No se pudieron publicar las guías operativas:", error)));
}

module.exports = { name: "guías operativas", commands: [], register };
