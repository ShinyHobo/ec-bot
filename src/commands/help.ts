import { Message } from 'discord.js';
import Database from 'better-sqlite3';
module.exports = {
    name: '!help',
    description: 'Lists the available actions',
    usage: 'Usage: `!help`',
    execute(msg: Message, args: Array<string>, db: Database) {
        let messages: Array<string> = [];
        import('../commands/index.js').then(botCommands => {
            Object.keys(botCommands).forEach(key => {
                if(key !== 'default') {
                    const command = botCommands[key];
                    messages.push(`${command.usage} | ${command.description}`);
                }
            });
            msg.channel.send(messages.join('\n'));
        });
    }
};