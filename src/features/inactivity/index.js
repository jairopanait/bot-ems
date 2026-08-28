const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const cron = require("node-cron");
const { createJsonStore } = require("../../storage");

const REQUEST_BUTTON_ID = "inactivity:request";
const SUBMIT_MODAL_ID = "inactivity:submit";

const commands = [
  new SlashCommandBuilder()
    .setName("inactividades")
    .setDescription("Muestra las inactividades vigentes")
];

function dateKey(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function madridParts(timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function parseSpanishDate(value) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, date };
}

function parseRange(value) {
  const parts = value.split(/\s+(?:a|hasta|-)\s+/i);
  if (parts.length !== 2) return null;
  const start = parseSpanishDate(parts[0]);
  const end = parseSpanishDate(parts[1]);
  if (!start || !end || end.key < start.key) return null;
  return { start, end };
}

function formatKey(key) {
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

function dayAfter(key) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function exceedsOneCalendarMonth(start, end) {
  const year = start.date.getUTCFullYear();
  const month = start.date.getUTCMonth();
  const day = start.date.getUTCDate();
  const lastDayOfNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const limit = new Date(Date.UTC(year, month + 1, Math.min(day, lastDayOfNextMonth)));
  return end.date > limit;
}

function normalizeType(value) {
  const normalized = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normalized === "total") return "total";
  if (normalized === "parcial") return "parcial";
  return null;
}

