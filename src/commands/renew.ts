import { Message, Client, ThreadChannel } from 'discord.js';
import Database from 'better-sqlite3';

/** Bot commands for renewing Discord threads automatically */
export abstract class Renew {
    /** The bot base command */
    public static command = '!renew';

    /** The functionality of the command */
    public static description = 'Manages server thread autorenewals. Must be used in a thread.';

    /** The bot command pattern */
    public static usage = 'Usage: `!renew [on/off]`';

    /**
     * Executes the bot commands
     * @param msg The msg that triggered the command
     * @param args Available arguments included with the command
     * @param db The database connection
     */
    public static execute(msg: Message, args: Array<string>, db: Database) {
        if(!msg.guild) {
            msg.channel.send('Command must be run from within server!').catch(console.error);
            return;
        }

        if(args.length !== 1) {
            msg.reply(this.usage).catch(console.error);
            return;
        }

        if(msg.channel.isThread()) {
            const officer = msg.guild.roles.cache.find(role => role.name === 'Officer');
            if(officer && msg.member.roles.highest.comparePositionTo(officer) < 0) {
                msg.reply("You have insufficient privileges. An officer or above is required.").catch(console.error);
                return;
            }
            
            switch(args[0]) {
                case 'on':
                    // add to db
                    db.prepare('INSERT OR IGNORE INTO threads VALUES (?)').run([msg.channelId]);
                    msg.channel.send(`Thread renewal on.`).catch(console.error);
                    break;
                case 'off':
                    // remove from db
                    db.prepare('DELETE FROM threads WHERE id = ?').run([msg.channelId]);
                    msg.channel.send(`Thread renewal off.`).catch(console.error);
                    break;
                default:
                    msg.channel.send(this.usage).catch(console.error);
                    break;
            }
        } else {
            msg.channel.send('`!renew [on/off]` must must be used within a thread.').catch(console.error);
        }
    }

    /**
     * Unarchives all available, accessable threads that have been stored
     * @param bot The bot client
     * @param db The database connection
     */
    public static unarchiveAll(bot: Client, db: Database) {
        // look up stored threads here
        const threads = db.prepare('SELECT * FROM threads').all();
        threads.forEach((thread) => {
            bot.channels.fetch(thread.id).then((thread: ThreadChannel) => {
                if(thread.archived) {
                    thread.setArchived(false, "Auto-renew").catch(error => {
                        console.info(`Failed to auto-renew ${thread.name} with id ${thread.id}`);
                        console.info(error);
                    });
                }
            }).catch(e=>{
                db.prepare('DELETE FROM threads WHERE id = ?').run([thread.id]);
            });
        });
    }

    /**
     * Unarchives a specified thread
     * @param thread The thread to unarchive
     * @param db The database connection
     */
    public static unarchive(thread: ThreadChannel, db: Database) {
        if(thread.archived) {
            const found = db.prepare('SELECT COUNT(*) FROM threads WHERE id = ?').get(thread.id)['COUNT(*)'];
            if(found) {
                thread.setArchived(false, "Auto-renew");
            }
        }
    }
};