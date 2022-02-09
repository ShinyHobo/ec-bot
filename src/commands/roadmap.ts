import { Message, Util, MessageAttachment } from 'discord.js';
import Database from 'better-sqlite3';
import * as https from 'https';
import * as diff from 'recursive-diff';
import * as he from 'he';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Bot commands for analyzing the RSI roadmap and progress tracker
 */
export abstract class Roadmap {
    //#region Public properties
    /** The bot base command */
    public static readonly command = '!roadmap';
    
    
    /** The functionality of the command */
    public static readonly description = 'Keeps track of roadmap changes from week to week. Pull the latest version of the roadmap for today or to compare the latest pull to the previous.';
    
    /** The bot command pattern */
    public static readonly usage = 'Usage: `!roadmap [pull/compare] optional:[-s start_time(YYYYMMDD)/-e end_time(YYYYMMDD)]`';
    //#endregion

    //#region Private properies
    /** Graphql query for retrieving the list of deliverables from the RSI progress tracker page */
    private static readonly deliverablesGraphql = fs.readFileSync(path.join(__dirname, '..', 'graphql', 'deliverables.graphql'), 'utf-8');

    /** Graphql query for retrieving the list of teams and time allocations from the RSI progress tracker page */
    private static readonly teamsGraphql = fs.readFileSync(path.join(__dirname, '..', 'graphql', 'teams.graphql'), 'utf-8');

    /** The available search pattens for the graphql queries */
    private static readonly SortByEnum = Object.freeze({
        ALPHABETICAL: "ALPHABETICAL",
        CHRONOLOGICAL: "CHRONOLOGICAL"
    });

    /** The available category ids for the graphql queries */
    private static readonly CategoryEnum = Object.freeze({
        CoreTech: 1,
        Gameplay: 2,
        Characters: 3,
        Locations: 4,
        AI: 5,
        ShipsAndVehicles: 6,
        WeaponsAndItems: 7
    });

    /** The available query types */
    private static readonly QueryTypeEnum = Object.freeze({
        Deliverables: 1,
        Teams: 2
    });

    /** The available project types for the graphql queries */
    private static readonly ProjectEnum = Object.freeze({
        SQ42: "el2codyca4mnx",
        SC: "ekm24a6ywr3o3"
    });

    /** The base query options for pulling down graphql results */
    private static readonly options = {
        hostname: 'robertsspaceindustries.com',
        path: '/graphql',
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
    };
    //#endregion

    /**
     * Executes the bot commands
     * @param msg The msg that triggered the command
     * @param args Available arguments included with the command
     * @param db The database connection
     */
    public static execute(msg: Message, args: Array<string>, db: Database) {
        // const officer = msg.guild.roles.cache.find(role => role.name === 'Officer');
        // if(officer && !msg.member.roles.highest.comparePositionTo(officer)) {
        //     // inufficient privileges
        //     return;
        // }

        switch(args[0]) {
            case 'pull':
                this.delta(msg, db);
                break;
            case 'compare':
                this.compare(args, msg, db);
                break;
            case 'teams':
                this.lookup(["-t"], msg, db);
                break;
            default:
                msg.channel.send(this.usage).catch(console.error);
                break;
        }
    }

