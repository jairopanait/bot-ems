const { EmbedBuilder, Events } = require("discord.js");
const PANEL_CHANNEL_ID = "1129104016912154644";
const H50_ROLE_ID = "1543639741751103609";
const CITY_ALONE_THREAD_ID = "1374095276192825367";
const CITY_ALONE_ROLE_ID = "1129103467294769214";
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
  let lastSnapshot = null;
  let cityIsAlone = false;
  const mentions = (members) => members.length ? members.map((member) => `<@${member.id}>`).join(" · ") : "—";

  async function publish() {
    const guild = await client.guilds.fetch(config.guildId);
    const panelChannel = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
    if (!panelChannel?.isTextBased() || panelChannel.guildId !== config.guildId) throw new Error("Canal de distribución no válido.");
    await guild.members.fetch().catch(() => {});
    const h50Members = [...guild.members.cache.values()].filter((member) => !member.user.bot && member.roles.cache.has(H50_ROLE_ID));
    const voiceLines = LINES.map(({ label, channelId }) => {
      const members = [...guild.voiceStates.cache.values()]
        .filter((state) => state.channelId === channelId && state.member && !state.member.user.bot)
        .map((state) => state.member);
      return { label, members };
    });
    const lines = [
      `**🧑🏼‍⚕️ H-50: ${mentions(h50Members)}**`,
      ...voiceLines.map(({ label, members }) => `**${label}: ${mentions(members)}**`)
    ];
    const snapshot = lines.join("\n");
    const noOneInDistribution = h50Members.length === 0 && voiceLines.every(({ members }) => members.length === 0);
    if (!noOneInDistribution) cityIsAlone = false;
    if (snapshot !== lastSnapshot) {
      const embed = new EmbedBuilder()
        .setColor(0x7b1113)
        .setDescription(`# **📋 DISTRIBUCIÓN OBLIGATORIA**\n\n${lines.join("\n\n")}`)
        .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊 · Actualización automática" })
        .setTimestamp();
      await panelChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      lastSnapshot = snapshot;
    }
    // Keep the empty template in the distribution channel; alert only in its thread.
    // Commit the alert state after sending so a failed send can be retried.
    if (noOneInDistribution && !cityIsAlone) {
      const thread = await client.channels.fetch(CITY_ALONE_THREAD_ID);
      if (!thread?.isThread() || !thread.isTextBased() || thread.guildId !== config.guildId) throw new Error("Hilo de CIUDAD SOLA no válido.");
      await thread.send({ content: `<@&${CITY_ALONE_ROLE_ID}> **CIUDAD SOLA**`, allowedMentions: { roles: [CITY_ALONE_ROLE_ID] } });
      cityIsAlone = true;
    }
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
    if (oldState.channelId === newState.channelId) return;
    schedulePublish();
  });
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    if (newMember.guild.id !== config.guildId) return;
    if (oldMember.roles.cache.has(H50_ROLE_ID) !== newMember.roles.cache.has(H50_ROLE_ID)) schedulePublish();
  });
}

module.exports = { name: "distribución de voz", commands: [], register };
