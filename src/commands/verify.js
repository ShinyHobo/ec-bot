module.exports = {
    name: '!verify',
    description: 'Attempts to verify the discord user on RSI',
    execute(msg, args) {
        if(!msg.guild) {
            msg.reply('Command must be run from within server!');
            return;
        }

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
    
            const result = await lookup(args[1]);

            if(!result) {
                return;
            }

            // Scan result for UUID
            const regex = /(\{){0,1}[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}(\}){0,1}/;
            const resultUuid = regex.exec(result);

            const db = args[0];
            // no result and no name in db
            // no result and existing name
            // result and no name
            // result and name

            if(!resultUuid) {

            }

            // check in db for existing code, do not allow more than one role per discord ser
            // create new and send if none exists
            const uuid = require('uuid');
            const code = uuid.v4();
            // give role if does exist

            const giveRole = (role) => {
                msg.member.roles.add(role);
                msg.reply('RSI user verified');
            };

            // Create 'RSI Verified' role
            const roleName = 'RSI Verified';
            const role = msg.guild.roles.cache.find(role => role.name === roleName);
            if(!role) {
                msg.member.guild.roles.create({
                    data: {
                        name: roleName,
                        color: 'BLUE',
                    },
                    reason: 'Need role for tagging verified members'
                })
                .then(r => {
                    // give role here
                    giveRole(r);
                })
                .catch(console.error);
            } else {
                // give role here
                giveRole(role);
            }
        };

        exe();
    },
};