import { Message, Client, ThreadChannel } from 'discord.js';
module.exports = {
    name: '!archive',
    description: 'Manages server thread keepalives',
    execute(msg: Message, args) {
        if(!msg.guild) {
            msg.reply('Command must be run from within server!');
            return;
        }

        if(args.length === 1 || args.length > 2) {
            msg.reply('Usage: `!archive [on/off]` to keep an archive alive indefinitely');
            return;
        }

        if(msg.channel.isThread()) {
            // check if sufficient privledges
        } else {
            msg.reply('`!archive [on/off]` must must be used within a thread.');
        }
    },
    poll(bot: Client) {
        // look up stored threads here

        // use collection of ids to fetch each channel
        bot.channels.fetch('').then((thread: ThreadChannel) => {
            thread.setArchived(false, "Auto-renew");
        })
        .catch(() => {});
    }
};