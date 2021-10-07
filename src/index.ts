import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { Client, Intents, Collection, ThreadChannel, Message } from 'discord.js';
import * as botCommands from './commands/index.js';

dotenv.config();

// Set up database
var db = new Database('ecdb.db');

// Initialize database
db.prepare("CREATE TABLE IF NOT EXISTS verification (discord_id TEXT, code TEXT, UNIQUE(discord_id))").run();
db.prepare("CREATE TABLE IF NOT EXISTS threads(id TEXT, UNIQUE(id))").run();
db.prepare("CREATE TABLE IF NOT EXISTS roadmap(json TEXT, date INTEGER, PRIMARY KEY(date))").run();

// Closes database connection on server shutdown
process.on('SIGINT', () => {
  db.close();
});

// check for archives that have been requested for renewal

// Set up bot
const bot = new Client({ intents: [Intents.FLAGS.DIRECT_MESSAGES, Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
// Set up bot commands
let commands = new Collection();

Object.keys(botCommands).map(key => {
  commands.set(botCommands[key].name, botCommands[key]);
});

bot.login(process.env.TOKEN);

bot.on('ready', () => {
  console.info(`Logged in as ${bot.user.tag}!`);
  bot.user.setPresence({ status: 'online', activities: [{ name: 'with my sourcecode', type: 'PLAYING', url: 'https://github.com/ShinyHobo/ec-bot'}]});
  // Unarchive archived threads
  botCommands.Archive.unarchiveAll(bot, db);
});

// Watch the message history for commands
bot.on('messageCreate', (msg: Message) => {
  if(msg.author.bot) {
    return;
  }

  let args = msg.content.split(/ +/);
  let command: any = args.shift().toLowerCase();
  console.info(`Called command: ${command}`);

  if (!commands.has(command)) return;

  try {
    command = commands.get(command);
    command.execute(msg, args, db);
  } catch (error) {
    console.error(error);
    msg.reply('There was an error trying to execute that command!');
  }
});

bot.on('threadUpdate', (oldThread: ThreadChannel, newThread: ThreadChannel) => {
  botCommands.Archive.unarchive(newThread, db);
});