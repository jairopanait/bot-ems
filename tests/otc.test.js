const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Events, ButtonStyle } = require("discord.js");
const { createOtcClient, OtcError, OtcAuthError } = require("../src/features/otc/client");
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
  assert.deepEqual(buttons.map((b) => [b.label, b.style]), [["ENTRADA", ButtonStyle.Success], ["SALIDA", ButtonStyle.Danger], ["RESTAR HORAS", ButtonStyle.Secondary]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "otc-panel.json"))), { panelMessageId: "panel" });
});

test("First private form links account; later buttons clock directly with no password", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ems-otc-modal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {}, calls = [], replies = [], logs = [];
  let time = 100000, modalId, modalCount = 0, valid = true;
  const credential = "a".repeat(32);
  const config = { guildId: "guild", dataDir: dir };
  const client = { once: () => {}, on: (e, fn) => { handlers[e] = fn; }, channels: { fetch: async () => ({ guildId: "guild", isTextBased: () => true, send: async (p) => logs.push(p) }) } };
  const otc = {
    authenticate: async ({ password }) => { assert.equal(password, "private-fixture"); return { credential }; },
    getCurrentShift: async () => ({ state: { sInDateTime: new Date(time - 3600000).toISOString() }, timeZone: "Europe/Madrid" }),
    clock: async (args) => { if (!valid) throw new OtcAuthError("Contraseña cambiada"); calls.push(args); return { action: args.action, confirmedAt: new Date() }; }
  };
  feature.register(client, config, { now: () => time, otc });
  const base = { inGuild: () => true, guildId: "guild", channelId: "1568448649833480360", user: { id: userId }, reply: async (p) => replies.push(p), isButton: () => false, isModalSubmit: () => false,
    deferReply: async (p) => { assert.equal(p.ephemeral, true); }, editReply: async (p) => replies.push(p) };
  const button = { ...base, isButton: () => true, customId: "otc:in", showModal: async (m) => { modalCount++; modalId = m.toJSON().custom_id; } };
  const submit = () => ({ ...base, isModalSubmit: () => true, customId: modalId, fields: { getTextInputValue: () => "private-fixture" } });
  await handlers[Events.InteractionCreate](button);
  await handlers[Events.InteractionCreate]({ ...submit(), user: { id: "other" } });
  assert.equal(calls.length, 0);
  await handlers[Events.InteractionCreate](submit());
  assert.deepEqual(calls[0], { discordId: userId, credential, action: "in" });
  assert.equal(logs.length, 0);
  assert(!JSON.stringify(logs).includes("private-fixture"));
  await handlers[Events.InteractionCreate](submit());
  assert.equal(calls.length, 1); // Single use.
  await handlers[Events.InteractionCreate](button);
  assert.equal(calls.length, 1); // Cooldown.
  time += 31000;
  feature.register(client, config, { now: () => time, otc }); // Restart with persisted credentials.
  await handlers[Events.InteractionCreate]({ ...button, customId: "otc:out" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].action, "out");
  assert.equal(modalCount, 1);
  time += 31000;
  valid = false;
  await handlers[Events.InteractionCreate](button);
  assert.equal(logs.length, 0); // OTC punches are intentionally excluded from command logs.
  const renewalId = replies.at(-1).components[0].toJSON().components[0].custom_id;
  assert.equal(renewalId, "otc:renew:in");
  await handlers[Events.InteractionCreate]({ ...button, customId: renewalId });
  assert.equal(modalCount, 2);
  time += 300001;
  await handlers[Events.InteractionCreate](submit());
  assert.match(replies.at(-1).content, /caducado/);
  assert.equal(calls.length, 2);
});

const { createCredentialStore } = require("../src/features/otc/credentials");
test("Credential is encrypted at rest, survives restart, and rejects tampering/user swaps", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ems-otc-vault-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createCredentialStore(dir, "guild");
  assert.equal(store.get(userId), null);
  const credential = "a".repeat(32);
  store.set(userId, credential);
  const vaultFile = path.join(dir, "otc-private", "credentials.json");
  assert(!fs.readFileSync(vaultFile, "utf8").includes(credential));
  assert.equal(fs.statSync(vaultFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(dir, "otc-private", "master.key")).mode & 0o777, 0o600);
  assert.equal(createCredentialStore(dir, "guild").get(userId), credential);
  store.set(userId, "b".repeat(32));
  assert.equal(store.get(userId), "b".repeat(32));
  const records = JSON.parse(fs.readFileSync(vaultFile));
  records["guild:other"] = records[`guild:${userId}`];
  fs.writeFileSync(vaultFile, JSON.stringify(records));
  assert.throws(() => store.get("other"), /descifrar/);
  records[`guild:${userId}`].data = Buffer.from("corrupted").toString("base64");
  fs.writeFileSync(vaultFile, JSON.stringify(records));
  assert.throws(() => store.get(userId), /descifrar/);
  fs.unlinkSync(path.join(dir, "otc-private", "master.key"));
  assert.throws(() => store.set(userId, credential), /clave/); // Never replace a lost master key silently.
});

test("Incorrect first password is not persisted and never clocks", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ems-otc-invalid-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {}, replies = [];
  let modalId;
  feature.register({ once: () => {}, on: (event, fn) => { handlers[event] = fn; } }, { guildId: "guild", dataDir: dir }, {
    otc: { authenticate: async () => { throw new OtcAuthError("Contraseña incorrecta"); }, clock: async () => assert.fail("Must not clock") }
  });
  const base = { inGuild: () => true, guildId: "guild", channelId: "1568448649833480360", user: { id: userId }, isButton: () => false, isModalSubmit: () => false };
  await handlers[Events.InteractionCreate]({ ...base, isButton: () => true, customId: "otc:in", showModal: async (m) => { modalId = m.toJSON().custom_id; } });
  await handlers[Events.InteractionCreate]({ ...base, isModalSubmit: () => true, customId: modalId, fields: { getTextInputValue: () => "incorrect" }, deferReply: async () => {}, editReply: async (p) => replies.push(p) });
  assert.match(replies[0].content, /incorrecta/);
  assert.equal(createCredentialStore(dir, "guild").get(userId), null);
  assert(!fs.existsSync(path.join(dir, "otc-private", "master.key")));
});
