const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");

const CHANNEL_ID = "1568629823960653944";

function register(client, config) {
  const store = createJsonStore(config.dataDir, "role-commands-panel.json", { messageId: null });

  async function publish() {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== config.guildId) throw new Error("Canal de comandos por rango no válido.");
    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("📖 Comandos por rango")
      .setDescription("Aquí tienes los comandos disponibles para los rangos autorizados.")
      .addFields(
        { name: "🎖️ !rango", value: "Abre una solicitud de Rango IC e ID.\nPuede usarlo: <@&1129103467294769214>" },
        { name: "💊 !venta", value: "Registra la venta de medkits y calcula el reparto Hospital/EMS.\nPuede usarlo: <@&1129103355126481006> · <@&1129103352488271983> · <@&1129103349594202253> · <@&1129103346872107139> · <@&1129573501209165965> · <@&1129103343709585468> · <@&1129103338793877565> · <@&1129103341520158750> · <@&1135516317097660538>" }
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

  client.once(Events.ClientReady, () => publish().catch((error) => console.error("No se pudo publicar el panel de comandos por rango:", error)));
}

module.exports = { name: "panel de comandos por rango", commands: [], register };
