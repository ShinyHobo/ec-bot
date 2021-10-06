module.exports = {
    name: '!ping',
    description: 'Ping!',
    execute(msg, args, db) {
        msg.reply('pong');
        // msg.channel.send('pong');
        // msg.author.send('pong');
    }
};