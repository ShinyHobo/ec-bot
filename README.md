# ec-bot
Discord bot for Enemy Contact

## Commands
- !ping: Replies with pong.
- !verify [RSI USERNAME]: Attempts to verify that Discord account owns RSI user.
- !archive [on/off]: Turns auto renewal on/off.

## Setup
Add a .env file to the root containing "TOKEN=[BOT TOKEN HERE]"

## Running
In the console, run the following commands, in order, from the root directory after installing node 16.10.0+ (comes with npm):
1. `npm install`
2. `npm install -g ts-node`
3. `ts-node .\src\index.ts`

If there are module conflicts, delete the node_modules folder and rerun the commands
