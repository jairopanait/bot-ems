const { REST, Routes } = require("discord.js");
const config = require("./config");
const commands = require("./commands");

async function main() {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const body = commands.map((command) => command.toJSON());
  console.log(`Registrando ${body.length} comandos de BOT EMS...`);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  console.log("Comandos registrados correctamente.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
