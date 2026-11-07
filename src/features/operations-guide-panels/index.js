const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");
const otcLoginImage = require("./otc-login-image");

const OTC_GUIDE_CHANNEL_ID = "1207043891988144208";
const DISTRIBUTION_GUIDE_CHANNEL_ID = "1568629823960653944";
const OLD_OTC_GUIDE_MESSAGE_ID = "1568637893893955668";
const OTC_LOGIN_IMAGE_NAME = "guia-login-otc.jpg";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "operations-guide-panels.json", { otcMessageId: null, loginMessageId: null, distributionMessageId: null });

  async function upsert(channel, messageId, embed, files = []) {
    const existing = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (existing) {
      await existing.edit({ embeds: [embed], files, allowedMentions: { parse: [] } });
      return existing.id;
    }
    const message = await channel.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
    return message.id;
  }

  async function publish() {
    const otcChannel = await client.channels.fetch(OTC_GUIDE_CHANNEL_ID).catch(() => null);
    const distributionChannel = await client.channels.fetch(DISTRIBUTION_GUIDE_CHANNEL_ID).catch(() => null);
    if (!otcChannel?.isTextBased() || otcChannel.guildId !== config.guildId || !distributionChannel?.isTextBased() || distributionChannel.guildId !== config.guildId) throw new Error("Canal de guía operativa no válido.");
    const otcEmbed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("🕒 Fichaje OTC")
      .setDescription("Puedes fichar directamente desde Discord: **no es necesario abrir OpenTimeClock en la web**.")
      .addFields({ name: "📍 Entrar al fichaje", value: `Desde este canal entra a <#1568448649833480360> y usa los botones del panel OTC.` })
      .addFields(
        { name: "1️⃣ Primera vez", value: "En el panel OTC pulsa **ENTRADA** o **SALIDA** e introduce tu contraseña de OTC en el formulario privado. **Solo se pide una vez.** Tu usuario de OTC es tu ID de Discord." },
        { name: "2️⃣ Fichajes posteriores", value: "Después de validar la primera vez, la contraseña queda guardada de forma protegida y **solo tendrás que usar los botones ENTRADA o SALIDA**." },
        { name: "⚠️ Salida corta", value: "Si llevas menos de 30 minutos de servicio, el bot pide confirmación antes de finalizar." },
        { name: "📸 Comprobante", value: "Al salir se muestra un resumen privado con Nombre IC, entrada, salida y duración para hacer captura." },
        { name: "⏳ Restar horas", value: "El botón **RESTAR HORAS** abre una solicitud con horas, minutos y razón para su revisión." },
        { name: "🛡️ Comprobación de servicio", value: "Cada hora recibirás una mención con el botón **Sigo de servicio**. Tendrás **5 minutos** para pulsarlo; si no confirmas, el bot cerrará tu fichaje y te desconectará del canal de voz." }
      )
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊" })
      .setTimestamp();
    const loginEmbed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("🔐 Consultar tus horas en OTC")
      .setDescription("𝐒𝐢 𝐪𝐮𝐞𝐫𝐞𝐦𝐨𝐬 𝐯𝐞𝐫 𝐥𝐚𝐬 𝐡𝐨𝐫𝐚𝐬 𝐪𝐮𝐞 𝐭𝐢𝐞𝐧𝐞𝐧 𝐞𝐜𝐡𝐚𝐬 𝐥𝐞 𝐝𝐚𝐧 𝐚 **LOGIN** 𝐲 𝐥𝐨 𝐯𝐞𝐫𝐚𝐧 𝐞𝐧 𝐞𝐬𝐞 𝐚𝐩𝐚𝐫𝐭𝐚𝐝𝐨.")
      .setImage(`attachment://${OTC_LOGIN_IMAGE_NAME}`)
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
    const oldChannel = await client.channels.fetch(DISTRIBUTION_GUIDE_CHANNEL_ID).catch(() => null);
    if (oldChannel?.isTextBased()) {
      const oldMessage = await oldChannel.messages.fetch(OLD_OTC_GUIDE_MESSAGE_ID).catch(() => null);
      if (oldMessage) await oldMessage.delete().catch(() => {});
    }
    const saved = store.read();
    const otcMessageId = await upsert(otcChannel, saved.otcMessageId, otcEmbed);
    const loginMessageId = await upsert(otcChannel, saved.loginMessageId, loginEmbed, [{ attachment: Buffer.from(otcLoginImage, "base64"), name: OTC_LOGIN_IMAGE_NAME }]);
    const distributionMessageId = await upsert(distributionChannel, saved.distributionMessageId, distributionEmbed);
    store.write({ otcMessageId, loginMessageId, distributionMessageId });
  }

  client.once(Events.ClientReady, () => publish().catch((error) => console.error("No se pudieron publicar las guías operativas:", error)));
}

module.exports = { name: "guías operativas", commands: [], register };
