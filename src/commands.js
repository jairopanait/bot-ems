const birthdays = require("./features/birthdays");
const postulations = require("./features/postulations");
const inactivity = require("./features/inactivity");

module.exports = [...birthdays.commands, ...postulations.commands, ...inactivity.commands];