    /**
     * Gets data from RSI
     * @param data The graphql query
     * @param type The grpahql query type
     * @returns The response promise
     */
    private static async getResponse(data: string, type: number): Promise<any> {
        return await new Promise((resolve, reject) => {
            const req = https.request(this.options, (res) => {
              let data = '';

              res.on('data', (d) => {
                data += d;
              });
              res.on('end', () => {
                if(data[0] === '<') {
                    console.log(data);
                    reject('Server error');
                }
                switch(type){
                    case 1: // Deliverables
                        resolve(JSON.parse(data).data.progressTracker.deliverables);
                        break;
                    case 2: // Teams
                        resolve(JSON.parse(data).data.progressTracker.teams);
                        break;
                    default:
                        reject(`Invalid response query type ${type}`);
                        break;
                }
              });
            });

            req.on('error', (error) => {
              reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject('timed out');
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Generates a graphql query for retrieving deliverables data from RSI
     * @param offset The offset
     * @param limit The limit (max 20)
     * @param sortBy SortByEnum sort type
     * @param projectSlugs The projects to limit the search to
     * @param categoryIds The categories to limit the search to
     * @returns The query
     */
    private static deliverablesQuery(offset: number =0, limit: number=20, sortBy:string=this.SortByEnum.ALPHABETICAL, projectSlugs:any[]=[], categoryIds:any[]=[]): string {
        let query: any = {
            operationName: "deliverables",
            query: this.deliverablesGraphql,
            variables: {
                "startDate": "2020-01-01",
                "endDate": "2023-12-31",
                "limit": limit,
                "offset": offset,
                "sortBy": `${sortBy}`
            }
        };

        if(projectSlugs.length) {
            query.projectSlugs = JSON.stringify(projectSlugs);
        }

        if(categoryIds.length) {
            query.categoryIds = JSON.stringify(categoryIds);
        }

        return JSON.stringify(query);
    }

    /**
     * Generates a graphql query for retrieving deliverables data from RSI
     * @param offset The offset
     * @param deliverableSlug The deliverable slug to limit the search by
     * @param sortBy SortByEnum sort type
     * @returns The query
     */
    private static teamsQuery(offset: number =0, deliverableSlug: string, sortBy=this.SortByEnum.ALPHABETICAL) {
        let query: any = {
            operationName: "teams",
            query: this.teamsGraphql,
            variables: {
                "startDate": "2020-01-01",
                "endDate": "2050-12-31",
                "limit": 20,
                "offset": offset,
                "sortBy": `${sortBy}`,
                "deliverableSlug": deliverableSlug,
            }
        };

        return JSON.stringify(query);
    }

    /**
     * Looks up data from RSI and stores the delta
     * @param msg The command message
     * @param db The database connection
     */
    private static async delta(msg: Message, db: Database) {
        msg.channel.send('Retrieving roadmap state...').catch(console.error);
        let start = Date.now();
        let deliverables = [];
        let offset = 0;
        //const sortBy = 'd' in argv ? this.SortByEnum.CHRONOLOGICAL : this.SortByEnum.ALPHABETICAL;
        let completedQuery = true;
        const initialResponse = await this.getResponse(this.deliverablesQuery(offset, 1), this.QueryTypeEnum.Deliverables).catch((e) => {
            completedQuery = false;
        }); // just needed for the total count; could speed up by only grabbing this info and not the rest of the metadata
        let deliverablePromises = [];

        do {
            deliverablePromises.push(this.getResponse(this.deliverablesQuery(offset, 20), this.QueryTypeEnum.Deliverables).catch(() => completedQuery = false));
            offset += 20;
        } while(offset < initialResponse.totalCount)

        Promise.all(deliverablePromises).then((responses)=>{
            if(!completedQuery) {
                return msg.channel.send(`Roadmap retrieval timed out; please try again later.`).catch(console.error);
            }

            let teamPromises = [];
            responses.forEach((response)=>{
                let metaData = response.metaData;
                deliverables = deliverables.concat(metaData);
            });

            // download and attach development team time assignments to each deliverable
            deliverables.forEach((d) => {
                teamPromises.push(this.getResponse(this.teamsQuery(offset, d.slug), this.QueryTypeEnum.Teams).catch(() => completedQuery = false));
            });

            Promise.all(teamPromises).then(async (responses) => {
                if(!completedQuery) {
                    return msg.channel.send(`Roadmap team retrieval timed out; please try again later.`).catch(console.error);
                }
                responses.forEach((response, index)=>{
                    // order is preserved, team index matches deliverable index
                    let metaData = response.metaData;
                    deliverables[index].teams = metaData;
                });

                let delta = Date.now() - start;
                console.log(`Deliverables: ${deliverables.length} in ${delta} milliseconds`);

                const compareTime = Date.now();

                // populate db with initial values
                let deliverableDeltas = db.prepare("SELECT COUNT(*) as count FROM deliverable_diff").get();
                if(!deliverableDeltas.count) {
                    
                    const initializationDataDir = path.join(__dirname, '..', 'initialization_data');
                    fs.readdirSync(initializationDataDir).forEach((file) => {
                        const data = JSON.parse(fs.readFileSync(path.join(initializationDataDir, file), 'utf-8'));
                        this.insertChanges(db, this.convertDateToTime(file), this.adjustData(data));
                    });
                }

                const changes = this.insertChanges(db, compareTime, this.adjustData(deliverables));
                console.log(`Database updated with delta in ${Date.now() - compareTime} ms`);

                if(changes.updated || changes.removed || changes.readded || changes.added) {
                    const readdedText = changes.readded ? ` with \`${changes.readded} returning\`` : "";
                    msg.channel.send(`Roadmap retrieval returned ${deliverables.length} deliverables in ${delta} ms with`+
                        `\n\`${changes.updated} modifications\`, \`${changes.removed} removals\`, and \`${changes.added} additions\`${readdedText}.\n`+
                        ` Type \`!roadmap compare\` to compare to the last update!`).catch(console.error);
                } else {
                    msg.channel.send('No changes have been detected since the last pull.').catch(console.error);
                }

            }).catch(console.error);
        }).catch(console.error);
    }

    /**
     * Adjusts the data for delta storage
     * @param deliverables The deliverables list to adjust
     * @returns The adjusted data
     */
    private static adjustData(deliverables: any[]): any[] { // adjust the deliverable object for db insertion
        deliverables.forEach((d)=>{
            d.startDate = Date.parse(d.startDate);
            d.endDate = Date.parse(d.endDate);
            d.updateDate = Date.parse(d.updateDate);
            if(d.card) {
                d.card.tid = d.card.id,
                d.card.release_id = d.card.release.id;
                d.card.release_title = d.card.release.title;
                d.card.updateDate = Date.parse(d.card.updateDate);
                delete(d.card.id);
            }
            if(d.teams) {
                d.teams.forEach((team) => {
                    if(team.timeAllocations) {
                        team.timeAllocations.forEach((ta) => {
                            ta.startDate = Date.parse(ta.startDate);
                            ta.endDate = Date.parse(ta.endDate);
                        });
                    }
                });
            }
        });
        return deliverables;
    }

    /**
     * Compares deltas between two dates and sends a markdown report document to the Discord channel the command message originated from
     * @param argv The available arguments [TODO]
     * @param msg The command message
     * @param db The database connection
     */
    private static async compare(argv: Array<string>, msg: Message, db: Database) {
        let start: number = null;
        let end: number = null;

        const args = require('minimist')(argv.slice(1));

        // select closest existing date prior to or on entered date
        if(args['e'] && args['e'] !== true) {
            if(Number(args['e'])) {
                const dbEnd = db.prepare(`SELECT addedDate FROM deliverable_diff WHERE addedDate <= ${this.convertDateToTime(args['e'].toString())} ORDER BY addedDate DESC LIMIT 1`).get();
                end = dbEnd && dbEnd.addedDate;
            }
        } else {
            const dbEnd = db.prepare("SELECT addedDate FROM deliverable_diff ORDER BY addedDate DESC LIMIT 1").get();
            end = dbEnd && dbEnd.addedDate;
        }

        if(args['s'] && args['s'] !== true) {
            if(Number(args['s'])) {
                const dbStart = db.prepare(`SELECT addedDate FROM deliverable_diff WHERE addedDate <= ${this.convertDateToTime(args['s'].toString())} ORDER BY addedDate DESC LIMIT 1`).get();
                start = dbStart && dbStart.addedDate;
            }
        } else {
            // determine date immediately before end
            const dbStart = end && db.prepare(`SELECT addedDate FROM deliverable_diff WHERE addedDate < ${end} ORDER BY addedDate DESC LIMIT 1`).get();
            start = dbStart && dbStart.addedDate;
        }
        
        if(!start || !end || start >= end ) {
            return msg.channel.send('Invalid timespan or insufficient data to generate report.').catch(console.error);
        }

        msg.channel.send('Calculating differences between roadmaps...').catch(console.error);

        const first = this.buildDeliverables(start, db);
        const last = this.buildDeliverables(end, db);
        const dbRemovedDeliverables = db.prepare(`SELECT uuid, title FROM deliverable_diff WHERE addedDate <= ${start} AND startDate IS NULL AND endDate IS NULL GROUP BY uuid`).all();

        let messages = [];
        const compareTime = Date.now();
        let changes = {added: 0, removed: 0, updated: 0, readded: 0};

        messages.push(`Progress Report Delta | ${last.length} deliverables listed | ${new Date(start).toDateString()} => ${new Date(end).toDateString()}\n`);
        messages.push('===================================================================================================\n\n');

        const removedDeliverables = first.filter(f => !last.some(l => l.uuid === f.uuid || (f.title && f.title === l.title && !f.title.includes("Unannounced"))));
        if(removedDeliverables.length) {
            messages.push(`[${removedDeliverables.length}] deliverable(s) *removed*:\n`);
            removedDeliverables.forEach(d => {
                messages.push(he.unescape(`\* **${d.title.trim()}**\n`.toString()));
                messages.push(`- Last scheduled from ${new Date(d.startDate).toDateString()} to ${new Date(d.endDate).toDateString()}\n`);
                messages.push(he.unescape(this.shortenText(`${d.description}\n`)));
                // removed deliverable implies associated time allocations were removed; no description necessary
                changes.removed++;
            });
            messages.push('===================================================================================================\n\n');
        }

        const newDeliverables = last.filter(l => !first.some(f => l.uuid === f.uuid || (l.title && l.title === f.title && !l.title.includes("Unannounced"))));
        if(newDeliverables.length) {
            messages.push(`[${newDeliverables.length}] deliverable(s) *added*:\n`);
            newDeliverables.forEach(d => {
                const dMatch = dbRemovedDeliverables.find((dd) => dd.uuid === d.uuid || (d.title && dd.title === d.title && !d.title.includes("Unannounced")));
                if(dMatch) {
                    changes.readded++;
                }
                const start = new Date(d.startDate).toDateString();
                const end = new Date(d.endDate).toDateString();
                messages.push(he.unescape(`\* **${d.title.trim()}**\n`.toString()));
                messages.push(he.unescape(`- ${start} => ${end}\n`.toString()));
                messages.push(he.unescape(this.shortenText(`${d.description}\n`)));
                changes.added++;

                // TODO - cards, teams, time allocations
            });
            messages.push('===================================================================================================\n\n');
        }

        const remainingDeliverables = first.filter(f => !removedDeliverables.some(r => r.uuid === f.uuid) || !newDeliverables.some(n => n.uuid === f.uuid));
        let updatedDeliverables = [];
        if(remainingDeliverables.length) {
            let updatedMessages = [];
            remainingDeliverables.forEach(f => {
                const l = last.find(x => x.uuid === f.uuid || (f.title && x.title === f.title && !f.title.includes("Unannounced")));
                const d = diff.getDiff(f, l).filter((df) => df.op === 'update');
                if(d.length && l) {
                    const dChanges = d.map(x => ({op: x.op, change: x.path && x.path[0], val: x.val}));

                    if(dChanges.some(p => p.change === 'endDate' || p.change === 'startDate' || p.change === 'title' || p.change === 'description')) {
                        const title = f.title === 'Unannounced' ? `${f.title} (${f.description})` : f.title;
                        let update = `\* **${title.trim()}**\n`;

                        if(dChanges.some(p => p.change === 'startDate')) {
                            const oldDate = new Date(f.startDate);
                            const oldDateText = oldDate.toDateString();
                            const newDate = new Date(l.startDate);
                            const newDateText = newDate.toDateString();

                            let updateText = "";
                            if(Date.parse(oldDateText) < compareTime && Date.parse(newDateText) < compareTime) {
                                updateText = "been corrected"; // shift in either direction is most likely a time allocation correction
                            } else if(newDate < oldDate) {
                                updateText = "moved closer";
                            } else if(oldDate < newDate) {
                                updateText = "pushed back";
                            }

                            update += `Start date has ${updateText} from ${oldDateText} to ${newDateText}\n`;
                        }
                        if(dChanges.some(p => p.change === 'endDate')) {
                            const oldDate = new Date(f.endDate);
                            const oldDateText = oldDate.toDateString();
                            const newDate = new Date(l.endDate);
                            const newDateText = newDate.toDateString();

                            let updateText = "";
                            if(compareTime < Date.parse(oldDateText) && Date.parse(newDateText) < compareTime) {
                                updateText = "moved earlier (time allocation removal(s) likely)\n"; // likely team time allocation was removed, but could have finished early
                            } else if(oldDate < newDate) {
                                updateText = "been extended";
                            } else if(newDate < oldDate) {
                                updateText = "moved closer";
                            }

                            update += `End date has ${updateText} from ${oldDateText} to ${newDateText}\n`;
                        }

                        if(dChanges.some(p => p.change === 'title')) {
                            update += this.shortenText(`Title has been updated from "${f.title}" to "${l.title}"`);
                        }
                        if(dChanges.some(p => p.change === 'description')) {
                            update += this.shortenText(`Description has been updated from\n"${f.description}"\nto\n"${l.description}"`);
                        }
                        updatedMessages.push(he.unescape(update + '\n'));
                        updatedDeliverables.push(f);
                        changes.updated++;
                    }

                    // TODO - cards, teams, time allocations
                    if(dChanges.some(p => p.change === 'teams')) {
                        
                        // 0:'teams'
                        // 1:0
                        // 2:'timeAllocations'
                        // 3:4
                        // 4:'deliverable_id'
                    }
                }
            });
            messages.push(`[${updatedDeliverables.length}] deliverable(s) *updated*:\n`);
            messages = messages.concat(updatedMessages);
            messages.push(`[${remainingDeliverables.length - updatedDeliverables.length}] deliverable(s) *unchanged*\n\n`);
            
            const readdedText = changes.readded ? ` (with ${changes.readded} returning)` : "";
            messages.splice(1,0,this.shortenText(`There were ${changes.updated} modifications, ${changes.removed} removals, and ${changes.added} additions${readdedText} in this update.\n`));
            
            messages.push('===================================================================================================\n\n');
            messages.push(this.shortenText("This section lists all currently scheduled deliverable time allocations. Any given item is assigned to either Star Citizen (SC), "+
                "Squadron 42 (SQ42), or both, and the teams that work on each deliverable can be split between many tasks (marked with {PT} for part time).\n"));

            messages = [...messages, ...this.generateTeamSprintReport(compareTime, last, db)];
        }

        msg.channel.send({files: [new MessageAttachment(Buffer.from(_.unescape(messages.join('')), "utf-8"), `roadmap_${end}.md`)]}).catch(console.error);
    }

    /**
     * Looks up raw data for a given time period or date [TODO]
     * @param argv The available arguments
     * @param msg The command message
     * @param db The database connection
     */
    private static lookup(argv: Array<string>, msg: Message, db: Database) {
        // // only show tasks that complete in the future
        // if('n' in argv) {
        //     const now = Date.now();
        //     deliverables = deliverables.filter(d => new Date(d.endDate).getTime() > now);
        // }

        // // only show tasks that have expired or been completed
        // if('o' in argv) {
        //     const now = Date.now();
        //     deliverables = deliverables.filter(d => new Date(d.endDate).getTime() <= now);
        // }

        // // sort by soonest expiring
        // if('e' in argv) {
        //     deliverables.sort((a,b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime() || new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        // }

        // get currently scheduled deliverables
        // SELECT * FROM deliverable_diff WHERE id IN(
        //     SELECT deliverable_id FROM timeAllocation_diff WHERE startDate <= now AND endDate >= now AND deliverable_id IN ([current deliverable ids])
        //     GROUP BY deliverable_id
        //     ORDER BY deliverable_id)
        // ORDER BY title
    }

    /**
     * Generates a report for the items being worked on at the given time
     * @param compareTime The time to lookup time allocations with
     * @param deliverables The list of deliverables to generate the report for
     * @param db The database connection
     * @returns The report lines array
     */
    private static generateTeamSprintReport(compareTime: number, deliverables: any[], db: Database): string[] {
        let messages = [];
        const scheduledTasks = db.prepare(`SELECT * FROM timeAllocation_diff WHERE startDate <= ${compareTime} AND ${compareTime} <= endDate AND deliverable_id IN (${deliverables.map(l => l.id).toString()})`).all();
        const currentTasks = _.uniqBy(scheduledTasks.map(t => ({did: t.deliverable_id})), 'did');
        const groupedTasks = _.groupBy(scheduledTasks, 'deliverable_id');
        const teamTasks = _._(scheduledTasks).groupBy('team_id').map(v=>v).value();

        let deltas = this.getDeliverableDeltaDateList(db);
        let past = deltas[0] > _.uniq(deliverables.map(d => d.addedDate))[0]; // check if most recent deliverable in list is less recent than the most recent possible deliverable

        messages.push(`There ${past?'were':'are currently'} ${currentTasks.length} scheduled tasks being done by ${teamTasks.length} teams:\n`);

        currentTasks.forEach((t) => {
            const match = deliverables.find(l => l.id === t.did);
            const schedules = groupedTasks[t.did];
            const teams = match.teams.filter(mt => schedules.some(s => s.team_id === mt.id));
            messages.push(`\n**${match.title}** [${match.project_ids.replace(',', ', ')}]\n`);
            teams.forEach(mt => {
                const uniqueSchedules = _.uniqBy(mt.timeAllocations, (time) => [time.startDate, time.endDate].join());
                const mergedSchedules = this.mergeDateRanges(uniqueSchedules);
                const matchMergedSchedules = mergedSchedules.filter(ms => ms.startDate <= compareTime && compareTime <= ms.endDate);
                matchMergedSchedules.sort((a,b) => a.endDate - b.endDate).forEach((ms, msi) => {
                    messages.push(`* ${mt.title} (${mt.abbreviation})${matchMergedSchedules.length>1?` #${msi}`:""} until ${new Date(ms.endDate).toDateString()} ${ms.partialTime?"{PT}":""}\n`);
                });
            });
        });

        return messages;
    }

    /** 
     * Generate delta entries for each deliverable and their children (teams, time allocations, release card)
     * @param db The database connection 
     * @param now The time to use for addedTime entries
     * @param deliverables The deliverable entries to add
     * @returns The changes that were detected (addition, removal, modification)
     */
    private static insertChanges(db: Database, now: number, deliverables: any[]): any {
        const deliverableInsert = db.prepare("INSERT INTO deliverable_diff (uuid, slug, title, description, addedDate, numberOfDisciplines, numberOfTeams, totalCount, card_id, project_ids, startDate, endDate, updateDate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
        const cardsInsert = db.prepare("INSERT INTO card_diff (tid, title, description, category, release_id, release_title, updateDate, addedDate, thumbnail) VALUES (?,?,?,?,?,?,?,?,?)");
        const teamsInsert = db.prepare("INSERT INTO team_diff (abbreviation, title, description, startDate, endDate, addedDate, numberOfDeliverables, slug) VALUES (?,?,?,?,?,?,?,?)");
        const deliverableTeamsInsert = db.prepare("INSERT INTO deliverable_teams (deliverable_id, team_id) VALUES (?,?)");
        const timeAllocationInsert = db.prepare("INSERT INTO timeAllocation_diff (startDate, endDate, addedDate, uuid, partialTime, team_id, deliverable_id) VALUES (?,?,?,?,?,?,?)");

        // filter out deliverables that had their uuids changed, except for unnanounced content (we don't know if one content is the same as another if their uuid changes)
        let dbDeliverables = db.prepare("SELECT *, MAX(addedDate) FROM deliverable_diff GROUP BY uuid ORDER BY addedDate DESC").all();
        const announcedDeliverables = _._(dbDeliverables.filter(d => d.title && !d.title.includes("Unannounced"))).groupBy('title').map(d => d[0]).value();
        const unAnnouncedDeliverables = dbDeliverables.filter(d => d.title && d.title.includes("Unannounced"));
        dbDeliverables = [...announcedDeliverables, ...unAnnouncedDeliverables];

        let dbTeams = db.prepare("SELECT *, MAX(addedDate) FROM team_diff GROUP BY slug").all();
        const mostRecentDeliverableIds = dbDeliverables.map((dd) => dd.id).toString();
        const dbDeliverableTeams = db.prepare(`SELECT * FROM team_diff WHERE id IN (SELECT team_id FROM deliverable_teams WHERE deliverable_id IN (${mostRecentDeliverableIds}))`).all();
        const dbCards = db.prepare("SELECT *, MAX(addedDate) FROM card_diff GROUP BY tid").all();
        let dbTimeAllocations = db.prepare(`SELECT *, MAX(addedDate) FROM timeAllocation_diff WHERE deliverable_id IN (${mostRecentDeliverableIds}) GROUP BY uuid`).all();

        // TODO - investigate cleaning up removed deliverables code below, check buildDeliverables()
        const dbRemovedDeliverables = dbDeliverables.filter(d => d.startDate === null && d.endDate === null);
        const removedDeliverables = dbDeliverables.filter(f => !deliverables.some(l => l.uuid === f.uuid || (l.title && l.title === f.title && !l.title.includes("Unannounced"))) &&
            !dbRemovedDeliverables.some(l => l.uuid === f.uuid || (l.title && l.title === f.title && !l.title.includes("Unannounced"))));

        const insertTeamsAndTimeAllocations = (teams: any[], justIds: boolean = true): any => {
            let rTeams = [];
            let rTimes = [];
            if(teams) {
                teams.forEach((dt) => {
                    const match = dbTeams.find(t => t.slug === dt.slug);
                    const tDiff = diff.getDiff(match, dt).filter((df) => df.op === 'update');
                    let teamId = null;
                    if(tDiff.length || !match) { // new or changed
                        const teamRow = teamsInsert.run([dt.abbreviation, dt.title, dt.description, dt.startDate, dt.endDate, now, dt.numberOfDeliverables, dt.slug]);
                        teamId = teamRow.lastInsertRowid;
                        if(justIds) {
                            rTeams.push(teamId);
                        } else {
                            rTeams.push({id: teamId, ...dt});
                        }
                    } else {
                        teamId = match.id;
                        rTeams.push(teamId);
                    }

                    // analyze changes to time allocations
                    if(dt.timeAllocations) {
                        dt.timeAllocations.forEach((ta) => {
                            const taMatch = dbTimeAllocations.find(t => t.uuid === ta.uuid);
                            const taDiff = diff.getDiff(taMatch, ta);
                            if(taDiff.length || !taMatch) {
                                rTimes.push({team_id: teamId, ...ta});
                            } else {
                                rTimes.push({team_id: teamId, ...taMatch});
                            }
                        });
                    }
                });
            }
            return {teams: rTeams, timeAllocations: rTimes};
        }

        const insertDeliverables = db.transaction((dList: [any]) => {
            let changes = {added: 0, removed: 0, updated: 0, readded: 0};
            // check for team differences
            const dTeams = _.uniqBy(dList.filter((d) => d.teams).flatMap((d) => d.teams).map((t)=>_.omit(t, 'timeAllocations', 'uuid')), 'slug');
            if(dbTeams.length) {
                const dbRemovedTeams = dbTeams.filter(t => t.startDate === null && t.endDate === null);
                const removedTeams = dbTeams.filter(f => !dTeams.some(l => l.slug === f.slug) && !dbRemovedTeams.some(l => l.slug === f.slug))
                removedTeams.forEach((rt) => {
                    teamsInsert.run([rt.abbreviation, rt.title, rt.description, null, null, now, rt.numberOfDeliverables, rt.slug]);
                });
            } else { // initialize team_diff
                const inserts = insertTeamsAndTimeAllocations(dTeams, false); // changes to teams or time allocations
                dbTeams = inserts.teams;
                dbTimeAllocations = inserts.timeAllocations;
            }

            if(dbTimeAllocations.length) {
                const dbRemovedTimeAllocations = dbTimeAllocations.filter(ta => ta.startDate === null && ta.endDate === null && ta.partialTime === null);
                const dTimes = dList.filter((d) => d.teams).flatMap((d) => d.teams).flatMap((t) => t.timeAllocations);
                const removedTimes = dbTimeAllocations.filter(f => !dTimes.some(l => l.uuid === f.uuid) && !dbRemovedTimeAllocations.some(l => l.uuid === f.uuid));
                removedTimes.forEach((rt) => {
                    timeAllocationInsert.run([null, null, now, rt.uuid, null, rt.team_id, rt.deliverable_id]);
                });
            }

            if(dbCards.length) {
                const dCards = dList.filter((d) => d.card).flatMap((d) => d.card);
                const dbRemovedCards = dbCards.filter(f => f.updateDate === null && f.release_id === null && f.release_title === null);
                const removedCards = dbCards.filter(f => !dCards.some(l => l.tid === f.tid) && !dbRemovedCards.some(l => l.tid === f.tid));
                removedCards.forEach((rc) => {
                    cardsInsert.run([rc.tid, rc.title, rc.description, rc.category, null, null, null, now, rc.thumbnail]);
                });
            }

            removedDeliverables.forEach((r) => {
                deliverableInsert.run([r.uuid, r.slug, r.title, r.description, now, null, null, r.totalCount, null, null, null, null, null]);
                changes.removed++;
            });

            let addedCards = []; // some deliverables share the same release view card (ie. 'Bombs' and 'MOAB')
            dList.forEach((d) => {
                const dMatch = dbDeliverables.find((dd) => dd.uuid === d.uuid || (d.title && dd.title === d.title && !d.title.includes("Unannounced")));
                const gd = diff.getDiff(dMatch, d).filter((df) => df.op === 'update');

                if(gd.length || !dMatch || !dbDeliverableTeams.length) {
                    const dChanges = gd.map(x => ({change: x.path && x.path[0], val: x.val}));
                    let team_ids = [];
                    let timeAllocations = [];
                    let card_id = null;
                    if(gd.length && dChanges.some((c) => c.change === 'numberOfTeams' || c.change === 'startDate' || c.change === 'endDate') || (!dMatch && d.teams) || !dbDeliverableTeams.length) {
                        const inserts = insertTeamsAndTimeAllocations(d.teams); // changes to teams or time allocations
                        team_ids = inserts.teams;
                        timeAllocations = inserts.timeAllocations; // updated time allocations
                    }

                    if(d.card) {
                        const cMatch = dbCards.find((dc) => dc.tid === d.card.tid);
                        const cgd = diff.getDiff(cMatch, d.card).filter((df) => df.op === 'update');
                        if(!cMatch || cgd.length) {
                            const sharedCard = addedCards.find(c => c.tid === d.card.tid);
                            if(sharedCard) {
                                card_id = sharedCard.id;
                            } else {
                                const row = cardsInsert.run([d.card.tid, d.card.title, d.card.description, d.card.category, d.card.release_id, d.card.release_title, d.card.updateDate, now, d.card.thumbnail]);
                                card_id = row.lastInsertRowid;
                                addedCards.push({tid: d.card.tid, id: card_id});
                            }
                        } else {
                            card_id = cMatch.id;
                        }
                    }

                    const projectIds = d.projects.map(p => { return p.title === 'Star Citizen' ? 'SC' : (p.title === 'Squadron 42' ? 'SQ42' : null); }).toString();

                    let did = null;
                    if(!dMatch || (dMatch && gd.length)) {
                        const row = deliverableInsert.run([d.uuid, d.slug, d.title, d.description, now, d.numberOfDisciplines, d.numberOfTeams, d.totalCount, card_id, projectIds, d.startDate, d.endDate, d.updateDate]);
                        did = row.lastInsertRowid;
                        if(dMatch && dMatch.startDate && dMatch.endDate) {
                            changes.updated++;
                        } else {
                            changes.added++;
                            if (dMatch) {
                                changes.readded++;
                            }
                        }
                    } else {
                        did = dMatch.id;
                    }

                    team_ids.forEach((tid) => {
                        deliverableTeamsInsert.run([did, tid]);
                    });

                    timeAllocations.forEach((ta) => {
                         timeAllocationInsert.run([ta.startDate, ta.endDate, now, ta.uuid, ta.partialTime?1:0, ta.team_id, did]);
                    });
                }

            });
            return changes;
        });

        return insertDeliverables(deliverables);
    }

    //#region Helper methods
    /**
     * Shortens text to 100 characters per line for discord display
     * @param text The text to shorten
     * @returns The shortened text
     */ 
     private static shortenText(text): string {
        return `${text.replace(/(?![^\n]{1,100}$)([^\n]{1,100})\s/g, '$1\n')}\n`.toString();
    }

    /**
     * Provides the list of available delta update dates
     * @param db The database connection
     * @returns The distinct list of delta update dates in descending order
     */
    private static getDeliverableDeltaDateList(db: Database): number[] {
        return db.prepare("SELECT DISTINCT addedDate FROM deliverable_diff ORDER BY addedDate DESC").all().map(d => d.addedDate);
    }
    
    /**
     * The YYYYMMDD date to convert
     * @param date The date to convert
     * @returns The date as an epoch timestamp in ms
     */
     private static convertDateToTime(date: string): number {
        const year = +date.substring(0, 4);
        const month = +date.substring(4, 6);
        const day = +date.substring(6, 8);
        return new Date(year, month - 1, day).getTime();
    }

    /**
     * Merges schedule block date ranges that end and begin on the same day
     * @param ranges The date ranges to merge
     * @returns The merged date ranges
     */
    private static mergeDateRanges(ranges) {
        ranges = ranges.sort((a,b) => a.startDate - b.startDate);

        let returnRanges = [];
        let currentRange = null;
        ranges.forEach((r) => {
            // bypass invalid value
            if (r.startDate >= r.endDate) {
                return;
            }
            //fill in the first element
            if (!currentRange) {
                currentRange = r;
                return;
            }

            const currentEndDate = new Date(currentRange.endDate);
            currentEndDate.setDate(currentEndDate.getDate() + 1);
            const currentEndTime = currentEndDate.getTime();

            if (currentEndTime != r.startDate) {
                returnRanges.push(currentRange);
                currentRange = r;
            } else if (currentRange.endDate < r.endDate) {
                currentRange.endDate = r.endDate;
            }
        });

        if(currentRange) {
            returnRanges.push(currentRange);
        }

        return returnRanges;
    }

    /**
     * Looks up deliverables for a given date and connects the associated teams, cards, and time allocations
     * @param date The date to lookup data for
     * @param db The database connection
     * @returns The list of deliverables
     */
    private static buildDeliverables(date: number, db: Database): any[] {
        let dbDeliverables = db.prepare(`SELECT *, MAX(addedDate) as max FROM deliverable_diff WHERE addedDate <= ${date} GROUP BY uuid ORDER BY addedDate DESC`).all();
        let removedDeliverables = dbDeliverables.filter(d => d.startDate === null && d.endDate === null);
        dbDeliverables = dbDeliverables.filter(d => !removedDeliverables.some(r => r.uuid === d.uuid || (r.title && r.title === d.title && !r.title.includes("Unannounced"))));
        const announcedDeliverables = _._(dbDeliverables.filter(d => d.title && !d.title.includes("Unannounced"))).groupBy('title').map(d => d[0]).value();
        const unAnnouncedDeliverables = dbDeliverables.filter(d => d.title && d.title.includes("Unannounced"));
        dbDeliverables = [...announcedDeliverables, ...unAnnouncedDeliverables];
        
        const cardIds = dbDeliverables.filter((dd) => dd.card_id).map((dd) => dd.card_id).toString();
        const dbCards = db.prepare(`SELECT * FROM card_diff WHERE id IN (${cardIds})`).all();

        const deliverableIds = dbDeliverables.map((dd) => dd.id).toString();
        
        const dbDeliverableTeams = db.prepare(`SELECT * FROM team_diff WHERE id IN (SELECT team_id FROM deliverable_teams WHERE deliverable_id IN (${deliverableIds}))`).all();
        const deliverableTeams = _.groupBy(db.prepare(`SELECT * FROM deliverable_teams WHERE deliverable_id IN (${deliverableIds})`).all(), 'deliverable_id');
        
        let dbTimeAllocations = db.prepare(`SELECT *, MAX(addedDate) FROM timeAllocation_diff WHERE deliverable_id IN (${deliverableIds}) GROUP BY uuid`).all();
        dbTimeAllocations = _.groupBy(dbTimeAllocations, 'deliverable_id');

        dbDeliverables.forEach((d) => {
            d.card = dbCards.find((c) => c.id === d.card_id);
            const timeAllocations = _.groupBy(dbTimeAllocations[d.id], 'team_id');
            const teams = dbDeliverableTeams.filter(t => deliverableTeams[d.id] && deliverableTeams[d.id].some(tid => t.id === tid.team_id));
            teams.forEach((t) => {
                if(!d.teams) {
                    d.teams = [];
                }
                let team = _.clone(t);
                team.timeAllocations = timeAllocations[t.id];
                d.teams.push(team);
            });
        });

        return dbDeliverables;
    };
    //#endregion
}