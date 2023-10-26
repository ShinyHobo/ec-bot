import MessagingChannel from '../channels/messaging-channel';

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
     * @param channel The origin channel that triggered the command, also provides additional command arguments and the database connection
     */
    public static execute(channel: MessagingChannel) {
        let messages: Array<string> = [];
        channel.getCommands().forEach((command:any, key:string) => {
            messages.push(`* ${command.description}:\n${command.usage.replace('Usage: ','')}`);
        });
        channel.send(messages.join('\n'));
    }
};