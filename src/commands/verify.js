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
            // Check to see if user is already in db
            db.all(`SELECT * FROM verification WHERE discord_id = '${msg.member.id}'`, (err, rows) => {
                const uuid = require('uuid');
                const code = uuid.v4();

                if(!rows.length && !resultUuid) {
                    // create code and send
                    db.run(`INSERT INTO verification VALUES ('${msg.member.id}','${code}')`);
                    msg.author.send(`Please copy the following into your RSI bio and rerun the command. After you are verified, feel to undo your changes: \`\`\`${code}\`\`\``);
                } else if(!rows.length && resultUuid) {
                    // create code and send, tell to remove existing code
                    db.run(`INSERT INTO verification VALUES ('${msg.member.id}','${code}')`);
                    msg.author.send(`Existing verification UUID found, but not associated with your account. Please remove ${resultUuid}, and then copy the following into your RSI bio and rerun the command. After you are verified, feel to undo your changes: \`\`\`${code}\`\`\``);
                } else if(rows.length && !resultUuid) {
                    // send old code reminder
                    msg.author.send(`It appears that you have been verified before, however, you can use the following code to reverify your RSI account: \`\`\`${rows[0].code}\`\`\``);
                } else if(rows[0].code === resultUuid[0]) {
                    // if uuid matches
                    const giveRole = (role) => {
                        if(!msg.member.roles.cache.has(role.id)) {
                            msg.member.roles.add(role);
                            msg.reply('your RSI user has been verified');
                        } else {
                            msg.reply('your RSI user has already been verified');
                        }
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
                } else {
                    msg.author.send(`The verification code you used was incorrect. Please update your bio with the following code and try again: \`\`\`${rows[0].code}\`\`\``);
                }
            });
        };

        exe();
    },
};