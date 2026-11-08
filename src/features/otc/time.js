// T1 returns local date-times without an offset. Resolve them in the account's
// IANA time zone rather than letting the host's TZ interpret them.
function parseOtcDateTime(value, timeZone) {
  if (typeof value !== "string") return NaN;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second = "0", fraction = "", offset] = match;
  const fields = [Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second)];
  if (fields[0] < 1000) return NaN;
  const wall = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5], Number(`0${fraction}`) * 1000);
  const date = new Date(wall);
  const actual = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
  if (fields.some((field, index) => field !== actual[index])) return NaN;
  if (offset) return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second.padStart(2, "0")}${fraction}${offset}`);
  if (!timeZone) return NaN;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    });
    function localFields(timestamp) {
      const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
      return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].map(Number);
    }
    const offsets = new Set();
    for (let hours = -36; hours <= 36; hours += 12) {
      const probe = Math.floor((wall + hours * 3600000) / 1000) * 1000;
      const local = localFields(probe);
      offsets.add(Date.UTC(local[0], local[1] - 1, local[2], local[3], local[4], local[5]) - probe);
    }
    const candidates = [...offsets].map((zoneOffset) => wall - zoneOffset)
      .filter((timestamp) => localFields(timestamp).every((field, index) => field === fields[index]));
    // A missing/duplicated DST hour cannot identify one instant without an offset.
    return candidates.length === 1 ? candidates[0] : NaN;
  } catch { return NaN; }
}

function elapsedMilliseconds(startedAt, finishedAt, timeZone) {
  const start = parseOtcDateTime(startedAt, timeZone);
  const end = finishedAt instanceof Date ? finishedAt.getTime() : finishedAt;
  const elapsed = end - start;
  return Number.isFinite(start) && Number.isFinite(end) && elapsed >= 0 ? elapsed : NaN;
}

function formatDuration(startedAt, finishedAt, timeZone) {
  const elapsed = elapsedMilliseconds(startedAt, finishedAt, timeZone);
  if (!Number.isFinite(elapsed)) return "No disponible";
  const minutes = Math.floor(elapsed / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

module.exports = { parseOtcDateTime, elapsedMilliseconds, formatDuration };
