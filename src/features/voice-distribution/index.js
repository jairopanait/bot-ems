const { EmbedBuilder, Events } = require("discord.js");
const { createJsonStore } = require("../../storage");

const PANEL_CHANNEL_ID = "1129104016912154644";
const H50_ROLE_ID = "1543639741751103609";
const LINES = [
  { label: "🚁 UNIDAD UEA", channelId: "1129104126429638717" },
  { label: "🏍️ UNIDAD UEM", channelId: "1542653776828178572" },
  { label: "🏨 HOSPITAL", channelId: "1552712460094537849" },
  { label: "🚑 AMBULANCIA 1", channelId: "1129104145715052624" },
  { label: "🚑 AMBULANCIA 2", channelId: "1129104149519290540" },
  { label: "🚑 AMBULANCIA 3", channelId: "1542653394580414574" },
  { label: "⛑️ CIRUGIA", channelId: "1130992230157525094" },
  { label: "📓 EXAMEN", channelId: "1379856086982594631" },
  { label: "🎉 EVENTOS", channelId: "1129104164811702332" }
];

function register(client, config) {
  const store = createJsonStore(config.dataDir, "distribution-panel.json", { panelMessageId: null });
  let renderTimer = null;

  const mentions = (members) => members.length ? members.map((member) => `<@${member.id}>`).join(" · ") : "—";

  async function render() {
    const guild = await client.guilds.fetch(config.guildId);
    const panelChannel = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
    if (!panelChannel?.isTextBased() || panelChannel.guildId !== config.guildId) throw new Error("Canal de distribución no válido.");
    await guild.members.fetch().catch(() => {});
    const h50Members = [...guild.members.cache.values()].filter((member) => !member.user.bot && member.roles.cache.has(H50_ROLE_ID));
    const lines = [
      `🧑🏼‍⚕️ **H-50:** ${mentions(h50Members)}`,
      ...LINES.map(({ label, channelId }) => {
        const channel = guild.channels.cache.get(channelId);
        const members = channel?.isVoiceBased() ? [...channel.members.values()].filter((member) => !member.user.bot) : [];
        return `${label}: ${mentions(members)}`;
      })
    ];
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("📋 Distribución obligatoria")
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊 · Actualización automática" })
      .setTimestamp();
    const saved = store.read();
    const existing = saved.panelMessageId ? await panelChannel.messages.fetch(saved.panelMessageId).catch(() => null) : null;
    if (existing) await existing.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    else {
      const message = await panelChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      store.write({ panelMessageId: message.id });
    }
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render().catch((error) => console.error("No se pudo actualizar la distribución:", error));
    }, 750);
    renderTimer.unref();
  }

  client.once(Events.ClientReady, () => render().catch((error) => console.error("No se pudo publicar la distribución:", error)));
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (oldState.guild.id === config.guildId || newState.guild.id === config.guildId) scheduleRender();
  });
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    if (newMember.guild.id !== config.guildId) return;
    if (oldMember.roles.cache.has(H50_ROLE_ID) !== newMember.roles.cache.has(H50_ROLE_ID)) scheduleRender();
  });
}

module.exports = { name: "distribución de voz", commands: [], register };
