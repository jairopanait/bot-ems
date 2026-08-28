const { Client, Events, GatewayIntentBits, REST, Routes } = require("discord.js");
const config = require("./config");
const commands = require("./commands");
const birthdays = require("./features/birthdays");
const postulations = require("./features/postulations");
const faction = require("./features/faction");
const inactivity = require("./features/inactivity");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const features = [birthdays, postulations, faction, inactivity];
for (const feature of features) feature.register(client, config);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`BOT EMS conectado como ${readyClient.user.tag}.`);
  console.log(`Módulos activos: ${features.map((feature) => feature.name).join(", ")}.`);

  try {
    const rest = new REST({ version: "10" }).setToken(config.token);
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands.map((command) => command.toJSON()) }
    );
    console.log(`Comandos de Discord registrados automáticamente: ${commands.length}.`);
  } catch (error) {
    console.error("No se pudieron registrar los comandos de Discord:", error);
  }
});

client.on(Events.Error, (error) => console.error("Error del cliente de Discord:", error));

process.on("unhandledRejection", (error) => console.error("Promesa no controlada:", error));
process.on("uncaughtException", (error) => console.error("Error no controlado:", error));

client.login(config.token);
