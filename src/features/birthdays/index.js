const { Events, SlashCommandBuilder } = require("discord.js");
const cron = require("node-cron");
const { createJsonStore } = require("../../storage");
const { parseBirthday, getTodayParts, isBirthdayToday, formatBirthday } = require("./dates");

const commands = [
  new SlashCommandBuilder()
    .setName("cumple")
    .setDescription("Gestiona tu fecha de cumpleaños")
    .addSubcommand((sub) => sub.setName("poner").setDescription("Guarda tu fecha de cumpleaños")
      .addStringOption((option) => option.setName("fecha").setDescription("Fecha día/mes, por ejemplo 25/8").setRequired(true)))
    .addSubcommand((sub) => sub.setName("borrar").setDescription("Borra tu cumpleaños guardado"))
    .addSubcommand((sub) => sub.setName("ver").setDescription("Mira tu cumpleaños guardado"))
];

function register(client, rootConfig) {
  const config = rootConfig.birthdays;
  const store = createJsonStore(rootConfig.dataDir, "birthdays.json", {});
  let lastAnnouncementKey = null;

  async function sendBirthdayMessage(userIds) {
    const channel = await client.channels.fetch(config.outputChannelId);
    const roleMention = config.notifyRoleId ? `<@&${config.notifyRoleId}> ` : "";
    await channel.send({
      content: `${roleMention}felicitarles mis niños: ¡Feliz cumpleaños ${userIds.map((id) => `<@${id}>`).join(" ")}! Que tengáis un día genial.`,
      allowedMentions: { roles: config.notifyRoleId ? [config.notifyRoleId] : [], users: userIds }
    });
  }

  async function announceTodayBirthdays() {
    const today = getTodayParts(rootConfig.timezone);
    const key = `${today.year}-${today.month}-${today.day}`;
    if (lastAnnouncementKey === key) return;
    const userIds = Object.entries(store.read()).filter(([, date]) => isBirthdayToday(date, today)).map(([id]) => id);
    if (userIds.length) await sendBirthdayMessage(userIds);
    lastAnnouncementKey = key;
  }

  async function importRecentMessages() {
    const channel = await client.channels.fetch(config.inputChannelId);
    const messages = [];
    let before;
    while (messages.length < 300) {
      const batch = await channel.messages.fetch({ limit: Math.min(100, 300 - messages.length), before });
      if (!batch.size) break;
      messages.push(...batch.values());
      before = batch.last().id;
    }
    const birthdays = store.read();
    let imported = 0;
    for (const message of messages.reverse()) {
      if (message.author.bot) continue;
      const result = parseBirthday(message.content);
      if (result.error) continue;
      birthdays[message.author.id] = { ...result.birthday, messageId: message.id };
      imported += 1;
    }
    if (imported) store.write(birthdays);
    console.log(`Cumpleaños encontrados en mensajes recientes: ${imported}.`);
  }

  async function handleCommand(interaction) {
    if (interaction.channelId !== config.inputChannelId) {
      await interaction.reply({ content: `Usa este comando en <#${config.inputChannelId}>.`, ephemeral: true });
      return;
    }
    const birthdays = store.read();
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "poner") {
      const result = parseBirthday(interaction.options.getString("fecha", true));
      if (result.error) return interaction.reply({ content: result.error, ephemeral: true });
      birthdays[interaction.user.id] = result.birthday;
      store.write(birthdays);
      if (isBirthdayToday(result.birthday, getTodayParts(rootConfig.timezone))) await sendBirthdayMessage([interaction.user.id]);
      return interaction.reply({ content: `Guardado: tu cumpleaños es el ${formatBirthday(result.birthday)}.`, ephemeral: true });
    }
    if (subcommand === "borrar") {
      const existed = Boolean(birthdays[interaction.user.id]);
      delete birthdays[interaction.user.id];
      store.write(birthdays);
      return interaction.reply({ content: existed ? "He borrado tu cumpleaños guardado." : "No tenía ningún cumpleaños guardado para ti.", ephemeral: true });
    }
    const birthday = birthdays[interaction.user.id];
    return interaction.reply({ content: birthday ? `Tu cumpleaños guardado es el ${formatBirthday(birthday)}.` : "Todavía no tienes ningún cumpleaños guardado.", ephemeral: true });
  }

  client.once(Events.ClientReady, async () => {
    cron.schedule(`${config.dailyMinute} ${config.dailyHour} * * *`, () => announceTodayBirthdays().catch(console.error), { timezone: rootConfig.timezone });
    await importRecentMessages().catch((error) => console.error("No se pudo importar el historial de cumpleaños:", error));
    await announceTodayBirthdays();
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || message.channelId !== config.inputChannelId) return;
    const result = parseBirthday(message.content);
    if (result.error) return;
    const birthdays = store.read();
    birthdays[message.author.id] = { ...result.birthday, messageId: message.id };
    store.write(birthdays);
    if (isBirthdayToday(result.birthday, getTodayParts(rootConfig.timezone))) await sendBirthdayMessage([message.author.id]);
    await message.react("✅").catch(() => message.reply("Guardado ✅"));
  });

  client.on(Events.MessageDelete, (message) => {
    if (message.channelId !== config.inputChannelId) return;
    const birthdays = store.read();
    const entry = Object.entries(birthdays).find(([, date]) => date.messageId === message.id);
    if (entry) { delete birthdays[entry[0]]; store.write(birthdays); }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "cumple") return;
    try { await handleCommand(interaction); } catch (error) {
      console.error("Error en cumpleaños:", error);
      const response = { content: "Ha fallado algo al gestionar el cumpleaños.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(response); else await interaction.reply(response);
    }
  });
}

module.exports = { name: "cumpleaños", commands, register };
