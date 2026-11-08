const test = require("node:test");
const assert = require("node:assert/strict");
const { Events } = require("discord.js");
const { parseOtcDateTime, elapsedMilliseconds, formatDuration } = require("../src/features/otc/time");
const feature = require("../src/features/otc");

for (const [name, start, end, expected] of [
  ["winter Madrid", "2026-11-08 12:00:00", "2026-11-08T11:45:00Z", "0h 45m"],
  ["summer Madrid", "2026-07-08 12:00:00", "2026-07-08T10:45:00Z", "0h 45m"],
  ["midnight", "2026-11-07 23:50:00", "2026-11-08T00:20:00+01:00", "0h 30m"],
  ["24 hours", "2026-11-07 12:00:00", "2026-11-08T12:00:00+01:00", "24h 0m"],
  ["100 hours and 20 minutes", "2026-11-04 12:00:00", "2026-11-08T16:20:00+01:00", "100h 20m"],
  ["spring clock change counts elapsed time", "2026-03-29 01:30:00", "2026-03-29T03:30:00+02:00", "1h 0m"],
  ["autumn clock change counts elapsed time", "2026-10-25 01:30:00", "2026-10-25T03:30:00+01:00", "3h 0m"],
  ["explicit offset resolves repeated hour", "2026-10-25T02:30:00+02:00", "2026-10-25T03:30:00+01:00", "2h 0m"],
  ["zero duration", "2026-11-08 12:00:00", "2026-11-08T12:00:00+01:00", "0h 0m"],
  ["truncates partial minute", "2026-11-08 12:00:30", "2026-11-08T12:02:29+01:00", "0h 1m"]
]) test(name, () => assert.equal(formatDuration(start, new Date(end), "Europe/Madrid"), expected));

for (const start of ["0000-00-00 00:00:00", "2026-02-30 12:00:00", "2026-11-08 25:00:00", "2026-03-29 02:30:00", "2026-10-25 02:30:00", "invalid", null]) {
  test(`Invalid/nonexistent/ambiguous time is not invented: ${start}`, () => {
    assert(Number.isNaN(parseOtcDateTime(start, "Europe/Madrid")));
    assert.equal(formatDuration(start, new Date(), "Europe/Madrid"), "No disponible");
  });
}
test("Future starts and invalid zones cannot create negative or fabricated durations", () => {
  assert.equal(formatDuration("2026-11-09 12:00:00", new Date("2026-11-08T12:00:00Z"), "Europe/Madrid"), "No disponible");
  assert(Number.isNaN(parseOtcDateTime("2026-11-08 12:00:00", "invalid")));
  assert.equal(elapsedMilliseconds("2026-11-08 12:00:00", Date.parse("2026-11-08T11:30:00Z"), "Europe/Madrid"), 1800000);
});

for (const [name, start, end, short, expectedDuration] of [
  ["15 minutes", "2026-11-08 12:00:00", "2026-11-08T11:15:00Z", true],
  ["exactly 30 minutes", "2026-11-08 12:00:00", "2026-11-08T11:30:00Z", false, "0h 30m"],
  ["45 minutes in winter", "2026-11-08 12:00:00", "2026-11-08T11:45:00Z", false, "0h 45m"],
  ["45 minutes in summer", "2026-07-08 12:00:00", "2026-07-08T10:45:00Z", false, "0h 45m"],
  ["100 accumulated hours", "2026-11-04 12:00:00", "2026-11-08T15:20:00Z", false, "100h 20m"]
]) test(`SALIDA integration: ${name}`, async () => {
  const handlers = {}, replies = [], punches = [];
  const now = Date.parse(end);
  feature.register({ once: () => {}, on: (event, fn) => { handlers[event] = fn; } }, { guildId: "guild", dataDir: "/tmp/otc-time-no-writes" }, {
    now: () => now, credentials: { get: () => "a".repeat(32) },
    otc: {
      getCurrentShift: async () => ({ state: { sInDateTime: start }, timeZone: "Europe/Madrid" }),
      clock: async (args) => { punches.push(args); return { action: "out", startedAt: start, timeZone: "Europe/Madrid", confirmedAt: new Date(end), employeeName: "Persona" }; }
    }
  });
  await handlers[Events.InteractionCreate]({
    isButton: () => true, isModalSubmit: () => false, customId: "otc:out",
    inGuild: () => true, guildId: "guild", channelId: "1568448649833480360", user: { id: "752666296524734526" },
    deferReply: async (p) => assert.equal(p.ephemeral, true), editReply: async (p) => replies.push(p)
  });
  assert.equal(punches.length, short ? 0 : 1);
  if (short) assert.match(replies[0].content, /30 minutos/);
  else assert.equal(replies[0].embeds[0].toJSON().fields.find((field) => field.name.includes("Duración")).value, expectedDuration);
});
