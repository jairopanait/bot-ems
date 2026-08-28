function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseBirthday(input) {
  const match = input.trim().match(/(?:^|\D)(\d{1,2})(?:\s*[/-]\s*|\s+)(\d{1,2})(?:\D|$)/);
  if (!match) return { error: "Usa el formato día/mes. Ejemplo: 25/8" };

  let day = Number(match[1]);
  let month = Number(match[2]);
  if (month > 12 && day <= 12) [day, month] = [month, day];
  if (month < 1 || month > 12) return { error: "El mes debe estar entre 1 y 12." };
  if (day < 1 || day > new Date(2024, month, 0).getDate()) {
    return { error: `El día no es válido para el mes ${month}.` };
  }
  return { birthday: { day, month } };
}

function getTodayParts(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function isBirthdayToday(birthday, today) {
  return (birthday.month === today.month && birthday.day === today.day) ||
    (birthday.month === 2 && birthday.day === 29 && today.month === 2 && today.day === 28 && !isLeapYear(today.year));
}

function formatBirthday(birthday) {
  return `${String(birthday.day).padStart(2, "0")}/${String(birthday.month).padStart(2, "0")}`;
}

module.exports = { parseBirthday, getTodayParts, isBirthdayToday, formatBirthday };
