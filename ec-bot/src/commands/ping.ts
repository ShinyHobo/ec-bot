import MessagingChannel from '../channels/messaging-channel';

/**
 * Bot command for testing bot functionality
 */
export abstract class Ping {
    /** The bot base command */
    public static readonly command = '!ping';

    /** The functionality of the command */
    public static readonly description = 'Replies with pong';

    /** The bot command pattern */
    public static readonly usage = 'Usage: `!ping`';

    /**
     * Executes the bot commands
     * @param channel The origin channel that triggered the command, also provides additional command arguments and the database connection
     */
    public static execute(channel: MessagingChannel) {
        channel.send('pong');
    }
};