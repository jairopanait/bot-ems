const { Events } = require("discord.js");

const PROMOTIONS_CHANNEL_ID = "1129103918954201111";
const RANK_EMOJIS = new Map([
  ["1129103338793877565", "[🥼]"],
  ["1129103341520158750", "[🩺]"],
  ["1129103343709585468", "[🧬]"],
  ["1129573501209165965", "[🧫]"],
  ["1129103346872107139", "[💊]"],
  ["1129103349594202253", "[🔬]"],
  ["1129103352488271983", "[🧪]"],
  ["1129103355126481006", "[🚑]"],
  ["1129103357676634113", "[🩹]"],
  ["1129103360981745734", "[🩸]"]
]);

function nicknameForRank(member, emoji) {
  const current = (member.nickname ?? member.user.globalName ?? member.user.username).trim();
  const name = current.replace(/^\[[^\]]+\]\s*/, "").trim() || member.user.username;
  return `${emoji} ${name}`.slice(0, 32);
}

function register(client, config) {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot || message.guildId !== config.guildId || message.channelId !== PROMOTIONS_CHANNEL_ID) return;
    const target = [...message.mentions.users.values()].find((user) => !user.bot);
    const rankMentions = [...message.mentions.roles.values()].filter((role) => RANK_EMOJIS.has(role.id));
    if (!target || rankMentions.length !== 1) return;
    try {
      const member = await message.guild.members.fetch(target.id);
      const newRole = rankMentions[0];
      const me = message.guild.members.me ?? await message.guild.members.fetchMe();
      if (me.roles.highest.comparePositionTo(newRole) <= 0) throw new Error("El rol nuevo está por encima del bot.");
      const removable = [...RANK_EMOJIS.keys()]
        .filter((roleId) => roleId !== newRole.id && member.roles.cache.has(roleId))
        .map((roleId) => message.guild.roles.cache.get(roleId))
        .filter((role) => role && !role.managed && me.roles.highest.comparePositionTo(role) > 0);
      if (removable.length) await member.roles.remove(removable, `Ascenso publicado por ${message.author.tag}`);
      if (!member.roles.cache.has(newRole.id)) await member.roles.add(newRole, `Ascenso publicado por ${message.author.tag}`);
      await member.setNickname(nicknameForRank(member, RANK_EMOJIS.get(newRole.id)), `Ascenso publicado por ${message.author.tag}`);
    } catch (error) {
      console.error("No se pudo aplicar el ascenso:", error);
    }
  });
}

module.exports = { name: "ascensos automáticos", commands: [], register };
