const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events
} = require("discord.js");
const { createJsonStore } = require("../../storage");

const ENTER_BUTTON_ID = "h50:enter";
const EXIT_BUTTON_ID = "h50:exit";

function register(client, rootConfig) {
  const config = rootConfig.h50;
  const store = createJsonStore(rootConfig.dataDir, "h50.json", { panelMessageId: null });

  async function publishPanel() {
    const channel = await client.channels.fetch(config.panelChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal del panel H-50 no es válido.");

    const embed = new EmbedBuilder()
      .setTitle("¿Quieres entrar como H-50?")
      .setDescription(
        "Pulsa **Entrada H-50** para comenzar tu función y recibir el rango.\n\n" +
        "Cuando termines, pulsa **Salida H-50** para retirar el rango."
      )
      .setColor(0x1f2240);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(ENTER_BUTTON_ID)
        .setLabel("Entrada H-50")
        .setEmoji("📥")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(EXIT_BUTTON_ID)
        .setLabel("Salida H-50")
        .setEmoji("📤")
        .setStyle(ButtonStyle.Danger)
    );

    const data = store.read();
    if (data.panelMessageId) {
      const existing = await channel.messages.fetch(data.panelMessageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed], components: [row] });
        console.log(`Panel H-50 actualizado en el canal ${config.panelChannelId}.`);
        return;
      }
    }

    const message = await channel.send({ embeds: [embed], components: [row] });
    data.panelMessageId = message.id;
    store.write(data);
    console.log(`Panel H-50 publicado en el canal ${config.panelChannelId}.`);
  }

  client.once(Events.ClientReady, () => {
    publishPanel().catch((error) => console.error("No se pudo publicar el panel H-50:", error));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton() || ![ENTER_BUTTON_ID, EXIT_BUTTON_ID].includes(interaction.customId)) return;

    await interaction.deferUpdate().catch(() => {});
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (interaction.customId === ENTER_BUTTON_ID) {
        if (!member.roles.cache.has(config.roleId)) await member.roles.add(config.roleId);
      } else if (member.roles.cache.has(config.roleId)) {
        await member.roles.remove(config.roleId);
      }
    } catch (error) {
      console.error("Error al cambiar el rol H-50:", error);
    }
  });
}

module.exports = { name: "H-50", commands: [], register };
