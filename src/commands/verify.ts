import { Message } from 'discord.js';
import Database from 'better-sqlite3';
module.exports = {
    name: '!verify',
    description: 'Attempts to verify the discord user on RSI',
    execute(msg: Message, args: Array<string>, db: Database) {
        if(!msg.guild) {
            msg.reply('Command must be run from within server!');
            return;
        }

        if(args.length !== 1) {
            msg.reply('Usage: `!verify [RSI USERNAME]` to verify ownership of an RSI account');
            return;
        }

        const noMsg = () => {msg.reply('please ensure you allow messages from server members and try again.');};

        const exe = async () => {
            const lookup = async (username) => {
                return await new Promise((resolve, reject)=> {
                    require('https').get(`https://robertsspaceindustries.com/citizens/${username}`, (res) => {
                        if(res.statusCode === 404) { // Citizen does not exist
                            msg.reply('I could not find a citizen with that username!');
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
                                if(bio) {
                                    const val = bio.querySelector('.value').textContent;
                                    resolve(val);
                                    return;
                                }
                                resolve('this is not a uuid');
                            });
                        } else {
                            msg.reply('there was no response from RSI server!');
                            resolve(false);
                        }
                    }).on('error', (error) => {
                      reject(error);
                    });
                }).catch(err => msg.reply('I\'ve had trouble contacting the RSI server. Please try again!'));
            };
    
            const result = await lookup(args[0]);

            if(!result) {
                return;
            }

            // Scan result for UUID
            const regex = /(\{){0,1}[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}(\}){0,1}/;
            const resultUuid = regex.exec(result.toString());

            // Check to see if user is already in db
            const verification = db.prepare('SELECT * FROM verification WHERE discord_id = ?').get(msg.member.id);

            const uuid = require('uuid');
            const code = uuid.v4();
            
            if(!verification && !resultUuid) {
                // create code and send
                db.prepare('INSERT INTO verification VALUES (?,?)').run([msg.member.id,code]);
                msg.author.send(`Please copy the following into your RSI bio and rerun the command. After you are verified, feel to undo your changes: \`\`\`${code}\`\`\``)
                    .then(() => msg.reply('please check your DMs for your verification code.'))
                    .catch(() => noMsg());
            } else if(!verification && resultUuid) {
                // create code and send, tell to remove existing code
                db.prepare('INSERT INTO verification VALUES (?,?)').run([msg.member.id,code]);
                msg.author.send(`Existing verification UUID found, but not associated with your account. Please remove ${resultUuid}, and then copy the following into your RSI bio and rerun 
                    the command. After you are verified, feel to undo your changes: \`\`\`${code}\`\`\``)
                    .then(() => msg.reply('please check your DMs for your verification code.'))
                    .catch(() => noMsg());
            } else if(verification && !resultUuid) {
                // send old code reminder
                msg.author.send(`Please copy the following into your RSI bio and rerun the command. After you are verified, feel to undo your changes: \`\`\`${verification.code}\`\`\``)
                    .then(() => msg.reply('please check your DMs for your verification code.'))    
                    .catch(() => noMsg());
            } else if(verification.code === resultUuid[0]) {
                // if uuid matches
                const giveRole = (role) => {
                    msg.member.roles.add(role);
                    if(!msg.member.roles.cache.has(role.id)) {
                        msg.reply('your RSI user has been verified');
                    } else {
                        msg.reply('your RSI user has been reverified');
                    }
                };

                // Create 'RSI Verified' role
                const roleName = 'RSI Verified';
                const role = msg.guild.roles.cache.find(role => role.name === roleName);
                if(!role) {
                    msg.member.guild.roles.create({
                        name: roleName,
                        color: 'BLUE',
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
                msg.author.send(`The verification code you used was incorrect. Please update your bio with the following code and try again: \`\`\`${verification.code}\`\`\``).catch(console.log);
            }
        };

        exe();
    }
};