module.exports = {
    name: '!verify',
    description: 'Attempts to verify the discord user on RSI',
    execute(msg, args) {
      msg.author.send('verify');
    },
};