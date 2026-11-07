const { EmbedBuilder, Events } = require("discord.js");

const LOG_CHANNEL_ID = "1568442270120808569";

function register(client, config) {
  const commandNames = new Set(require("../../commands").map((command) => command.name));

  async function logUse({ executorId, targetIds, command, createdAt, guildId }) {
    if (guildId !== config.guildId) return;
    try {
      const channel = await client.channels.fetch(LOG_CHANNEL_ID);
      if (!channel?.isTextBased() || channel.guildId !== guildId) {
        throw new Error("El canal de logs de comandos no es válido para este servidor.");
      }
      const person = (id) => `\`${id}\` · <@${id}>`;
      const date = new Intl.DateTimeFormat("es-ES", {
        timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
      }).format(createdAt);
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("📋 Registro de comando")
        .addFields(
          { name: "👤 Discord ID de quien usó el comando", value: person(executorId) },
          { name: "🎯 Persona a la que afectó", value: targetIds.length ? [...new Set(targetIds)].map(person).join("\n") : "No corresponde: comando de consulta." },
          { name: "⌨️ Comando que usó", value: `\`${command}\`` },
          { name: "📅 Día y hora", value: `${date} (Europe/Madrid)` }
        )
        .setFooter({ text: "BOT EMS · Registro de uso; no confirma la finalización del comando" })
        .setTimestamp(createdAt);
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
      // Logging failures must never prevent an existing command from running.
      console.error("No se pudo registrar el uso del comando:", error);
    }
  }

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot) return;
    const match = message.content.trim().match(/^!(aceptar|rechazar|renuncia|instruccion)\s+<@!?(\d{17,20})>\s*$/i);
    if (!match) return;
    await logUse({
      executorId: message.author.id, targetIds: [match[2]],
      command: `!${match[1].toLowerCase()} @usuario`,
      createdAt: message.createdAt, guildId: message.guildId
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.inGuild() || !commandNames.has(interaction.commandName)) return;
    const targetIds = [];
    const parts = [`/${interaction.commandName}`];
    function visit(options) {
      for (const option of options) {
        if (option.type === 1 || option.type === 2) parts.push(option.name);
        if (option.type === 6) targetIds.push(option.value);
        if (option.options) visit(option.options);
      }
    }
    visit(interaction.options.data);
    if (interaction.commandName === "cumple" && !targetIds.length) targetIds.push(interaction.user.id);
    await logUse({
      executorId: interaction.user.id, targetIds, command: parts.join(" "),
      createdAt: interaction.createdAt, guildId: interaction.guildId
    });
  });
}

module.exports = { name: "logs de comandos", commands: [], register };
