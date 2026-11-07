const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");

const CHANNEL_ID = "1129104003771420835";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "bot-guide-panel.json", { messageId: null });

  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal de guía del bot no válido.");
    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("📚 Doctor Salidorro EMS · Guía de funciones")
      .setDescription("Resumen de los comandos, paneles y automatizaciones activos. Los comandos con `!` se borran del chat tras iniciar su proceso.")
      .addFields(
        { name: "📝 !aceptar @usuario · !rechazar @usuario", value: "**Postulaciones escritas.** `!aceptar` añade los roles de aprobada y anuncia la admisión. `!rechazar` permite elegir el motivo y añade los roles de rechazo según sus intentos.\n**Permiso:** <@&1135516317097660538> · <@&1129103460361576589>" },
        { name: "🩸 !instruccion @usuario", value: "**Instrucciones.** El usuario rellena Nombre IC; se registra su ID, se cambia su apodo a `[🩸] Nombre IC`, se quitan roles de postulación y se añaden los de EMS.\n**Permiso:** <@&1129103424311541790>" },
        { name: "📋 !inactividades", value: "**Consulta privada** de inactividades totales, parciales e indefinidas vigentes. No cambia roles.\n**Permiso:** <@&1135516317097660538>" },
        { name: "📤 !renuncia @usuario", value: "**Salida de facción.** Pide motivo y blacklist; retira apodo y roles no preservados, añade el rol de salida y registra la plantilla.\n**Permiso:** <@&1135516317097660538> · <@&1483489497705611408>" },
        { name: "🎖️ !rango", value: "**Solicitud de rango IC.** Pide Rango e ID, envía un embed de solicitud y avisa al rol responsable.\n**Permiso:** <@&1129103467294769214>" },
        { name: "💊 !venta", value: "**Venta de medkits.** Solicita ID comprador y cantidad; calcula 3.000$ por medkit, 80% Hospital y 20% EMS.\n**Permisos:** <@&1129103355126481006> · <@&1129103352488271983> · <@&1129103349594202253> · <@&1129103346872107139> · <@&1129573501209165965> · <@&1129103343709585468> · <@&1129103338793877565> · <@&1129103341520158750> · <@&1135516317097660538>" },
        { name: "🕒 Panel OTC", value: "**ENTRADA / SALIDA / RESTAR HORAS.** Vincula OTC, ficha, avisa antes de una salida corta y entrega comprobante de salida. Restar horas manda una solicitud con horas, minutos y razón.\n**Uso:** personal con cuenta OTC vinculada." },
        { name: "📅 Panel de inactividades", value: "**Solicitar, retirar, añadir o eliminar inactividades.** Gestiona roles, fechas, avisos de inicio/final y listado ordenado. La gestión administrativa es para <@&1135516317097660538>." },
        { name: "🩺 Panel H-50", value: "**Entrada H-50:** añade el rol H-50. **Salida H-50:** retira ese rol.\n**Uso:** desde el panel H-50 correspondiente." },
                { name: "📄 Cuestionario obligatorio EMS", value: "**Plantilla para aspirantes EMS.** La persona responde una pregunta cada vez: Nombre IC, edad OOC, experiencia, disponibilidad y aportación a la facción. Al terminar, el bot reúne las respuestas y las envía al canal de revisión.\n**Uso:** desde el panel del cuestionario EMS." },
        { name: "📢 Avisos y roles", value: "**Canal de avisos:** al mencionar usuario y rol de aviso añade el rol y el rol común. Si el aviso dice `apelado`, retira los avisos mencionados. El rol común se retira al no quedar ningún aviso activo." },
        { name: "🔊 Distribución de voz", value: "**Distribución obligatoria.** Tras 15 segundos sin movimientos, publica quién está en cada canal de voz y los H-50. También actualiza al añadir o retirar el rol H-50. Si todos los canales vigilados quedan vacíos, menciona a <@&1129103467294769214> con **CIUDAD SOLA**. No guarda registros." },
        { name: "⚖️ Gestión de facción", value: "**Canal de salidas/expulsiones:** permite elegir descenso o expulsión, por horas o por conducta; aplica roles de expulsión y blacklist cuando corresponde." }
,
        { name: "🧾 Registro de uso y logs", value: "**Canal de logs:** <#1568442270120808569>.\n**Sí registra:** `!aceptar`, `!rechazar`, `!instruccion`, `!renuncia`, `!inactividades` y `!rango`. En renuncias también registra los roles realmente retirados.\n**No registra:** `!venta`, el panel OTC, restar horas, paneles de inactividad, H-50, cuestionario EMS, distribución de voz, avisos automáticos y gestión automática de facción." }
      )
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊 · Guía automática" })
      .setTimestamp();
    const saved = store.read();
    const existing = saved.messageId ? await channel.messages.fetch(saved.messageId).catch(() => null) : null;
    if (existing) await existing.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    else {
      const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      store.write({ messageId: message.id });
    }
  }

  client.once(Events.ClientReady, () => publish().catch((error) => console.error("No se pudo publicar la guía del bot:", error)));
}

module.exports = { name: "guía del bot", commands: [], register };
