const { EmbedBuilder, Events } = require("discord.js");

const ALLOWED_ROLE_ID = "1135516317097660538";

function roleIdFromCommand(content) {
  const match = content.trim().match(/^!quitar\s+<@&(\d{17,20})>\s*$/i);
  return match ? match[1] : null;
}

function register(client, config) {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.inGuild() || message.guildId !== config.guildId) return;
    const roleId = roleIdFromCommand(message.content);
    if (!roleId) return;

    const requester = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!requester?.roles.cache.has(ALLOWED_ROLE_ID)) {
      await message.delete().catch(() => {});
      await message.author.send("No tienes permiso para usar !quitar @rol.").catch(() => {});
      return;
    }

    await message.delete().catch(() => {});
    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.id === message.guild.id || role.managed) {
      await message.channel.send({ content: "No se puede retirar ese rol.", allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const notice = await message.channel.send({
      content: "⌛ Retirando <@&" + role.id + "> de sus miembros…",
      allowedMentions: { roles: [] }
    });
    try {
      await message.guild.members.fetch();
      const members = [...message.guild.members.cache.values()].filter((member) => !member.user.bot && member.roles.cache.has(role.id));
      let removed = 0;
      let failed = 0;
      for (let index = 0; index < members.length; index += 5) {
        const batch = members.slice(index, index + 5);
        const results = await Promise.all(batch.map((member) => member.roles.remove(role, "!quitar ejecutado por " + message.author.tag).then(() => true).catch(() => false)));
        removed += results.filter(Boolean).length;
        failed += results.filter((result) => !result).length;
      }
      const embed = new EmbedBuilder()
        .setColor(0x7b1113)
        .setTitle("🗑️ Rol retirado")
        .setDescription("Se retiró <@&" + role.id + "> de **" + removed + "** miembro(s).")
        .addFields({ name: "Ejecutado por", value: "<@" + message.author.id + ">", inline: true })
        .setFooter({ text: failed ? failed + " retirada(s) no pudieron completarse · Doctor Salidorro EMS - LaNaranjaRP🍊" : "Doctor Salidorro EMS - LaNaranjaRP🍊" })
        .setTimestamp();
      await notice.edit({ content: "", embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
      console.error("Error en !quitar:", error);
      await notice.edit({ content: "No se pudo completar la retirada del rol.", embeds: [], allowedMentions: { parse: [] } }).catch(() => {});
    }
  });
}

module.exports = { name: "retirada masiva de roles", commands: [], register };
