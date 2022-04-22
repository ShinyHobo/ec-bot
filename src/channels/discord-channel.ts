import { Client, Intents, Collection, ThreadChannel, Message, MessageAttachment } from 'discord.js';
import * as _ from 'lodash';
import * as botCommands from '../commands/index';
import MessagingChannel from './messaging-channel';


/**
 * Implements a messaging channel strategy.
 * In this case communication happens via a Discord bot.
 * Command and command arguments are passed as Discord messages,
 * output is written back as response messages to the discord channel or by direct messaging the user.
 */
export default class DiscordChannel extends MessagingChannel {

    private bot: Client;
    private msg: Message;

    /**
     * Sets up the discord bot to be able to receive message and send responses.
     */
     run() {
        this.bot = new Client({ intents: [Intents.FLAGS.DIRECT_MESSAGES, Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES], partials: ["CHANNEL"] });
        this.bot.login(process.env.TOKEN);
        this.bot.on('ready', this.onBotReady);
        this.bot.on('messageCreate', this.onBotMessage); // Watch the message history for commands
        this.bot.on('threadUpdate', this.onBotThreadUpdate);
    }

    /**
     * Returns all available commands for the discord bot.
     * @returns A map containing the command name as key and the command object as value.
     */
     getCommands(): Map<string, Object> {
        let commands = new Collection<string, Object>();
        Object.keys(botCommands).map(key => {
            commands.set(botCommands[key][key].command, botCommands[key][key]);
        });
        return commands;
    }

    //#region Discord bot callback methods

    /**
     * The callback function for when the discord bot has been started.
     */
    private onBotReady(): void {
        console.info(`Logged in as ${this.bot.user.tag}!`);
        this.bot.user.setPresence({ status: 'online', activities: [{ name: 'with my sourcecode', type: 'PLAYING', url: 'https://github.com/ShinyHobo/ec-bot'}]});
        // Unarchive archived threads
        botCommands.Renew.Renew.unarchiveAll(this.bot, this.db);
    }

    /**
     * The callback function which is triggered when a message is send to the bot.
     * @param msg The discord Message object.
     */
    private onBotMessage(msg: Message): void {
        if(msg.author.bot) {
            return;
        }

        let discordChannel = this.getClone(); // currently create copy for each new message to handle multiple requests
        discordChannel.msg = msg; // (maybe separate the bot logic (singleton) from msg/channel/transport logic (each new request gets its own))
        discordChannel.executeCommandIfExists(msg.content.split(/ +/));
    }

    /**
     * The callback function for when a thread updates in order to unarchive the thread.
     * @param oldThread The old thread.
     * @param newThread The new thread to unarchieve.
     */
    private onBotThreadUpdate(oldThread: ThreadChannel, newThread: ThreadChannel): void {
        botCommands.Renew.Renew.unarchive(newThread, this.db);
    }

    /**
     * Creates a shallow copy of this DiscordChannel object.
     * @returns A new DiscordChannel object.
     */
     getClone(): DiscordChannel {
        let discordChannel = new DiscordChannel(this.db);
        discordChannel.bot = this.bot;
        return discordChannel;
    }
    //#endregion

    //#region Output methods

    /**
     * Sends a text message as a reponse to the channel of the incoming message.
     * @param text The text to send.
     */
    send(text: string): any {
        return this.msg.channel.send(text).catch(console.error);
    }

    /**
     * Sends two messages: One private text message to the author of the incoming message, and one to the channel of the incoming message.
     * @param text The text send as a private message to the user.
     * @param replyText The text send to the channel of the incoming message.
     * @param errorReponse The error text send to the channel of the incoming message, which is send instead of the replyText if the private message was unable to be delivered. 
     */
    sendAuthor(
        text: string,
        replyText: string = 'Please check your DMs for your verification code.',
        errorReponse: string = 'Please ensure you allow messages from server members and try again.'
    ): any {
        return this.msg.author.send(text)
            .then(() => this.reply(replyText))
            .catch(() => this.reply(errorReponse));
    }

    /**
     * Sends a text file message into the corresponding channel.
     * @param text The text content of the file.
     * @param filename The name of the file.
     * @param unescape If the text should be unscaped or not.
     */
    async sendTextFile(text: string, filename: string, unescape: boolean) {
        await this.msg.channel.send({files: [new MessageAttachment(Buffer.from(unescape ? _.unescape(text) : text, "utf-8"), filename)]}).catch(console.error);
    }
    
    /**
     * Sends a response message to a incoming message.
     * @param text The text to send.
     */
    reply(text: string): any {
        return this.msg.reply(text).catch(console.error);
    }
    //#endregion

    //#region Discord bot specific methods

    /**
     * @returns true if the discord user has the necessary role in the discord guild, false otherwise. 
     */
    isAuthorized(): boolean {
        const officer = this.msg.guild.roles.cache.find(role => role.name === 'Officer');
        if(officer && this.msg.member.roles.highest.comparePositionTo(officer) < 0) {
            this.reply("You have insufficient privileges. An officer or above is required.");
            return false;
        }
        return true;
    }
    
    /**
     * @returns true if this channel is a thread, false otherwise.
     */
    isThread(): boolean {
        return this.msg.channel.isThread();
    }

    /**
     * @returns The Guild object in which the message was send to the discord bot.
     */
    getGuild(): any {
        return this.msg.guild;
    }

    /**
     * @returns The id of the member who send the message to the discord bot.
     */
    getMemberId(): string {
        return this.msg.member.id;
    }

    /**
     * @returns The id of the channel in which the message was send to the discord bot.
     */
    getChannelId() : string {
        return this.msg.channelId;
    }

    /**
     * Adds a discord role to the user that invoked the command (send the message).
     * @param roleName The name of the role to add to the existing user roles.
     */
    giveRole(roleName: any): void {
        let addRole = (r: any) => {
            // if uuid matches
            this.msg.member.roles.add(r);
            if(!this.msg.member.roles.cache.has(r.id)) {
                this.msg.reply('Your RSI user has been verified').catch(console.error);
            } else {
                this.msg.reply('Your RSI user has been reverified').catch(console.error);
            }
        }

        const memberRoles = this.msg.guild.roles;
        const foundRole = memberRoles.cache.find(role => role.name === roleName);
        if(!foundRole) {
            memberRoles.create({
                name: roleName,
                color: 'BLUE',
                reason: 'Need role for tagging verified members'
            })
            .then(r => addRole(r))
            .catch(console.error);
        } else {
            addRole(foundRole);
        }
    }
    //#endregion
}