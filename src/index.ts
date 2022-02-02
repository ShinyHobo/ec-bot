import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import { Client, Intents, Collection, ThreadChannel, Message } from 'discord.js';
import * as botCommands from './commands/index.js';
import Migration from './migration';

dotenv.config();

// Set up database
const db = new Database('ecdb.db');

// Run db migrations
Migration.run(db);

// Closes database connection on server shutdown
process.on('SIGINT', () => {
  try {
    db.close();
  } catch(ex) {}
});

// Set up bot
const bot = new Client({ intents: [Intents.FLAGS.DIRECT_MESSAGES, Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES], partials: ["CHANNEL"] });
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
  botCommands.Renew.unarchiveAll(bot, db);
});

// Watch the message history for commands
bot.on('messageCreate', (msg: Message) => {
  if(msg.author.bot) {
    return;
  }

  let args = msg.content.split(/ +/);
  let command: any = args.shift().toLowerCase();
  //console.info(`Called command: ${command}`);

  if (!commands.has(command)) return;

  try {
    command = commands.get(command);
    command.execute(msg, args, db);
  } catch (error) {
    console.error(error);
    msg.channel.send('There was an error trying to execute that command!').catch(console.error);
  }
});

bot.on('threadUpdate', (oldThread: ThreadChannel, newThread: ThreadChannel) => {
  botCommands.Renew.unarchive(newThread, db);
});