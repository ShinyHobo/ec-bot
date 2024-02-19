# ec-bot
Discord bot for Enemy Contact

## Commands
- `!help` - Shows all commands
- `!ping` - Replies with pong.
- `!roadmap pull` - Pulls down current state of roadmap and stores the delta
- `!roadmap compare [-s YYYYMMDD -e YYYYMMDD] [--publish]` - Compares the most recent pull to the previous; use optional start (s) and end (e) arguments to compare alternate date sets
- `!roadmap teams [--publish]` - Generates a report of currently assigned deliverables
- `!roadmap summary [en/ru/fr/etc]` - Generates a summary of the delta and two week forecast in your chosen language (English defaults)
- `!roadmap export` - Exports the most recent version of the pulled Progress Tracker data as a .json file (for generating initialization data)
- `!verify [RSI USERNAME]` - Attempts to verify that Discord account owns RSI user. (Not available for the CLI)
- `!renew [on/off]` - Turns thread auto renewal on/off. (Not available for the CLI)

Use `--publish` for additional markdown for the `!roadmap compare` and `!roadmap teams`.


## Usage
### Setup
Install Node 16.10.0+ (includes npm).

In the console, run the following commands, from the root directory after installing node 16.10.0+ (comes with npm):
1. `npm install`
2. `npm install -g ts-node`

If there are module conflicts, delete the node_modules folder and rerun the commands. 

### Splitting the Database
1. Install WSL and sqlite3
- ```wsl --install```
- ```sudo apt-get update && sudo apt-get install sqlite3```
2. Create delta_db empty directory in root
3. Fix script line endings for Windows
- ```sed -i -e 's/\r$//' create_db.sh```
4. Run ```./create_db.sh delta.db delta_db```

### Discord Bot
If you want to use the Discord bot, you first need to add a .env file containing `TOKEN=[BOT TOKEN HERE]` to the root folder.

To run the Discord bot, execute the following commands in the console from the root directory:

`ts-node .\src\index.ts`

To run continuously and automatically restart after an error, I suggest using [PM2](https://pm2.keymetrics.io/).

### CLI
If you just want to run a specific command locally on the command line, you can use the CLI instead:

`ts-node .\src\index.ts <command>`

Note that commands in CLI are written without the '!' as prefix:

`ts-node .\src\index.ts roadmap pull`

The commands `verify` and `renew` are not available when using the CLI.
