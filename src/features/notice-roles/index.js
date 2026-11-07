const { Events } = require("discord.js");

const NOTICE_CHANNEL_ID = "1129103927397339207";
const COMMON_NOTICE_ROLE_ID = "1129103447065628692";
const FIRST_NOTICE_ROLE_ID = "1129103450278477824";
const NOTICE_ROLE_IDS = new Set(["1273435015866355713", "1273435481656393933", "1273435631053180948", "1129103450278477824", "1129103452329480273", "1129103454766366852", "1207461019824422982"]);

function register(client, config) {
  async function reconcileCommonRole(member, reason) {
    const hasNotice = [...NOTICE_ROLE_IDS].some((roleId) => member.roles.cache.has(roleId));
    const commonRole = member.guild.roles.cache.get(COMMON_NOTICE_ROLE_ID) ?? await member.guild.roles.fetch(COMMON_NOTICE_ROLE_ID).catch(() => null);
    const me = member.guild.members.me ?? await member.guild.members.fetchMe();
    if (!commonRole || commonRole.managed || me.roles.highest.comparePositionTo(commonRole) <= 0) return;
    if (hasNotice && !member.roles.cache.has(COMMON_NOTICE_ROLE_ID)) {
      await member.roles.add(commonRole, reason);
    } else if (!hasNotice && member.roles.cache.has(COMMON_NOTICE_ROLE_ID)) {
      await member.roles.remove(commonRole, reason);
    }
  }

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
        await reconcileCommonRole(member, `Aviso apelado publicado por ${message.author.tag}`);
        return;
      }
      for (const role of manageableRoles) if (!member.roles.cache.has(role.id)) await member.roles.add(role, `Aviso publicado por ${message.author.tag}`);
      await reconcileCommonRole(member, `Aviso publicado por ${message.author.tag}`);
    } catch (error) {
      console.error("No se pudieron aplicar los roles del aviso:", error);
    }
  });

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    if (newMember.guild.id !== config.guildId) return;
    const noticeChanged = [...NOTICE_ROLE_IDS].some((roleId) => oldMember.roles.cache.has(roleId) !== newMember.roles.cache.has(roleId));
    if (noticeChanged) reconcileCommonRole(newMember, "Sincronización automática de avisos").catch((error) => console.error("No se pudo sincronizar el rol común de avisos:", error));
  });
}

module.exports = { name: "roles de avisos", commands: [], register };
