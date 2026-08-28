require("dotenv").config();

function value(name, fallback) {
  const result = process.env[name] ?? fallback;
  return typeof result === "string" ? result.trim().replace(/^["']|["']$/g, "") : result;
}

function required(name) {
  const result = value(name);
  if (!result) throw new Error(`Falta la variable obligatoria ${name}.`);
  return result;
}

const guildId = required("DISCORD_GUILD_ID");

module.exports = Object.freeze({
  token: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId,
  dataDir: value("RAILWAY_VOLUME_MOUNT_PATH", value("DATA_DIR", "./data")),
  timezone: value("TIMEZONE", "Europe/Madrid"),
  birthdays: {
    inputChannelId: required("BIRTHDAY_INPUT_CHANNEL_ID"),
    outputChannelId: required("BIRTHDAY_OUTPUT_CHANNEL_ID"),
    notifyRoleId: value("BIRTHDAY_NOTIFY_ROLE_ID", null),
    dailyHour: Number(value("BIRTHDAY_DAILY_HOUR", "0")),
    dailyMinute: Number(value("BIRTHDAY_DAILY_MINUTE", "0"))
  },
  postulations: {
    announcementChannelId: value("POSTULATIONS_ANNOUNCEMENT_CHANNEL_ID", "1129103811168968734"),
    writtenCommandRoleIds: ["1135516317097660538", "1129103460361576589"],
    oralCommandRoleIds: ["1129103424311541790"],
    writtenApprovedRoleIds: ["1129103421421658193", "1542969949478191224"],
    writtenRejectedBaseRoleId: "1129103421421658193",
    writtenRejectedAttemptRoleIds: ["1129103443861188660", "1129103442284130364", "1129103438844797083"],
    oralApprovedRoleIds: ["1129103336684134441", "1129103360981745734", "1129103467294769214"],
    oralApprovalRemoveRoleIds: ["1129103421421658193", "1542969949478191224"],
    emsMentionRoleId: "1129103424311541790"
  },
  faction: {
    guildId,
    triggerChannelId: value("FACTION_TRIGGER_CHANNEL_ID", "1129103923135922216"),
    outputChannelId: value("FACTION_OUTPUT_CHANNEL_ID", "1481717290561966100"),
    preservedRoleIds: ["1129103472948678780", "1129103464530722867"],
    rolesToAdd: ["1343636338754457632", "1343636743450001479"]
  },
  inactivity: {
    requestChannelId: value("INACTIVITY_REQUEST_CHANNEL_ID", "1543023897652236428"),
    notificationChannelId: value("INACTIVITY_NOTIFICATION_CHANNEL_ID", "1129103840088699001"),
    viewerRoleId: value("INACTIVITY_VIEWER_ROLE_ID", "1135516317097660538"),
    partialRoleId: value("INACTIVITY_PARTIAL_ROLE_ID", "1133783680733679626"),
    totalRoleId: value("INACTIVITY_TOTAL_ROLE_ID", "1129103330900181123")
  }
});
