import { Message } from 'discord.js';
import Database from 'better-sqlite3';
module.exports = {
    name: '!roadmap',
    description: 'Keeps track of roadmap changes from week to week',
    usage: 'Usage: `!roadmap`',
    execute(msg: Message, args: Array<string>, db: Database) {
        if(args.length) {
            msg.reply(this.usage);
            return;
        }
    }
};