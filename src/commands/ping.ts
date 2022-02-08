import { Message } from 'discord.js';
import Database from 'better-sqlite3';
export abstract class Ping {
    /** The bot base command */
    public static readonly command = '!ping';

    /** The description */
    public static readonly description: 'Replies with pong';

    /** The bot command pattern */
    public static readonly usage: 'Usage: `!ping`';

    /**
     * Executes the bot commands
     * @param msg The msg that triggered the command
     * @param args Available arguments included with the command
     * @param db The database connection
     */
    public static execute(msg: Message, args: Array<string>, db: Database) {
        msg.channel.send('pong').catch(console.error);
        // msg.channel.send('pong');
        // msg.author.send('pong');
    }
};