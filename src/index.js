require('dotenv').config();

// Set up database
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('ecdb');

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS verification (discord_id TEXT, code TEXT)");
});

db.close();

// Set up bot
const Discord = require('discord.js');
const bot = new Discord.Client();
const TOKEN = process.env.TOKEN;

bot.login(TOKEN);

bot.on('ready', () => {
  console.info(`Logged in as ${bot.user.tag}!`);
});

bot.on('message', msg => {
  if (msg.content === '!ping') {
    msg.reply('pong');
    msg.channel.send('pong pong');

  } else if (msg.content.startsWith('!kick')) {
    if (msg.mentions.users.size) {
      const taggedUser = msg.mentions.users.first();
      msg.channel.send(`You wanted to kick: ${taggedUser.username}`);
    } else {
      msg.reply('Please tag a valid user!');
    }
  }
});