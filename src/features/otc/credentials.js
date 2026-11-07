const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");

// Store only the credential digest expected by T1, encrypted with AES-256-GCM.
// The random master key stays on the persistent volume, never in source or logs.
function createCredentialStore(dataDir, guildId) {
  const directory = path.resolve(dataDir, "otc-private");
  const keyFile = path.join(directory, "master.key");
  const vaultFile = path.join(directory, "credentials.json");
  function read() {
    try { return JSON.parse(fs.readFileSync(vaultFile, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return {}; throw new Error("No se pudo leer el almacén OTC."); }
  }
  function key(create = false) {
    try {
      const value = fs.readFileSync(keyFile);
      if (value.length !== 32) throw new Error("Invalid key");
      return value;
    } catch (error) {
      if (error.code !== "ENOENT" || !create || Object.keys(read()).length) throw new Error("La clave del almacén OTC no está disponible.");
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
      try { fs.writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" }); }
      catch (writeError) { if (writeError.code !== "EEXIST") throw new Error("No se pudo crear la clave OTC."); }
      return key();
    }
  }
  const identity = (userId) => `${guildId}:${userId}`;
  return {
    get(userId) {
      const record = read()[identity(userId)];
      if (!record) return null;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(record.iv, "base64"));
        decipher.setAAD(Buffer.from(identity(userId)));
        decipher.setAuthTag(Buffer.from(record.tag, "base64"));
        const value = Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8");
        if (!/^[a-f0-9]{32}$/.test(value)) throw new Error("Invalid credential");
        return value;
      } catch { throw new Error("No se pudo descifrar el acceso OTC guardado."); }
    },
    listUserIds() {
      const prefix = `${guildId}:`;
      return Object.keys(read()).filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
    },
    set(userId, credential) {
      if (!/^[a-f0-9]{32}$/.test(credential)) throw new Error("Credencial OTC no válida.");
      const masterKey = key(true);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
      cipher.setAAD(Buffer.from(identity(userId)));
      const data = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
      const records = read();
      records[identity(userId)] = { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
      const temporary = `${vaultFile}.${randomBytes(8).toString("hex")}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(records), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, vaultFile);
    }
  };
}
module.exports = { createCredentialStore };
