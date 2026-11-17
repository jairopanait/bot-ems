const test = require("node:test");
const assert = require("node:assert/strict");
const { Events } = require("discord.js");
const feature = require("../src/features/rank-request");

const expected = [
  ["Director/a general", "14"], ["Director/a", "13"], ["Subdirector/a", "12"],
  ["Jefe/a", "11"], ["Subjefe/a", "10"], ["Jefe/a Doctores", "9"],
  ["Doctor/a Experto/a", "8"], ["Doctor/a", "7"], ["Médicos Adscritos", "6"],
  ["Medico Residente", "5"], ["Medico Pasante", "4"], ["Médico Interno", "3"],
  ["Paramédico", "2"], ["Enfermero/a", "1"], ["Enfermero/a Aprendiz", "0"]
];

async function run(grade, { allowed = true, timeout = false } = {}) {
  const handlers = {}, outputs = [], replies = [];
  let modal, commandDeleted = 0, promptDeleted = 0;
  const user = { id: "752666296524734526", tag: "person" };
  const submission = {
    user, reply: async (p) => replies.push(p), deferReply: async (p) => assert.equal(p.ephemeral, true), editReply: async () => {},
    fields: { getStringSelectValues: (key) => { assert.equal(key, "rank"); return [grade]; }, getTextInputValue: (key) => { assert.equal(key, "id"); return "42"; } }
  };
  const opener = {
    showModal: async (builder) => { modal = builder.toJSON(); submission.customId = modal.custom_id; },
    awaitModalSubmit: async (options) => {
      assert.equal(options.filter({ ...submission, customId: "another-form" }), false);
      assert.equal(options.filter({ ...submission, user: { id: "another-user" } }), false);
      assert.equal(options.filter(submission), true);
      return submission;
    }
  };
  const prompt = {
    delete: async () => { promptDeleted++; },
    awaitMessageComponent: async ({ filter }) => {
      if (timeout) throw Object.assign(new Error("expired"), { code: "InteractionCollectorError" });
      assert.equal(filter({ user }), true);
      return opener;
    }
  };
  feature.register({
    on: (event, fn) => { handlers[event] = fn; },
    channels: { fetch: async (id) => { assert.equal(id, "1129103844517888131"); return { isTextBased: () => true, guildId: "guild", send: async (p) => outputs.push(p) }; } }
  }, { guildId: "guild" });
  await handlers[Events.MessageCreate]({
    id: "message", inGuild: () => true, author: { ...user, bot: false, send: async () => {} }, content: "!rango",
    guild: { members: { fetch: async () => ({ roles: { cache: new Map(allowed ? [["1129103467294769214", true]] : []) } }) } },
    delete: async () => { commandDeleted++; }, channel: { send: async () => prompt }
  });
  return { modal, outputs, replies, commandDeleted, promptDeleted };
}

for (const [label, grade] of expected) test(`${label} // ambulance ${grade}`, async () => {
  const result = await run(grade);
  assert.equal(result.commandDeleted, 1);
  assert.equal(result.promptDeleted, 1);
  const components = result.modal.components.map((label) => label.component);
  assert.deepEqual(components[0].options.map((option) => [option.label, option.value]), expected);
  assert.equal(components[0].min_values, 1);
  assert.equal(components[0].max_values, 1);
  assert.equal(components[1].custom_id, "id");
  assert.equal(result.outputs.length, 1);
  const payload = result.outputs[0];
  assert.equal(payload.content, "<@&1129103460361576589>");
  assert.deepEqual(payload.allowedMentions, { roles: ["1129103460361576589"] });
  const fields = payload.embeds[0].toJSON().fields;
  assert.equal(fields.find((field) => field.name.includes("Rango")).value, `${label} // ambulance ${grade}`);
  assert.equal(fields.find((field) => field.name === "🆔 ID").value, "`42`");
});
test("Rejects a grade outside the menu", async () => {
  const result = await run("15");
  assert.equal(result.outputs.length, 0);
  assert.match(result.replies.at(-1).content, /rango válido/);
});
test("Keeps existing permissions", async () => {
  const result = await run("14", { allowed: false });
  assert.equal(result.modal, undefined);
  assert.equal(result.outputs.length, 0);
  assert.equal(result.commandDeleted, 1);
});
test("Expired command removes its temporary prompt", async () => {
  const result = await run("14", { timeout: true });
  assert.equal(result.promptDeleted, 1);
  assert.equal(result.outputs.length, 0);
});
