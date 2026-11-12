const { EmbedBuilder, Events } = require("discord.js");

const ALLOWED_ROLE_ID = "1135516317097660538";
const LOG_CHANNEL_ID = "1568442270120808569";

function roleIdsFromCommand(content) {
  const trimmed = content.trim();
  if (!/^!quitar(?:\s+<@&\d{17,20}>)+\s*$/i.test(trimmed)) return null;
  return [...new Set([...trimmed.matchAll(/<@&(\d{17,20})>/g)].map((match) => match[1]))];
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function removeRoleWithRetry(member, role, reason) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await member.roles.remove(role, reason);
      return true;
    } catch (error) {
      if (attempt === 2) return false;
      await wait((attempt + 1) * 750);
    }
  }
  return false;
}

async function removeFromMembers(role, members, reason) {
  const removedIds = [];
  let failed = 0;
  const affected = members.filter((member) => !member.user.bot && member.roles.cache.has(role.id));
  for (let index = 0; index < affected.length; index += 2) {
    const batch = affected.slice(index, index + 2);
    const results = await Promise.all(batch.map(async (member) => ({
      member,
      removed: await removeRoleWithRetry(member, role, reason)
    })));
    for (const result of results) {
      if (result.removed) removedIds.push(result.member.id);
      else failed += 1;
    }
  }
  return { removed: removedIds.length, failed, removedIds };
}

async function sendRemovalLog(client, config, role, removedIds, executorId) {
  if (!removedIds.length) return;
  const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased() || channel.guildId !== config.guildId) return;
  for (let index = 0; index < removedIds.length; index += 40) {
    const users = removedIds.slice(index, index + 40).map((userId) => `<@${userId}>`).join("\n");
    const embed = new EmbedBuilder()
      .setColor(0x7b1113)
      .setTitle("🗑️ Retirada masiva de rol")
      .setDescription(`El rol <@&${role.id}> se retiró de los siguientes usuarios:`)
      .addFields(
        { name: "Usuarios retirados", value: users || "—" },
        { name: "Ejecutado por", value: `<@${executorId}>` }
      )
      .setFooter({ text: `Doctor Salidorro EMS - LaNaranjaRP🍊 · Parte ${Math.floor(index / 40) + 1}` })
      .setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }
}

function register(client, config) {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.inGuild() || message.guildId !== config.guildId) return;
    const roleIds = roleIdsFromCommand(message.content);
    if (!roleIds) return;

    const requester = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!requester?.roles.cache.has(ALLOWED_ROLE_ID)) {
      await message.delete().catch(() => {});
      await message.author.send("No tienes permiso para usar !quitar @rol.").catch(() => {});
      return;
    }

    await message.delete().catch(() => {});
    const roles = await Promise.all(roleIds.map((roleId) => message.guild.roles.fetch(roleId).catch(() => null)));
    if (roles.some((role) => !role || role.id === message.guild.id || role.managed)) {
      await message.channel.send({ content: "Uno o más roles no se pueden retirar.", allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }

    const notice = await message.channel.send({
      content: "⌛ Retirando los roles seleccionados de sus miembros…",
      allowedMentions: { parse: [] }
    });
    let stage = "cargar los miembros del servidor";
    try {
      await message.guild.members.fetch();
      const results = [];
      let blockedRole = null;
      let remainingCount = 0;
      for (const role of roles) {
        stage = "retirar el rol " + role.name;
        const members = [...message.guild.members.cache.values()];
        const result = await removeFromMembers(role, members, "!quitar ejecutado por " + message.author.tag);
        stage = "verificar el rol " + role.name;
        await message.guild.members.fetch();
        const remaining = [...message.guild.members.cache.values()].filter((member) => !member.user.bot && member.roles.cache.has(role.id));
        results.push({ role, ...result, remaining: remaining.length });
        stage = "registrar el resultado";
        await sendRemovalLog(client, config, role, result.removedIds, message.author.id).catch((error) => console.error("No se pudo registrar !quitar:", error));
        if (remaining.length) {
          blockedRole = role;
          remainingCount = remaining.length;
          break;
        }
      }
      stage = "publicar el resumen";
      const totalRemoved = results.reduce((total, result) => total + result.removed, 0);
      const totalFailed = results.reduce((total, result) => total + result.failed, 0);
      const lines = results.map((result) => "• <@&" + result.role.id + ">: **" + result.removed + "** retirada(s)");
      const embed = new EmbedBuilder()
        .setColor(0x7b1113)
        .setTitle(blockedRole ? "⚠️ Retirada incompleta" : "🗑️ Roles retirados")
        .setDescription(lines.join("\n"))
        .addFields(
          { name: "Total de retiradas", value: String(totalRemoved), inline: true },
          { name: "Ejecutado por", value: "<@" + message.author.id + ">", inline: true },
          { name: "Estado", value: blockedRole ? "Se detuvo: " + remainingCount + " miembro(s) aún conserva(n) <@&" + blockedRole.id + ">. No se procesaron los roles siguientes." : "Todos los roles se verificaron sin miembros.", inline: false }
        )
        .setFooter({ text: totalFailed ? totalFailed + " retirada(s) no pudieron completarse · Doctor Salidorro EMS - LaNaranjaRP🍊" : "Doctor Salidorro EMS - LaNaranjaRP🍊" })
        .setTimestamp();
      await notice.edit({ content: "", embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
      console.error("Error en !quitar:", error);
      const detail = error instanceof Error && error.message ? error.message.slice(0, 180) : "Error desconocido";
      await notice.edit({ content: "No se pudo completar la retirada al intentar " + stage + ". Motivo: " + detail, embeds: [], allowedMentions: { parse: [] } }).catch(() => {});
    }
  });
}

module.exports = { name: "retirada masiva de roles", commands: [], register };
