import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import Migration from './migration';
import DiscordChannel from './channels/discord-channel';
import ConsoleChannel from './channels/console-channel';
import MessagingChannel from './channels/messaging-channel';

dotenv.config();

// Set up database
const db = new Database('delta.db');

// Run db migrations
Migration.run(db);

// Closes database connection on server shutdown
process.on('SIGINT', () => {
  try {
    db.close();
  } catch(ex) {}
});

evaluateCommandlineArgs();


function evaluateCommandlineArgs() {
    const args = process.argv.slice(2);

    let channel: MessagingChannel;
    if (args.length == 0) {
        channel = new DiscordChannel(db); // start discord bot, uses the args that will come from the user discord message
    } else {
        channel = new ConsoleChannel(db, args); // use cli, uses the args from the command line
    }
    channel.run();
}
