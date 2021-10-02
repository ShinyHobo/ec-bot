const { RSA_NO_PADDING } = require('constants');

module.exports = {
    name: '!verify',
    description: 'Attempts to verify the discord user on RSI',
    execute(msg, args) {
        if(args.length === 1 || args.length > 2) {
            msg.reply('Usage: !verify [RSI USERNAME]');
            return;
        }

        const exe = async () => {
            const lookup = async (username) => {
                return await new Promise((resolve, reject) => {
                    require('https').get(`https://robertsspaceindustries.com/citizens/${username}`, (res) => {
                        if(res.statusCode === 404) { // Citizen does not exist
                            msg.reply('Could not find a citizen with that username!');
                            resolve(false);
                        } else if(res.statusCode === 200) { // Citizen exists, check for code
                            let data = '';
                            res.on('data', (d) => {
                                data += d;
                            });
                            res.on('end', () => {
                                // Check for verification code
                                const jsdom = require("jsdom");
                                const dom = new jsdom.JSDOM(data);
                                const bio = dom.window.document.querySelector(".bio");
                                const val = bio.querySelector('.value').textContent;
                                resolve(val);
                            });
                        } else {
                            msg.reply('No response from RSI server!');
                            resolve(false);
                        }
                    }).on('error', (error) => {
                      reject(error);
                    });
                }).catch(err => msg.reply('No response from RSI server!'));
            };
    
            let result = await lookup(args[1]);

            if(!result) {
                return;
            }
    
            const db = args[0];

            //const isDm = msg.channel.type === 'dm';
            //msg.reply('');
            msg.author.send('verified');
        };

        exe();
    },
};