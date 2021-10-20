import { Message, Client, ThreadChannel } from 'discord.js';
import Database from 'better-sqlite3';
module.exports = {
    name: '!renew',
    description: 'Manages server thread autorenewals. Must be used in a thread.',
    usage: 'Usage: `!renew [on/off]`',
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
            const officer = msg.guild.roles.cache.find(role => role.name === 'Officer');
            if(officer && msg.member.roles.highest.comparePositionTo(officer) < 0) {
                msg.reply("You have insufficient privileges. An officer or above is required.");
                return;
            }
            
            switch(args[0]) {
                case 'on':
                    // add to db
                    db.prepare('INSERT OR IGNORE INTO threads VALUES (?)').run([msg.channelId]);
                    msg.reply(`Thread renewal on.`);
                    break;
                case 'off':
                    // remove from db
                    db.prepare('DELETE FROM threads WHERE id = ?').run([msg.channelId]);
                    msg.reply(`Thread renewal off.`);
                    break;
                default:
                    msg.reply(this.usage);
                    break;
            }
        } else {
            msg.reply('`!renew [on/off]` must must be used within a thread.');
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