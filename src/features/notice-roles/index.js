const { Events } = require("discord.js");

const NOTICE_CHANNEL_ID = "1129103927397339207";
const COMMON_NOTICE_ROLE_ID = "1129103447065628692";
const FIRST_NOTICE_ROLE_ID = "1129103450278477824";

function register(client, config) {
  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot || message.channelId !== NOTICE_CHANNEL_ID || message.guildId !== config.guildId) return;
    const user = [...message.mentions.users.values()].find((candidate) => !candidate.bot);
    const roles = [...message.mentions.roles.values()].filter((role) => role.id !== message.guildId);
    if (!user || !roles.length) return;
    try {
      const member = await message.guild.members.fetch(user.id);
      const me = message.guild.members.me ?? await message.guild.members.fetchMe();
      const manageableRoles = roles.filter((role) => me.roles.highest.comparePositionTo(role) > 0 && !role.managed);
      const isAppealed = /\bapelad[oa]s?\b/i.test(message.content);
      if (isAppealed) {
        for (const role of manageableRoles) if (member.roles.cache.has(role.id)) await member.roles.remove(role, `Aviso apelado publicado por ${message.author.tag}`);
        if (roles.some((role) => role.id === FIRST_NOTICE_ROLE_ID) && member.roles.cache.has(COMMON_NOTICE_ROLE_ID)) {
          await member.roles.remove(COMMON_NOTICE_ROLE_ID, `Primer aviso apelado publicado por ${message.author.tag}`);
        }
        return;
      }
      for (const role of manageableRoles) if (!member.roles.cache.has(role.id)) await member.roles.add(role, `Aviso publicado por ${message.author.tag}`);
      const commonRole = message.guild.roles.cache.get(COMMON_NOTICE_ROLE_ID) ?? await message.guild.roles.fetch(COMMON_NOTICE_ROLE_ID).catch(() => null);
      if (commonRole && !commonRole.managed && me.roles.highest.comparePositionTo(commonRole) > 0 && !member.roles.cache.has(commonRole.id)) {
        await member.roles.add(commonRole, `Aviso publicado por ${message.author.tag}`);
      }
    } catch (error) {
      console.error("No se pudieron aplicar los roles del aviso:", error);
    }
  });
}

module.exports = { name: "roles de avisos", commands: [], register };
