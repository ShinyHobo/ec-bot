import { Client, Message, ThreadChannel } from 'discord.js';
import Database from 'better-sqlite3';
import MessagingChannel from '../channels/messaging-channel';

/** Bot commands for renewing Discord threads automatically */
export abstract class Renew {
    /** The bot base command */
    public static command = '!renew';

    /** The functionality of the command */
    public static description = 'Manages server thread autorenewals. Must be used in a thread (not available for CLI)';

    /** The bot command pattern */
    public static usage = 'Usage: `!renew [on/off]`';

    /**
     * Executes the bot commands
     * @param channel The origin channel that triggered the command, also provides additional command arguments and the database connection
     */
    public static execute(channel: MessagingChannel) {
        if(!channel.getGuild()) {
            channel.send('Command must be run from within discord server!');
            return;
        }

        if(channel.args.length !== 1) {
            channel.reply(this.usage);
            return;
        }

        if(channel.isThread()) {
            if (!channel.isAuthorized()) {
                return;
            }

            const db = channel.db;
            const channelId = channel.getChannelId();
            switch(channel.args[0]) {
                case 'on':
                    // add to db
                    db.prepare('INSERT OR IGNORE INTO threads VALUES (?)').run([channelId]);
                    channel.send(`Thread renewal on.`);
                    break;
                case 'off':
                    // remove from db
                    db.prepare('DELETE FROM threads WHERE id = ?').run([channelId]);
                    channel.send(`Thread renewal off.`);
                    break;
                default:
                    channel.send(this.usage);
                    break;
            }
        } else {
            channel.send('`!renew [on/off]` must must be used within a thread.');
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