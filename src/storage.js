const fs = require("node:fs");
const path = require("node:path");

function createJsonStore(dataDir, filename, initialValue) {
  const file = path.resolve(dataDir, filename);

  function ensure() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(initialValue, null, 2));
  }

  function read() {
    ensure();
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  function write(data) {
    ensure();
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
    fs.renameSync(temporary, file);
  }

  return { file, read, write };
}

module.exports = { createJsonStore };
