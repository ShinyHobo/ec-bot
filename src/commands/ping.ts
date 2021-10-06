import { Client, Intents, Collection, Message } from 'discord.js';
module.exports = {
    name: '!ping',
    description: 'Ping!',
    execute(msg: Message, args) {
        msg.reply('pong');
        // msg.channel.send('pong');
        // msg.author.send('pong');
    }
};