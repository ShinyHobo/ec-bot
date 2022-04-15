import Database from 'better-sqlite3';

/**
 * The strategy pattern base class for handling different messaging channels and their input and output.
 */
export default abstract class MessagingChannel {

    db: Database;
    args: string[];

    constructor(db: Database) {
        this.db = db;
    }

    /**
     * Executes or sets up this messaging channel strategy.
     */
    abstract run(): void;

    /**
     * Returns all available commands.
     * @returns A map containing the command name as key and the command object as value.
     */
     abstract getCommands(): Map<string, Object>;

    //#region ExecuteCommand method
    /**
     * Finds and executes the command provided in the argument list.
     * @param args The command (first index) and additional arguments to execute the command with.
     * @param prefix Characters that proceed the commands, e.g. the letter ! in !help
     */
    executeCommandIfExists(args: string[], prefix: string = ""): void {
        this.args = args;

        let commands = this.getCommands();
        let commandString = prefix + this.args.shift().toLowerCase();
        if (!commands.has(commandString)) {
            console.error("Unknown command!");
            commandString = "!help";
        }

        try {
            let command: any = commands.get(commandString);
            command.execute(this);
        } catch (error) {
            console.error(error);
            this.send('There was an error trying to execute that command!')
        }
    }
    //#endregion

    //#region Output methods

    /**
     * Outputs text to the standard output channel.
     * @param text The text to output.
     */
    abstract send(text: string): any;

    /**
     * Outputs text directly to the user.
     * @param text The text to output.
     */
    abstract sendAuthor(text: string): any;

    /**
     * Outputs text directly to the user. Also handles failed and error responses.
     * @param text The text to send.
     * @param replyText The text to send if the first text couldnt be successfully delivered.
     * @param errorReponse The error message for when everything fails.
     */
    abstract sendAuthor(text: string, replyText: string , errorReponse: string): any;

    /**
     * Outputs a text file to the user.
     * @param text The text content of the file.
     * @param filename The name of the file.
     * @param unescape If the text should be unscaped or not.
     */
    abstract sendTextFile(text: string, filename: string, unescape: boolean): void;

    /**
     * Outputs a text as a response to the last user input.
     * @param text The text to output.
     */
    abstract reply(text: string): any;
    //#endregion

    //#region Discord specific methods

    /**
     * @returns true if user is authorized.
     */
    abstract isAuthorized(): boolean;

    /**
     * @returns true if this messaging channel is a thread.
     */
    abstract isThread(): boolean;

    /**
     * @returns a guild object.
     */
    abstract getGuild(): any;

    /**
     * @returns the id of the user.
     */
    abstract getMemberId() : string;

    /**
     * @returns the id of the channel.
     */
    abstract getChannelId() : string;

    /**
     * Adds a role to the user.
     * @param roleName The name of the role to add to the existing user roles.
     */
    abstract giveRole(roleName: any) : void;
    //#endregion
}