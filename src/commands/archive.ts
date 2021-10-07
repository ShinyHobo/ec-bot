import { Message, Client, ThreadChannel } from 'discord.js';
import Database from 'better-sqlite3';
module.exports = {
    name: '!archive',
    description: 'Manages server thread keepalives',
    usageTxt: 'Usage: `!archive [on/off]` to keep an archive alive indefinitely. Must be used in a thread.',
    execute(msg: Message, args: Array<string>, db: Database) {
        if(!msg.guild) {
            msg.reply('Command must be run from within server!');
            return;
        }

        if(args.length !== 1) {
            msg.reply(this.usage);
            return;
        }

        if(msg.channel.isThread()) {
            // TODO check if sufficient privileges
            
            switch(args[0]) {
                case 'on':
                    // remove from db
                    db.prepare('DELETE FROM threads WHERE id = ?').run([msg.channelId]);
                    msg.reply(`Thread renewal off.`);
                    break;
                case 'off':
                    // add to db
                    db.prepare('INSERT OR IGNORE INTO threads VALUES (?)').run([msg.channelId]);
                    msg.reply(`Thread renewal on.`);
                    break;
                default:
                    msg.reply(this.usage);
                    break;
            }
        } else {
            msg.reply('`!archive [on/off]` must must be used within a thread.');
        }
    },
    unarchiveAll(bot: Client, db: Database) {
        // look up stored threads here
        const threads = db.prepare('SELECT * FROM threads').all();
        threads.forEach((thread) => {
            bot.channels.fetch(thread.id).then((thread: ThreadChannel) => {
                thread.setArchived(false, "Auto-renew");
            });
        });
    },
    unarchive(thread: ThreadChannel, db: Database) {
        if(thread.archived) {
            const found = db.prepare('SELECT COUNT(*) FROM threads WHERE id = ?').get(thread.id)['COUNT(*)'];
            if(found) {
                thread.setArchived(false, "Auto-renew");
            }
        }
    }
};