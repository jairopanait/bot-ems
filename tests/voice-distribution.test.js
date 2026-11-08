const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { Events } = require("discord.js");

function harness() {
  const file = require.resolve("../src/features/voice-distribution");
  let pending;
  const sandbox = {
    module: { exports: {} }, require: createRequire(file), console,
    setTimeout: (fn, delay) => { assert.equal(delay, 15000); pending = fn; return { unref() {} }; },
    clearTimeout: () => { pending = null; }
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  const handlers = {}, panels = [], alerts = [];
  const guild = { members: { cache: new Map(), fetch: async () => {} }, voiceStates: { cache: new Map() } };
  let failAlert = false;
  sandbox.module.exports.register({
    on: (event, fn) => { handlers[event] = fn; }, guilds: { fetch: async () => guild },
    channels: { fetch: async (id) => id === "1129104016912154644"
      ? { guildId: "guild", isTextBased: () => true, send: async (p) => panels.push(p) }
      : { guildId: "guild", isThread: () => true, isTextBased: () => true, send: async (p) => {
        assert.equal(id, "1374095276192825367");
        if (failAlert) throw new Error("Temporary thread error");
        alerts.push(p);
      } } }
  }, { guildId: "guild" });
  const person = (id, h50 = false) => ({ id, user: { bot: false }, roles: { cache: new Map(h50 ? [["1543639741751103609", true]] : []) } });
  async function update() {
    handlers[Events.VoiceStateUpdate]({ guild: { id: "guild" }, channelId: "before" }, { guild: { id: "guild" }, channelId: "after" });
    pending();
    await new Promise(setImmediate);
  }
  return { guild, panels, alerts, person, update, fail: (value) => { failAlert = value; } };
}

test("Empty city publishes a template without tags and alerts only in the thread, once", async () => {
  const h = harness();
  await h.update();
  assert.equal(h.panels.length, 1);
  const description = h.panels[0].embeds[0].toJSON().description;
  assert.match(description, /H-50: —/);
  assert.match(description, /AMBULANCIA 1: —/);
  assert(!description.includes("<@"));
  assert.equal(h.panels[0].content, undefined);
  assert.equal(h.alerts[0].content, "<@&1129103467294769214> **CIUDAD SOLA**");
  assert.equal(h.alerts[0].allowedMentions.roles[0], "1129103467294769214");
  await h.update();
  assert.equal(h.panels.length, 1);
  assert.equal(h.alerts.length, 1);
});

test("H-50 without voice occupants keeps distribution populated and suppresses city alert", async () => {
  const h = harness();
  h.guild.members.cache.set("staff", h.person("staff", true));
  await h.update();
  assert.match(h.panels[0].embeds[0].toJSON().description, /<@staff>/);
  assert.equal(h.alerts.length, 0);
  h.guild.members.cache.clear();
  await h.update();
  assert.equal(h.panels.length, 2);
  assert(!h.panels[1].embeds[0].toJSON().description.includes("<@"));
  assert.equal(h.alerts.length, 1);
});

test("Occupied voice suppresses alert; a later empty transition alerts again", async () => {
  const h = harness();
  await h.update();
  h.guild.voiceStates.cache.set("worker", { channelId: "1129104145715052624", member: h.person("worker") });
  await h.update();
  assert.equal(h.alerts.length, 1);
  assert.match(h.panels[1].embeds[0].toJSON().description, /<@worker>/);
  h.guild.voiceStates.cache.clear();
  await h.update();
  assert.equal(h.alerts.length, 2);
  assert.equal(h.panels.length, 3);
});

test("Failed alert can be retried without duplicating an already published empty template", async () => {
  const h = harness();
  h.fail(true);
  const original = console.error;
  console.error = () => {};
  try { await h.update(); } finally { console.error = original; }
  assert.equal(h.panels.length, 1);
  assert.equal(h.alerts.length, 0);
  h.fail(false);
  await h.update();
  assert.equal(h.panels.length, 1);
  assert.equal(h.alerts.length, 1);
});
