const { EmbedBuilder, Events } = require("discord.js");
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
  let quietTimer = null;
  const mentions = (members) => members.length ? members.map((member) => `<@${member.id}>`).join(" · ") : "—";

  async function publish() {
    const guild = await client.guilds.fetch(config.guildId);
    const panelChannel = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
    if (!panelChannel?.isTextBased() || panelChannel.guildId !== config.guildId) throw new Error("Canal de distribución no válido.");
    await guild.members.fetch().catch(() => {});
    const h50Members = [...guild.members.cache.values()].filter((member) => !member.user.bot && member.roles.cache.has(H50_ROLE_ID));
    const lines = [
      `**🧑🏼‍⚕️ H-50: ${mentions(h50Members)}**`,
      ...LINES.map(({ label, channelId }) => {
        const channel = guild.channels.cache.get(channelId);
        const members = channel?.isVoiceBased() ? [...channel.members.values()].filter((member) => !member.user.bot) : [];
        return `**${label}: ${mentions(members)}**`;
      })
    ];
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("Doctor Salidorro EMS")
      .setDescription(`# **📋 DISTRIBUCIÓN OBLIGATORIA**\n\n${lines.join("\n\n")}`)
      .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊 · Actualización automática" })
      .setTimestamp();
    await panelChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  function schedulePublish() {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      quietTimer = null;
      publish().catch((error) => console.error("No se pudo enviar la distribución:", error));
    }, 15000);
    quietTimer.unref();
  }

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (oldState.guild.id !== config.guildId && newState.guild.id !== config.guildId) return;
    schedulePublish();
  });
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    if (newMember.guild.id !== config.guildId) return;
    if (oldMember.roles.cache.has(H50_ROLE_ID) !== newMember.roles.cache.has(H50_ROLE_ID)) schedulePublish();
  });
}

module.exports = { name: "distribución de voz", commands: [], register };
