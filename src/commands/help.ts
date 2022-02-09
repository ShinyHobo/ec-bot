import { Message } from 'discord.js';
import Database from 'better-sqlite3';

/**
 * Bot command for generating list of available commands and presenting them to users
 */
export abstract class Help {
    /** The bot base command */
    public static command = '!help';

    /** The functionality of the command */
    public static description = 'Lists the available actions';

    /** The bot command pattern */
    public static usage = 'Usage: `!help`';

    /**
     * Executes the bot commands
     * @param msg The msg that triggered the command
     * @param args Available arguments included with the command
     * @param db The database connection
     */
    public static execute(msg: Message, args: Array<string>, db: Database) {
        let messages: Array<string> = [];
        import('../commands/index').then(botCommands => {
            Object.keys(botCommands).forEach(key => {
                if(key !== 'default') {
                    const command = botCommands[key][key];
                    messages.push(`${command.usage.replace('Usage: ','')} | ${command.description}`);
                }
            });
            msg.channel.send(messages.join('\n'));
        });
    }
};