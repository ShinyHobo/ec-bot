import { Message } from 'discord.js';
import Database from 'better-sqlite3';
module.exports = {
    name: '!ping',
    description: 'Replies with pong',
    usage: 'Usage: `!ping`',
    execute(msg: Message, args: Array<string>, db: Database) {
        msg.reply('pong').catch(console.error);
        // msg.channel.send('pong');
        // msg.author.send('pong');
    }
};