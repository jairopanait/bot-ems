const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, Events,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");

const OUTPUT_CHANNEL_ID = "1201436248712163378";
const ALLOWED_ROLE_IDS = new Set(["1129103355126481006", "1129103352488271983", "1129103349594202253", "1129103346872107139", "1129573501209165965", "1129103343709585468", "1129103338793877565", "1129103341520158750", "1135516317097660538"]);
const BUTTON_PREFIX = "sales:open:";
const MODAL_PREFIX = "sales:form:";

function currency(amount) {
  return `${new Intl.NumberFormat("es-ES").format(amount)}$`;
}

function register(client, config) {
  const sessions = new Map();

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot || !/^!venta\s*$/i.test(message.content.trim())) return;
    let prompt;
    try {
      const seller = await message.guild.members.fetch(message.author.id);
      if (![...ALLOWED_ROLE_IDS].some((roleId) => seller.roles.cache.has(roleId))) {
        await message.delete();
        await message.author.send("No tienes permiso para usar `!venta`.").catch(() => {});
        return;
      }
      await message.delete();
      prompt = await message.channel.send({
        content: `<@${message.author.id}> abre el formulario para registrar la venta.`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}${message.id}`).setLabel("Registrar venta").setStyle(ButtonStyle.Success)
        )],
        allowedMentions: { users: [message.author.id] }
      });
      const onlySeller = (interaction) => {
        if (interaction.user.id === message.author.id) return true;
        interaction.reply({ content: "Este formulario pertenece a otra persona.", ephemeral: true }).catch(() => {});
        return false;
      };
      let opener;
      try {
        opener = await prompt.awaitMessageComponent({ componentType: ComponentType.Button, time: 300000, filter: onlySeller });
      } catch (error) {
        if (error.code === "InteractionCollectorError") return;
        throw error;
      }
      const token = `${message.id}:${message.author.id}`;
      sessions.set(token, { userId: message.author.id, expiresAt: Date.now() + 300000 });
      const modal = new ModalBuilder().setCustomId(`${MODAL_PREFIX}${token}`)
        .setTitle("Registro de venta de medkits")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("buyer-id").setLabel("ID a la que vendió")
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("medkits").setLabel("Número de medkits")
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6)
          )
        );
      await opener.showModal(modal);
      await prompt.delete().catch(() => {});
      prompt = null;
      let submission;
      try {
        submission = await opener.awaitModalSubmit({ time: 300000, filter: onlySeller });
      } catch (error) {
        if (error.code === "InteractionCollectorError") return;
        throw error;
      }
      const session = sessions.get(token);
      sessions.delete(token);
      if (!session || session.userId !== submission.user.id || Date.now() >= session.expiresAt) {
        return submission.reply({ content: "El formulario ha caducado. Ejecuta !venta de nuevo.", ephemeral: true });
      }
      const buyerId = submission.fields.getTextInputValue("buyer-id").trim();
      const medkitsText = submission.fields.getTextInputValue("medkits").trim();
      if (!/^\d+$/.test(medkitsText) || Number(medkitsText) < 1) {
        return submission.reply({ content: "El número de medkits debe ser un número entero mayor que cero.", ephemeral: true });
      }
      const medkits = Number(medkitsText);
      const total = medkits * 3000;
      const hospital = total * 0.8;
      const ems = total * 0.2;
      await submission.deferReply({ ephemeral: true });
      const output = await client.channels.fetch(OUTPUT_CHANNEL_ID).catch(() => null);
      if (!output?.isTextBased() || output.guildId !== config.guildId) throw new Error("Canal de registro de ventas no válido.");
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setAuthor({ name: "Doctor Salidorro EMS · Ventas" })
        .setTitle("💊 Venta de medkits registrada")
        .setDescription("Registro automático de la venta y su reparto.")
        .addFields(
          { name: "👤 Persona que hizo la venta", value: `<@${submission.user.id}> · ${submission.user.tag}`, inline: false },
          { name: "🆔 ID al que vendió", value: `\`${buyerId}\``, inline: true },
          { name: "💊 Nº Medkits", value: String(medkits), inline: true },
          { name: "💰 Total de la venta", value: currency(total), inline: true },
          { name: "🏥 Porcentaje para el Hospital · 80%", value: currency(hospital), inline: true },
          { name: "🩸 Porcentaje para el EMS · 20%", value: currency(ems), inline: true }
        )
        .setFooter({ text: "Doctor Salidorro EMS - LaNaranjaRP🍊" })
        .setTimestamp();
      await output.send({ embeds: [embed], allowedMentions: { parse: [] } });
      await submission.editReply("✅ Venta registrada correctamente.");
    } catch (error) {
      console.error("Error en !venta:", error);
      if (prompt) await prompt.delete().catch(() => {});
      await message.author.send("No se pudo registrar la venta. Inténtalo de nuevo.").catch(() => {});
    }
  });
}

module.exports = { name: "ventas de medkits", commands: [], register };
