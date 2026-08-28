const { Client, Events, GatewayIntentBits } = require("discord.js");
const config = require("./config");
const birthdays = require("./features/birthdays");
const postulations = require("./features/postulations");
const faction = require("./features/faction");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const features = [birthdays, postulations, faction];
for (const feature of features) feature.register(client, config);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`BOT EMS conectado como ${readyClient.user.tag}.`);
  console.log(`Módulos activos: ${features.map((feature) => feature.name).join(", ")}.`);
});

client.on(Events.Error, (error) => console.error("Error del cliente de Discord:", error));

process.on("unhandledRejection", (error) => console.error("Promesa no controlada:", error));
process.on("uncaughtException", (error) => console.error("Error no controlado:", error));

client.login(config.token);
