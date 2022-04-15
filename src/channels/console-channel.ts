import MessagingChannel from './messaging-channel';
import Database from 'better-sqlite3';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import * as botCommands from '../commands/index';


/**
 * Implements a messaging channel strategy.
 * In this case communication happens via the command line.
 * Command and command arguments are passed at program start,
 * output is written back to the console.
 */
export default class ConsoleChannel extends MessagingChannel {

    constructor(db: Database, args: string[]) {
        super(db);
        this.args = args;
    }

    /**
     * Executes the command that was passed on the command line as arguments to this program.
     */
    run() {
        this.executeCommandIfExists(this.args, "!");
    }

    /**
     * Returns all available commands on the console.
     * @returns A map containing the command name as key and the command object as value.
     */
     getCommands(): Map<string, Object> {
        let commands = new Map<string, Object>();
        Object.keys(botCommands).map(key => {
            commands.set(botCommands[key][key].command, botCommands[key][key]);
        });
        return commands;
    }

    //#region Output methods

    /**
     * Writes text to the console.
     * @param text The text to write to console.
     */
    send(text: string): void {
        console.log(text);
    }

    /**
     * Writes text to the console.
     * Behaves exactly like the send() method.
     * @param text The text to write to console.
     * @param replyText This text is ignored.
     * @param errorReponse This text is ignored.
     */
    sendAuthor(text: string, replyText: string = "", errorReponse: string = ""): any {
        this.send(text);
    }

    /**
     * Creates a text file to the data_exports folder.
     * @param text The text content of the file.
     * @param filename The name of the file.
     * @param unescape If the text should be unscaped or not.
     */
    async sendTextFile(text: string, filename: string, unescape: boolean) {
        // save to local directory
        const data_exports = path.join(__dirname, '..', 'data_exports');
        await fs.mkdir(data_exports, { recursive: true }, (err) => {
            if (err) throw err;
          });
        const fileName = path.join(data_exports, filename);
        fs.writeFile(fileName, unescape ? _.unescape(text) : text, () => this.send('Export complete.'));
    }

    /**
     * Writes text to the console.
     * Behaves exactly like the send() method.
     * @param text The text to write to console.
     */
    reply(text: string): void {
        this.send(text);
    }
    //#endregion

    //#region Discord bot specific methods (unimplemented)
    
    /**
     * Checks if the user is authorized or not. User is always authorized on the console.
     * @returns always true
     */
    isAuthorized(): boolean {
        return true;
    }

    /**
     * Returns true if this is a discord thread, but those do not exist on the console which is why this always returns false.
     * @returns always false
     */
    isThread(): boolean {
        return false;
    }

    /**
     * Returns the discord guild, but on the console always returns false.
     * @returns always undefined
     */
    getGuild(): any {
        return undefined;
    }
    
    /**
     * Returns the discord channel member id, but on the console always "0".
     * @returns always "0"
     */
    getMemberId(): string {
        return "0";
    }
    
    /**
     * Returns the discord channel id, but on the console always "0".
     * @returns always "0"
     */
    getChannelId() : string {
        return "0";
    }
    
    /**
     * Used to set the role for a discord user, but does nothing on the console.
     * @param roleName The name of the role.
     */
    giveRole(roleName: any): void {}
    //#endregion
}