import Database from 'better-sqlite3';
import MessagingChannel from '../channels/messaging-channel';

/**
 * Bot command for verifying and associating a given Discord user with an RSI account
 * Provides the 'RSI Verified' Discord role
 */
export abstract class Verify {
    /** The bot base command */
    public static command = '!verify';

    /** The functionality of the command */
    public static description = 'Attempts to verify your discord user on RSI (Not available for CLI)';

    /** The bot command pattern */
    public static usage = 'Usage: `!verify [RSI USERNAME]`';

    /**
     * Executes the bot commands
     * @param channel The origin channel that triggered the command, also provides additional command arguments and the database connection
     */
    public static execute(channel: MessagingChannel) {
        if(!channel.getGuild()) {
            channel.reply('Command must be run from within discord server!');
            return;
        }

        if(channel.args.length !== 1) {
            channel.reply(this.usage);
            return;
        }

        const exe = async () => {
            const lookup = async (username) => {
                return await new Promise((resolve, reject)=> {
                    require('https').get(`https://robertsspaceindustries.com/citizens/${username}`, (res) => {
                        if(res.statusCode === 404) { // Citizen does not exist
                            channel.reply('I could not find a citizen with that username!');
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
                            channel.reply('There was no response from RSI server!');
                            resolve(false);
                        }
                    }).on('error', (error) => {
                      reject(error);
                    });
                }).catch(err => channel.reply('I\'ve had trouble contacting the RSI server. Please try again!'));
            };
    
            const result = await lookup(channel.args[0]);

            if(!result) {
                return;
            }

            // Scan result for UUID
            const regex = /(\{){0,1}[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}(\}){0,1}/;
            const resultUuid = regex.exec(result.toString());

            // Check to see if user is already in db
            let db: Database = channel.db;
            let memberId = channel.getMemberId();
            const verification = db.prepare('SELECT * FROM verification WHERE discord_id = ?').get();

            const uuid = require('uuid');
            const code = uuid.v4();
            
            if(!verification && !resultUuid) {
                // create code and send
                db.prepare('INSERT INTO verification VALUES (?,?)').run([memberId, code]);
                channel.sendAuthor(`Please copy the following into your RSI bio and rerun the command. After you are verified, feel to undo your changes: \`\`\`${code}\`\`\``);
            } else if(!verification && resultUuid) {
                // create code and send, tell to remove existing code
                db.prepare('INSERT INTO verification VALUES (?,?)').run([memberId,code]);
                channel.sendAuthor(`Existing verification UUID found, but not associated with your account. Please remove ${resultUuid}, and then copy the following into your RSI bio and rerun 
                    the command. After you are verified, feel to undo your changes: \`\`\`${code}\`\`\``);
            } else if(verification && !resultUuid) {
                // send old code reminder
                channel.sendAuthor(`Please copy the following into your RSI bio and rerun the command. After you are verified, feel to undo your changes: \`\`\`${verification.code}\`\`\``);
            } else if(verification.code === resultUuid[0]) {
                // Create 'RSI Verified' role
                channel.giveRole('RSI Verified');
            } else {
                channel.sendAuthor(`The verification code you used was incorrect. Please update your bio with the following code and try again: \`\`\`${verification.code}\`\`\``);
            }
        };

        exe();
    }
};