function register(client, rootConfig) {
  const config = rootConfig.inactivity;
  const store = createJsonStore(rootConfig.dataDir, "inactivities.json", { panelMessageId: null, entries: {} });

  async function notificationChannel() {
    const channel = await client.channels.fetch(config.notificationChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal de avisos de inactividad no es válido.");
    return channel;
  }

  async function publishPanel() {
    const channel = await client.channels.fetch(config.requestChannelId);
    if (!channel?.isTextBased()) throw new Error("El canal de solicitudes de inactividad no es válido.");
    const data = store.read();
    if (data.panelMessageId) {
      const existing = await channel.messages.fetch(data.panelMessageId).catch(() => null);
      if (existing) return;
    }
    const embed = new EmbedBuilder()
      .setTitle("SOLICITAR INACTIVIDAD")
      .setDescription("Solicita su inactividad parcial o total.")
      .setColor(0xc0392b);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(REQUEST_BUTTON_ID).setLabel("SOLICITAR INACTIVIDAD").setStyle(ButtonStyle.Primary)
    );
    const message = await channel.send({ embeds: [embed], components: [row] });
    data.panelMessageId = message.id;
    store.write(data);
    console.log(`Panel de inactividad publicado en el canal ${config.requestChannelId}.`);
  }

  function buildModal() {
    return new ModalBuilder()
      .setCustomId(SUBMIT_MODAL_ID)
      .setTitle("Solicitar inactividad")
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("type").setLabel("Tipo de Inactividad (Total/Parcial)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("icName").setLabel("Nombre IC").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Razón").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("time").setLabel("Tiempo").setPlaceholder("01/09/2026 - 15/09/2026").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30))
      );
  }

  async function applyRole(entry) {
    const guild = await client.guilds.fetch(rootConfig.guildId);
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member) return;
    const roleId = entry.type === "total" ? config.totalRoleId : config.partialRoleId;
    const otherRoleId = entry.type === "total" ? config.partialRoleId : config.totalRoleId;
    if (member.roles.cache.has(otherRoleId)) await member.roles.remove(otherRoleId);
    if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, "Inactividad vigente");
    entry.roleApplied = true;
  }

  async function finishEntry(entry) {
    const guild = await client.guilds.fetch(rootConfig.guildId);
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    const roleId = entry.type === "total" ? config.totalRoleId : config.partialRoleId;
    if (member?.roles.cache.has(roleId)) await member.roles.remove(roleId, "Inactividad finalizada");
    const channel = await notificationChannel();
    await channel.send({
      content: `<@${entry.userId}> ¡Su inactividad ${entry.type} finalizó! Para renovarla vuelva a solicitarla en el canal correspondiente.`,
      allowedMentions: { users: [entry.userId] }
    });
    entry.finished = true;
  }

  async function processEntries() {
    const now = madridParts(rootConfig.timezone);
    const data = store.read();
    let changed = false;
    for (const entry of Object.values(data.entries)) {
      if (entry.finished) continue;
      if (!entry.roleApplied && now.date >= entry.startDate) {
        await applyRole(entry);
        changed = true;
      }
      if (now.date > entry.cleanupDate || (now.date === entry.cleanupDate && now.hour >= 10)) {
        await finishEntry(entry);
        changed = true;
      }
    }
    if (changed) store.write(data);
  }

  async function handleSubmission(interaction) {
    const type = normalizeType(interaction.fields.getTextInputValue("type"));
    const icName = interaction.fields.getTextInputValue("icName").trim();
    const reason = interaction.fields.getTextInputValue("reason").trim();
    const range = parseRange(interaction.fields.getTextInputValue("time"));
    if (!type) return interaction.reply({ content: "El tipo debe ser Total o Parcial.", ephemeral: true });
    if (!range) return interaction.reply({ content: "Tiempo debe usar el formato `dd/mm/aaaa - dd/mm/aaaa` y la fecha final no puede ser anterior.", ephemeral: true });

    const today = dateKey(new Date(), rootConfig.timezone);
    if (range.end.key < today) return interaction.reply({ content: "La inactividad no puede terminar en una fecha pasada.", ephemeral: true });
    if (type === "total" && exceedsOneCalendarMonth(range.start, range.end)) {
      const channel = await notificationChannel();
      await channel.send({
        content: `<@${interaction.user.id}> ¡Lo sentimos. supera su inactividad total más de un mes, abra ticket para hablarlo con directiva!`,
        allowedMentions: { users: [interaction.user.id] }
      });
      return interaction.reply({ content: "La inactividad total supera un mes. Se ha enviado el aviso correspondiente.", ephemeral: true });
    }

    const data = store.read();
    const entry = {
      userId: interaction.user.id,
      discordName: interaction.user.tag,
      icName,
      reason,
      type,
      startDate: range.start.key,
      endDate: range.end.key,
      cleanupDate: dayAfter(range.end.key),
      roleApplied: false,
      finished: false,
      requestedAt: new Date().toISOString()
    };
    data.entries[interaction.user.id] = entry;
    if (entry.startDate <= today) await applyRole(entry);
    store.write(data);
    await interaction.reply({
      content: `Inactividad ${type} registrada del ${formatKey(entry.startDate)} al ${formatKey(entry.endDate)}. El rol se retirará el ${formatKey(entry.cleanupDate)} a las 10:00.`,
      ephemeral: true
    });
  }

  async function listEntries(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(config.viewerRoleId)) {
      return interaction.reply({ content: "No tienes permiso para consultar las inactividades.", ephemeral: true });
    }
    const entries = Object.values(store.read().entries).filter((entry) => !entry.finished);
    if (!entries.length) return interaction.reply({ content: "No hay inactividades vigentes.", ephemeral: true });
    const chunks = [];
    for (let index = 0; index < entries.length; index += 10) chunks.push(entries.slice(index, index + 10));
    const embeds = chunks.slice(0, 10).map((chunk, index) => new EmbedBuilder()
      .setTitle(index === 0 ? "Inactividades vigentes" : `Inactividades vigentes (${index + 1})`)
      .setColor(0xc0392b)
      .setDescription(chunk.map((entry) =>
        `**${entry.icName}** — <@${entry.userId}> (${entry.discordName})\n` +
        `Tipo: ${entry.type} · ${formatKey(entry.startDate)} → ${formatKey(entry.endDate)}\n` +
        `Razón: ${entry.reason}`
      ).join("\n\n")));
    await interaction.reply({ embeds, ephemeral: true, allowedMentions: { parse: [] } });
  }

  client.once(Events.ClientReady, async () => {
    await publishPanel().catch((error) => console.error("No se pudo publicar el panel de inactividad:", error));
    await processEntries().catch((error) => console.error("No se pudieron procesar inactividades:", error));
    cron.schedule("* * * * *", () => processEntries().catch(console.error), { timezone: rootConfig.timezone });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === REQUEST_BUTTON_ID) return interaction.showModal(buildModal());
      if (interaction.isModalSubmit() && interaction.customId === SUBMIT_MODAL_ID) return handleSubmission(interaction);
      if (interaction.isChatInputCommand() && interaction.commandName === "inactividades") return listEntries(interaction);
    } catch (error) {
      console.error("Error en inactividades:", error);
      const response = { content: "No se pudo gestionar la inactividad. Revisa los permisos del bot.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    }
  });
}

module.exports = { name: "inactividades", commands, register };
