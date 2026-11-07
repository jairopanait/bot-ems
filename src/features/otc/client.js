const { createHash } = require("node:crypto");

const COMPANY_ID = 136217;
const COMPANY_NAME = "EMS-LANARANJARP";
const ENDPOINT = "https://api1.opentimeclock.com/T1-TimeClockFree";

class OtcError extends Error {}

// These requests mirror the public T1 web client. Never log request/response bodies:
// authentication responses can include credentials and other employee data.
function createOtcClient({ fetchImpl = globalThis.fetch } = {}) {
  async function request(cmd, parameters = {}) {
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd, companyId: COMPANY_ID, ...parameters }),
        signal: AbortSignal.timeout(15000),
        redirect: "error"
      });
      if (!response.ok) throw new Error("HTTP error");
      let data = await response.json();
      // Some T1 commands wrap JSON in a JSON string. Do not evaluate JS from OTC.
      if (typeof data === "string" && /^[\[{]/.test(data.trim())) data = JSON.parse(data);
      return data;
    } catch {
      throw new OtcError("No se pudo confirmar la respuesta de OTC. Comprueba tu estado en la web antes de repetir el fichaje.");
    }
  }

  async function clock({ discordId, password, action }) {
    if (!/^[0-9]{17,20}$/.test(discordId) || !["in", "out"].includes(action)) throw new OtcError("Solicitud de fichaje no válida.");
    if (typeof password !== "string" || !password.trim()) throw new OtcError("Introduce tu contraseña de OTC.");
    const md5Password = createHash("md5").update(password.trim()).digest("hex");
    password = null;
    const users = await request("web/sGetOneUserInfo", {
      action: "checkPassword", userName: discordId, md5Password
    });
    if (!Array.isArray(users) || users.length !== 1 || String(users[0].UserName) !== discordId || !users[0].UserId) {
      throw new OtcError("No se ha podido validar tu cuenta. Usa tu contraseña de OTC y comprueba que tu usuario allí sea tu ID de Discord.");
    }
    const user = users[0];
    if (Number(user.Archived || 0) !== 0) throw new OtcError("Tu cuenta de OTC está archivada.");
    const companies = await request("web/sGetCompanyById");
    const company = Array.isArray(companies) && companies.length === 1 ? companies[0] : null;
    if (!company || String(company.CompanyId) !== String(COMPANY_ID) || company.CompanyName !== COMPANY_NAME) {
      throw new OtcError("No se pudo comprobar la compañía de OTC.");
    }
    const extraRequirements = ["FeatureClockPoint", "FeatureJob", "FeatureShift", "FeatureWeeklyShiftPlan"];
    const cameraRequired = String(company.CameraRequired) === "2" ? Number(user.CameraRequired || 0) : Number(company.CameraRequired);
    if (String(company.UserClockEnabled) !== "1" || extraRequirements.some((key) => Number(company[key] || 0) !== 0)
      || cameraRequired !== 0 || Number(user.GpsRequired || 0) !== 0
      || (String(company.FeatureMessage) === "1" && String(company.ForceReadingMessage) === "1")) {
      throw new OtcError("Tu cuenta requiere opciones o verificaciones adicionales. Realiza el fichaje desde la web de OpenTimeClock.");
    }
    const timeZone = String(user.TimeZoneRule) === "0" ? company.HeadOfficeTimeZone : user.TimeZone;
    try { new Intl.DateTimeFormat("es-ES", { timeZone }).format(); } catch { throw new OtcError("No se pudo comprobar tu zona horaria de OTC."); }
    if (!timeZone) throw new OtcError("No se pudo comprobar tu zona horaria de OTC.");
    const stateParameters = {
      userId: String(user.UserId), timeZone, featureWeeklyShiftPlan: company.FeatureWeeklyShiftPlan
    };
    const state = await request("web/sGetUserInfo", stateParameters);
    if (!state || !["in", "out"].includes(state.toio) || state.timecardId === undefined || state.jobId === undefined || state.sInDateTime === undefined) {
      throw new OtcError("No se pudo comprobar tu estado actual. Revisa tu fichaje en OTC.");
    }
    if (state.toio !== action) {
      throw new OtcError(action === "in" ? "Ya tienes una entrada activa en OTC. No se ha creado otra." : "No tienes una entrada activa en OTC. No se ha registrado una salida.");
    }
    const result = await request("web/sClock", {
      entranceType: "web user clock", fullName: "", userId: user.UserId,
      timecardId: state.timecardId, lastJobId: state.jobId,
      departmentId: user.DepartmentId, deviceId: "-1", timeZone,
      timeIn: state.sInDateTime, io: action, jobId: "-1", shiftId: "-1",
      ip: "", employeeNote: "", roundTime: company.RoundTime,
      latitude: "", longitude: "", wifiId: "",
      earlyLimitEnabled: user.EarlyLimitEnabled, earlyLimitTime: user.EarlyLimitTime,
      earlyLimitTimeSaved: user.EarlyLimitTimeSaved, lateLimitEnabled: user.LateLimitEnabled,
      lateLimitTime: user.LateLimitTime, lateLimitTimeSaved: user.LateLimitTimeSaved,
      noBreakLockOut: user.NoBreakLockOut, noBreakLockOutHours: user.NoBreakLockOutHours
    });
    // Never retry writes, or interpret an arbitrary successful HTTP response as a punch.
    if (result !== "SUCCESS") throw new OtcError("OTC no ha confirmado el fichaje. Revisa tu estado en su web antes de volver a intentarlo.");
    return { action, confirmedAt: new Date() };
  }
  return { clock };
}

module.exports = { createOtcClient, OtcError, COMPANY_NAME };
