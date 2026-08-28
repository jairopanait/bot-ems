const { Events, PermissionFlagsBits } = require("discord.js");

function register(client, rootConfig) {
  const config = rootConfig.faction;

  function formatDate(date) {
    return new Intl.DateTimeFormat("es-ES", { timeZone: rootConfig.timezone, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function template(member, date) {
    return `\`\`\`\nCódigo de discord: ${member.user.username} // ${member.id}\nFecha de salida de la facción: ${formatDate(date)}\nMotivo de la salida: Expulsión horas\nBlacklisted: no\n\`\`\``;
  }

  async function processMember(message, member) {
    const me = message.guild.members.me ?? await message.guild.members.fetchMe();
    const required = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageNicknames, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    if (!me.permissions.has(required)) throw new Error("Al bot le faltan permisos para gestionar roles, apodos o mensajes.");
    await member.roles.set([...config.preservedRoleIds, ...config.rolesToAdd], `Salida solicitada en ${message.id}`);
    await member.setNickname(null, `Salida solicitada en ${message.id}`);
    const channel = await message.guild.channels.fetch(config.outputChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal de salida no existe o no permite mensajes.");
    await channel.send({ content: template(member, message.createdAt), allowedMentions: { parse: [] } });
  }

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.guildId !== config.guildId || message.channelId !== config.triggerChannelId) return;
    const users = [...message.mentions.users.values()];
    if (!users.length) return;
    let failures = 0;
    for (const user of users) {
      try { await processMember(message, await message.guild.members.fetch(user.id)); }
      catch (error) { failures += 1; console.error(`No se pudo procesar la salida de ${user.tag}:`, error); }
    }
    await message.react(failures ? "❌" : "✅").catch(() => {});
  });
}

module.exports = { name: "salidas de facción", commands: [], register };
