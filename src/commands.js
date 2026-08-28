const birthdays = require("./features/birthdays");
const postulations = require("./features/postulations");

module.exports = [...birthdays.commands, ...postulations.commands];
