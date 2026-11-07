const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Events, ButtonStyle } = require("discord.js");
const { createOtcClient, OtcError } = require("../src/features/otc/client");
const feature = require("../src/features/otc");

const userId = "752666296524734526";
const company = {
  CompanyId: 136217, CompanyName: "EMS-LANARANJARP", UserClockEnabled: 1,
  CameraRequired: 0, FeatureClockPoint: 0, FeatureJob: 0, FeatureShift: 0,
  FeatureWeeklyShiftPlan: 0, HeadOfficeTimeZone: "Europe/Madrid", RoundTime: 1
};
const user = { UserName: userId, UserId: 42, DepartmentId: 3, TimeZoneRule: 0, GpsRequired: 0, Archived: 0 };
const state = { toio: "in", timecardId: -1, jobId: -1, sInDateTime: "" };

function remote({ account = [user], settings = [company], currentState = state, writeResult = "SUCCESS", writeThrows = false } = {}) {
  const requests = [];
  const otc = createOtcClient({ fetchImpl: async (url, options) => {
    assert.equal(url, "https://api1.opentimeclock.com/T1-TimeClockFree");
    const body = JSON.parse(options.body);
    requests.push(body);
    assert.equal(body.companyId, 136217);
    if (body.cmd === "web/sClock" && writeThrows) throw new Error("Sensitive remote error must not propagate");
    const values = { "web/sGetOneUserInfo": account, "web/sGetCompanyById": settings, "web/sGetUserInfo": currentState, "web/sClock": writeResult };
    return { ok: true, json: async () => values[body.cmd] };
  } });
  return { otc, requests };
}

for (const action of ["in", "out"]) test(`Authenticated ${action} matches T1 payload and only confirms SUCCESS`, async () => {
  const { otc, requests } = remote({ currentState: { ...state, toio: action } });
  const result = await otc.clock({ discordId: userId, password: "secret-fixture", action });
  assert.equal(result.action, action);
  assert(result.confirmedAt instanceof Date);
  assert.match(requests[0].md5Password, /^[a-f0-9]{32}$/);
  const punch = requests.at(-1);
  assert.equal(punch.io, action);
  assert.equal(punch.userId, user.UserId);
  assert.equal(punch.timeZone, "Europe/Madrid");
  assert.equal(punch.roundTime, company.RoundTime);
  assert(!JSON.stringify(requests).includes("secret-fixture"));
  assert.equal(punch.password, undefined);
  assert.equal(punch.md5Password, undefined);
});

for (const [name, options] of [
  ["invalid password", { account: "PASSWORDERROR" }],
  ["different user", { account: [{ ...user, UserName: "someone-else" }] }],
  ["archived user", { account: [{ ...user, Archived: 1 }] }],
  ["GPS required", { account: [{ ...user, GpsRequired: 1 }] }],
  ["camera required", { settings: [{ ...company, CameraRequired: 1 }] }],
  ["user camera required", { settings: [{ ...company, CameraRequired: 2 }], account: [{ ...user, CameraRequired: 1 }] }],
  ["restricted clock points", { settings: [{ ...company, FeatureClockPoint: 2 }] }],
  ["job selection required", { settings: [{ ...company, FeatureJob: 1 }] }],
  ["company mismatch", { settings: [{ ...company, CompanyId: 99 }] }],
  ["already clocked in", { currentState: { ...state, toio: "out" } }],
  ["unknown state", { currentState: {} }]
]) test(`${name} never writes a punch`, async () => {
  const { otc, requests } = remote(options);
  await assert.rejects(otc.clock({ discordId: userId, password: "fixture", action: "in" }), OtcError);
  assert(!requests.some((r) => r.cmd === "web/sClock"));
});

for (const options of [{ writeResult: "ERROR" }, { writeResult: { success: true } }, { writeThrows: true }]) test("Unconfirmed write is not retried or reported as success", async () => {
  const { otc, requests } = remote(options);
  await assert.rejects(otc.clock({ discordId: userId, password: "fixture", action: "in" }), OtcError);
  assert.equal(requests.filter((r) => r.cmd === "web/sClock").length, 1);
});

test("Panel persists, reuses one message, and shows green ENTRADA/red SALIDA", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ems-otc-panel-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const payloads = [];
  const channel = { guildId: "guild", isTextBased: () => true, send: async (p) => { payloads.push(p); return { id: "panel" }; }, messages: { fetch: async () => ({ edit: async (p) => payloads.push(p) }) } };
  let ready;
  const client = { channels: { fetch: async () => channel }, once: (_event, fn) => { ready = fn; }, on: () => {} };
  feature.register(client, { guildId: "guild", dataDir: dir });
  ready();
  await new Promise(setImmediate);
  feature.register(client, { guildId: "guild", dataDir: dir });
  ready();
  await new Promise(setImmediate);
  assert.equal(payloads.length, 2);
  const buttons = payloads[0].components[0].toJSON().components;
  assert.deepEqual(buttons.map((b) => [b.label, b.style]), [["ENTRADA", ButtonStyle.Success], ["SALIDA", ButtonStyle.Danger]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "otc-panel.json"))), { panelMessageId: "panel" });
});

test("Private modal binds identity, expires, limits retries, and logs only confirmed punches", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ems-otc-modal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {}, calls = [], replies = [], logs = [];
  let time = 100000, modalId;
  feature.register({ once: () => {}, on: (e, fn) => { handlers[e] = fn; }, channels: { fetch: async () => ({ guildId: "guild", isTextBased: () => true, send: async (p) => logs.push(p) }) } },
    { guildId: "guild", dataDir: dir }, { now: () => time, otc: { clock: async (args) => { calls.push(args); return { action: args.action, confirmedAt: new Date() }; } } });
  const base = { inGuild: () => true, guildId: "guild", channelId: "1568448649833480360", user: { id: userId }, reply: async (p) => replies.push(p), isButton: () => false, isModalSubmit: () => false };
  const button = { ...base, isButton: () => true, customId: "otc:in", showModal: async (m) => { modalId = m.toJSON().custom_id; } };
  const submit = () => ({ ...base, isModalSubmit: () => true, customId: modalId, fields: { getTextInputValue: () => "private-fixture" }, deferReply: async (p) => { assert.equal(p.ephemeral, true); }, editReply: async (p) => replies.push(p) });
  await handlers[Events.InteractionCreate](button);
  await handlers[Events.InteractionCreate]({ ...submit(), user: { id: "other" } });
  assert.equal(calls.length, 0);
  await handlers[Events.InteractionCreate](submit());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { discordId: userId, password: "private-fixture", action: "in" });
  assert.equal(logs.length, 1);
  assert(!JSON.stringify(logs).includes("private-fixture"));
  await handlers[Events.InteractionCreate](submit());
  assert.equal(calls.length, 1); // One-time token.
  await handlers[Events.InteractionCreate](button);
  await handlers[Events.InteractionCreate](submit());
  assert.equal(calls.length, 1); // Cooldown.
  time += 31000;
  await handlers[Events.InteractionCreate](button);
  time += 300001;
  await handlers[Events.InteractionCreate](submit());
  assert.equal(calls.length, 1); // Expired modal.
  await handlers[Events.InteractionCreate]({ ...button, channelId: "wrong" });
  assert.equal(calls.length, 1);
});
