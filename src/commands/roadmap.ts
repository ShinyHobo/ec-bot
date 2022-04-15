import Database from 'better-sqlite3';
import * as diff from 'recursive-diff';
import * as he from 'he';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import GeneralHelpers from '../services/general-helpers';
import RSINetwork from '../services/rsi-network';
import MessagingChannel from '../channels/messaging-channel';

/**
 * Bot commands for analyzing the RSI roadmap and progress tracker
 */
export abstract class Roadmap {
    //#region Public properties
    /** The bot base command */
    public static readonly command = '!roadmap';

    /** The functionality of the command */
    public static readonly description = 'Keeps track of roadmap changes from week to week. Pull the latest version of the roadmap for today or to compare the latest pull to the previous.';

    /**
     * The bot command pattern
     * --publish can be added to compare and teams to generate extras for website publishing */
    public static readonly usage = 'Usage: `!roadmap  \n\tpull <- Pulls progress tracker delta  \n\tcompare [-s YYYYMMDD, -e YYYYMMDD] '+
        '<- Generates a delta report for the given dates; leave none for most recent  \n\tteams <- Generates a report of currently assigned deliverables`';
    //#endregion

    //#region Private properies
    /** The report category enum */
    private static readonly ReportCategoryEnum = Object.freeze({
        Delta: "Delta",
        Teams: "Teams"
    });

    /** The number of developers employed at CIG as of the 2020 financial report */
    private static readonly HiredDevs = 512;

    /** Set to true to allow the command to export to discord */
    private static readonly AllowExportSnapshotsToDiscord = false;
    //#endregion

    /**
     * Executes the bot commands
     * @param channel The origin channel that triggered the command, also provides additional command arguments and the database connection
     */
    public static execute(channel: MessagingChannel) {
        // if (channel.isAuthorized) {
        // 	return;
        // }

        let args = channel.args;
        switch(args[0]) {
            case 'pull':
                this.delta(channel);
                break;
            case 'compare':
                this.generateProgressTrackerDeltaReport(channel);
                break;
            case 'teams':
                this.lookup(channel);
                break;
            case 'export':
                this.exportJson(channel, true);
                break;
            default:
                channel.send(this.usage);
                break;
        }
    }

    //#region Generate Delta
    /**
     * Looks up data from RSI and stores the delta
     * @param channel The origin channel that triggered the command, also provides additional command arguments and the database connection
     */
    private static async delta(channel: MessagingChannel) {
        channel.send('Retrieving roadmap state...');
        let start = Date.now();
        let deliverables = [];
        let offset = 0;
        //const sortBy = 'd' in argv ? this.SortByEnum.CHRONOLOGICAL : this.SortByEnum.ALPHABETICAL;
        let completedQuery = true;
        const initialResponse = await RSINetwork.getResponse(RSINetwork.deliverablesQuery(offset, 1), RSINetwork.QueryTypeEnum.Deliverables).catch((e) => {
            completedQuery = false;
        }); // just needed for the total count; could speed up by only grabbing this info and not the rest of the metadata
        let deliverablePromises = [];

        do {
            deliverablePromises.push(RSINetwork.getResponse(RSINetwork.deliverablesQuery(offset, 20), RSINetwork.QueryTypeEnum.Deliverables, offset).catch(() => completedQuery = false));
            offset += 20;
        } while(offset < initialResponse.totalCount)

        Promise.all(deliverablePromises).then((responses)=>{
            if(!completedQuery) {
                return channel.send(`Roadmap retrieval timed out; please try again later.`);
            }

            responses.forEach((response)=>{
                const metaData = response.metaData;
                deliverables = deliverables.concat(metaData);
            });

            // download and attach development team time assignments to each deliverable
            const teamPromises = [];
            deliverables.forEach((d) => {
                teamPromises.push(RSINetwork.getResponse(RSINetwork.teamsQuery(offset, d.slug), RSINetwork.QueryTypeEnum.Teams, 20 * teamPromises.length).catch(() => completedQuery = false));
            });

            Promise.all(teamPromises).then(async (responses) => {
                if(!completedQuery) {
                    return channel.send(`Roadmap team retrieval timed out; please try again later.`);
                }

                const disciplinePromises = []; // get dev lists for each team/deliverable combination
                responses.forEach((response, index)=>{
                    // order is preserved, team index matches deliverable index
                    const metaData = response.metaData;
                    deliverables[index].teams = metaData;
                    deliverables[index].teams.forEach(t => {
                        disciplinePromises.push(RSINetwork.getResponse(RSINetwork.disciplinesQuery(t.slug, deliverables[index].slug), RSINetwork.QueryTypeEnum.Disciplines, 20 * disciplinePromises.length).catch(() => completedQuery = false));
                    });
                });

                Promise.all(disciplinePromises).then(async (disciplineResults) => {
                    if(!completedQuery) {
                        return channel.send(`Roadmap discipline retrieval timed out; please try again later.`);
                    }
                    disciplineResults.forEach(disciplines => {
                        disciplines.forEach(discipline => {
                            // TODO - refactor this; not sure how to just select the matching time allocation at the bottom of the search, but this can't be efficient
                            const dMatch = deliverables.find(d => d.teams && d.teams.find(t => t.timeAllocations && t.timeAllocations.find(ta => discipline.timeAllocations && discipline.timeAllocations.some(dta => dta.uuid === ta.uuid))));
                            if(dMatch) {
                                const team = dMatch.teams.find(t => t.timeAllocations.some(ta => discipline.timeAllocations.some(dta => dta.uuid === ta.uuid)));
                                const timeAllocations = team.timeAllocations.filter(ta => discipline.timeAllocations.some(dta => dta.uuid === ta.uuid));

                                // A given discipline is assigned to exactly one, unique time allocation
                                timeAllocations.forEach(ta => {
                                    ta.discipline = discipline;
                                });
                            }
                        });
                    });

                    let delta = Date.now() - start;
                    console.log(`Deliverables: ${deliverables.length} in ${delta} milliseconds`);

                    const compareTime = Date.now();
                    const db = channel.db;

                    // populate db with initial values
                    let deliverableDeltas = db.prepare("SELECT COUNT(*) as count FROM deliverable_diff").get();
                    if(!deliverableDeltas.count) {

                        const initializationDataDir = path.join(__dirname, '..', 'initialization_data');
                        fs.readdirSync(initializationDataDir).forEach((file) => {
                            const data = JSON.parse(fs.readFileSync(path.join(initializationDataDir, file), 'utf-8'));
                            this.insertChanges(db, GeneralHelpers.convertDateToTime(file), this.adjustData(data));
                        });
                    }

                    const newDeliverables = this.adjustData(deliverables);
                    const changes = this.insertChanges(db, compareTime, newDeliverables);
                    console.log(`Database updated with delta in ${Date.now() - compareTime} ms`);

                    if(changes.updated || changes.removed || changes.readded || changes.added) {
                        channel.send(`Roadmap retrieval returned ${deliverables.length} deliverables in ${delta} ms.  \n`+
                            ` Type \`!roadmap compare\` to compare to the last update!`);
                    } else {
                        channel.send('No changes have been detected since the last pull.');
                    }
                }).catch(console.error);
            }).catch(console.error);
        }).catch(console.error);
    }

    /**
     * Adjust the deliverable objects for db insertion
     * @param deliverables The deliverables list to adjust
     * @returns The adjusted data
     */
     private static adjustData(deliverables: any[]): any[] {
        deliverables.forEach((d)=>{
            d.startDate = Date.parse(d.startDate);
            d.endDate = Date.parse(d.endDate);
            d.updateDate = Date.parse(d.updateDate);
            d.title = _.unescape(d.title);
            d.description = _.unescape(d.description);
            if(d.card) {
                d.card.tid = d.card.id;
                if(d.card.release) {
                    d.card.release_id = d.card.release.id;
                    d.card.release_title = d.card.release.title;
                } else {
                    d.card.release_id = d.card.release_id;
                    d.card.release_title = d.card.release_title;
                }
                d.card.updateDate = Date.parse(d.card.updateDate);
                delete(d.card.id);
            }
            if(d.teams) {
                d.teams.forEach((team) => {
                    team.startDate = Number(team.startDate) ? team.startDate : Date.parse(team.startDate);
                    team.endDate = Number(team.endDate) ? team.endDate : Date.parse(team.endDate);
                    if(team.timeAllocations) {
                        team.timeAllocations.forEach((ta) => {
                            ta.startDate = Date.parse(ta.startDate);
                            ta.endDate = Date.parse(ta.endDate);
                            if(ta.discipline) {
                                ta.numberOfMembers = ta.discipline.numberOfMembers;
                                ta.title = ta.discipline.title;
                                ta.disciplineUuid = ta.discipline.uuid;
                                delete(ta.discipline);
                            }
                        });
                    }
                });
            }
        });
        return deliverables;
    }

    /**
     * Generate delta entries for each deliverable and their children (teams, time allocations, release card)
     * @param db The database connection
     * @param now The time to use for addedTime entries
     * @param deliverables The deliverable entries to add
     * @returns The changes that were detected (addition, removal, modification)
     */
    private static insertChanges(db: Database, now: number, deliverables: any[]): any {
        // TODO - Refactor code, use joins where possible

        const deliverableInsert = db.prepare("INSERT INTO deliverable_diff (uuid, slug, title, description, addedDate, numberOfDisciplines, numberOfTeams, totalCount, card_id, project_ids, startDate, endDate, updateDate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
        const cardsInsert = db.prepare("INSERT INTO card_diff (tid, title, description, category, release_id, release_title, updateDate, addedDate, thumbnail) VALUES (?,?,?,?,?,?,?,?,?)");
        const teamsInsert = db.prepare("INSERT INTO team_diff (abbreviation, title, description, startDate, endDate, addedDate, numberOfDeliverables, slug) VALUES (?,?,?,?,?,?,?,?)");
        const deliverableTeamsInsert = db.prepare("INSERT or IGNORE INTO deliverable_teams (deliverable_id, team_id) VALUES (?,?)");
        const timeAllocationInsert = db.prepare("INSERT INTO timeAllocation_diff (startDate, endDate, addedDate, uuid, partialTime, team_id, deliverable_id, discipline_id) VALUES (?,?,?,?,?,?,?,?)");
        const disciplinesInsert = db.prepare("INSERT INTO discipline_diff (numberOfMembers, title, uuid, addedDate) VALUES (?,?,?,?)");

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
        // TODO - group time allocations by deliverable_id to speed up process

        const mostRecentDisciplineIds = dbTimeAllocations.filter(dd => dd.discipline_id).map((dd) => dd.discipline_id).toString();
        let dbDisciplines = db.prepare(`SELECT *, MAX(addedDate), uuid AS disciplineUuid FROM discipline_diff WHERE id IN (${mostRecentDisciplineIds}) GROUP BY uuid ORDER BY id`).all();

        // TODO - investigate cleaning up removed deliverables code below, check buildDeliverables()
        const dbRemovedDeliverables = dbDeliverables.filter(d => d.startDate === null && d.endDate === null);
        const removedDeliverables = dbDeliverables.filter(f => !deliverables.some(l => l.uuid === f.uuid || (l.title && l.title === f.title && !l.title.includes("Unannounced"))) &&
            !dbRemovedDeliverables.some(l => l.uuid === f.uuid || (l.title && l.title === f.title && !l.title.includes("Unannounced"))));

        const insertTeamsAndTimeAllocations = (teams: any[], justIds: boolean = true): any => {
            const rTeams = [];
            const rTimes = [];
            const rAddedTeams = [];
            if(teams) {
                const disciplineProperties = ['numberOfMembers', 'title', 'disciplineUuid'];
                teams.forEach((dt) => {
                    const match = dbTeams.sort((a,b) => b.addedDate - a.addedDate).find(t => t.slug === dt.slug);
                    const tDiff = diff.getDiff(match, dt).filter((df) => df.op === 'update');
                    const tChanges = tDiff.map(x => ({change: x.path && x.path[0], val: x.val})).filter(x => x.change !== 'timeAllocations');
                    let teamId = null;
                    if(tChanges.length || !match) { // new or changed
                        const teamRow = teamsInsert.run([dt.abbreviation, dt.title, dt.description, Number(dt.startDate) ? dt.startDate : Date.parse(dt.startDate), Number(dt.endDate) ? dt.endDate : Date.parse(dt.endDate), now, dt.numberOfDeliverables, dt.slug]);
                        teamId = teamRow.lastInsertRowid;
                        if(match) {
                            rAddedTeams.push({matchId: match.id, newId: teamId});
                        }
                        dbTeams.push({id: teamId, addedDate: now, ...dt});
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
                            let disciplineId = null;
                            const diMatch = dbDisciplines.sort((a,b) => b.addedDate - a.addedDate).find(di => di.disciplineUuid === ta.disciplineUuid);
                            const diDiff = diff.getDiff(diMatch, ta);
                            const diChanges = diDiff.map(x => ({change: x.path && x.path[0], val: x.val}));
                            if(!diMatch || diChanges.some(tac => disciplineProperties.includes(tac.change && tac.change.toString()))) {
                                const disciplineRow = disciplinesInsert.run([ta.numberOfMembers, ta.title, ta.disciplineUuid, now]);
                                disciplineId = disciplineRow.lastInsertRowid;
                                dbDisciplines.push({id: disciplineId, addedDate: now, ...ta}); // filter duplicates
                            } else {
                                disciplineId = diMatch.id;
                            }

                            const taMatch = dbTimeAllocations.sort((a,b) => b.addedDate - a.addedDate).find(t => t.uuid === ta.uuid);
                            const taDiff = diff.getDiff(taMatch, ta);
                            //const taChanges = taDiff.map(x => ({change: x.path && x.path[0], val: x.val}));

                            if(!taMatch || taDiff.length) {
                                dbTimeAllocations.push({team_id: teamId, discipline_id: disciplineId, addedDate: now, ...ta});
                                rTimes.push({team_id: teamId, discipline_id: disciplineId, ...ta});
                            } else {
                                rTimes.push({team_id: teamId, discipline_id: disciplineId, ...taMatch});
                            }
                        });
                    }
                });
            }
            return {teams: rTeams, timeAllocations: rTimes, addedTeams: rAddedTeams};
        }

        const insertDeliverables = db.transaction((dList: [any]) => {
            let changes = {added: 0, removed: 0, updated: 0, readded: 0}; // TODO - keep track of other changes (teams, disciplines, cards, times). Possible that these are sometimes changed without affecting the deliverable
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
                const groupedTimeAllocations = _.groupBy(dbTimeAllocations, 'deliverable_id');
                
                dList.forEach(d => {
                    if(d.teams) {
                        const oldDeliverable = dbDeliverables.find(od => od.uuid === d.uuid || (d.title && od.title === d.title && !d.title.includes("Unannounced")));
                        if(oldDeliverable && groupedTimeAllocations[oldDeliverable.id]) { // won't be any removed time allocations if there were none to begin with
                            const dbRemovedTimeAllocations = groupedTimeAllocations[oldDeliverable.id].filter(ta => ta.startDate === null && ta.endDate === null && ta.partialTime === null);
                            const removedTimes = groupedTimeAllocations[oldDeliverable.id].filter(f => f.teams && !f.teams.some(t => t.timeAllocations && t.timeAllocations.some(l => l.uuid === f.uuid)) && !dbRemovedTimeAllocations.some(l => l.uuid === f.uuid));
                            removedTimes.forEach((rt) => {
                                timeAllocationInsert.run([null, null, now, rt.uuid, null, rt.team_id, rt.deliverable_id, rt.discipline_id]);
                            });

                            // disciplines are directly tied to time allocations by their uuid, one to many relationship
                            const dbRemovedDisciplines = dbDisciplines.filter(di => di.numberOfMembers === null);
                            const removedDisciplines = dbDisciplines.filter(f => f.teams && !f.teams.some(t => t.timeAllocations && t.timeAllocations.some(l => l.disciplineUuid === f.uuid)) && !dbRemovedDisciplines.some(l => l.uuid === f.uuid));
                            removedDisciplines.forEach((rd) => {
                                disciplinesInsert.run([null, rd.title, rd.uuid, now]);
                            });
                        }
                    }
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
            let addedTeams = []; // team parameters can change without related deliverables updating (ie. end date shifts outward)
            let addedDeliverables = []; // deliverables can update without affecting children (name/description/updateDate)
            dList.forEach((d) => {
                const dMatch = dbDeliverables.find((dd) => dd.uuid === d.uuid || (d.title && dd.title === d.title && !d.title.includes("Unannounced")));
                const gd = diff.getDiff(dMatch, d).filter((df) => df.op === 'update');

                let team_ids = [];
                let timeAllocations = [];
                // check for changes to team and time allocations separate from deliverable. possible for sprints to change without affecting aggregate start and end dates
                if(d.teams) {
                    const inserts = insertTeamsAndTimeAllocations(d.teams); // changes to teams or time allocations
                    team_ids = inserts.teams;
                    addedTeams = [...addedTeams, ...inserts.addedTeams];
                    timeAllocations = inserts.timeAllocations; // updated time allocations
                }

                if(gd.length || !dMatch || !dbDeliverableTeams.length || team_ids.length || timeAllocations.length) {
                    let card_id = null;
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
                        if(dMatch) {
                            addedDeliverables.push({matchId: dMatch.id, newId: did});
                        }
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
                        timeAllocationInsert.run([ta.startDate, ta.endDate, now, ta.uuid, ta.partialTime?1:0, ta.team_id, did, ta.discipline_id]);
                    });
                }
            });

            // Update deliverable team relationships when deliverable and team update separately from each other
            const addedTeamIds = addedTeams.map(z => z.matchId).join(',');
            const addedDeliverableIds = addedDeliverables.map(z => z.matchId).join(',');
            const oldDeliverableTeams = db.prepare(`SELECT * FROM deliverable_teams WHERE team_id IN (${addedTeamIds}) OR deliverable_id IN (${addedDeliverableIds})`).all();
            oldDeliverableTeams.forEach(dt => {
                const matchedTeam = addedTeams.find(at => at.matchId === dt.team_id);
                const matchedDeliverable = addedDeliverables.find(d => d.matchId === dt.deliverable_id);
                const teamExists = dList.find(dl => dl.teams && dl.teams.some(dt => dt.uuid === dt.uuid));
                if((matchedTeam || matchedDeliverable) && teamExists) {
                    deliverableTeamsInsert.run([matchedDeliverable ? matchedDeliverable.newId : dt.deliverable_id, matchedTeam ? matchedTeam.newId : dt.team_id]);
                }
            });

            // Update time allocations when team or deliverable update, but time allocations don't
            const oldTimeAllocations = db.prepare(`SELECT *, MAX(addedDate) FROM timeAllocation_diff WHERE team_id IN (${addedTeamIds}) OR deliverable_id IN (${addedDeliverableIds}) AND partialTime IS NOT NULL GROUP BY uuid`).all();
            oldTimeAllocations.forEach(ta => {
                const matchedTeam = addedTeams.find(at => at.matchId === at.team_id);
                const matchedDeliverable = addedDeliverables.find(d => d.matchId === ta.deliverable_id);
                // Don't add a time allocation for a new version of either team or deliverable if the time allocation was removed
                const timeAllocationExists = dList.find(dl => dl.teams && dl.teams.some(dt => dt.timeAllocations && dt.timeAllocations.some(dta => dta.uuid === ta.uuid)));
                if((matchedTeam || matchedDeliverable) && timeAllocationExists) {
                    timeAllocationInsert.run([ta.startDate, ta.endDate, now, ta.uuid, ta.partialTime, matchedTeam ? matchedTeam.newId : ta.team_id, matchedDeliverable ? matchedDeliverable.newId : ta.deliverable_id, ta.discipline_id]);
                }
            });

            return changes;
        });

        return insertDeliverables(deliverables);
    }
    //#endregion

    //#region Generate Progress Tracker Delta Report
    /**
     * Compares deltas between two dates and sends a markdown report document to the Discord channel the command message originated from
     * @param channel The origin channel that triggered the command, also provides additional command arguments and the database connection
     */
    private static async generateProgressTrackerDeltaReport(channel: MessagingChannel) {
        let start: number = null;
        let end: number = null;

        const args = require('minimist')(channel.args.slice(1));
        const db = channel.db;

        // select closest existing date prior to or on entered date
        if(args['e'] && args['e'] !== true) {
            if(Number(args['e'])) {
                const dbEnd = db.prepare(`SELECT addedDate FROM deliverable_diff WHERE addedDate <= ${GeneralHelpers.convertDateToTime(args['e'].toString())} ORDER BY addedDate DESC LIMIT 1`).get();
                end = dbEnd && dbEnd.addedDate;
            }
        } else {
            const dbEnd = db.prepare("SELECT addedDate FROM deliverable_diff ORDER BY addedDate DESC LIMIT 1").get();
            end = dbEnd && dbEnd.addedDate;
        }

        if(args['s'] && args['s'] !== true) {
            if(Number(args['s'])) {
                const dbStart = db.prepare(`SELECT addedDate FROM deliverable_diff WHERE addedDate <= ${GeneralHelpers.convertDateToTime(args['s'].toString())} ORDER BY addedDate DESC LIMIT 1`).get();
                start = dbStart && dbStart.addedDate;
            }
        } else {
            // determine date immediately before end
            const dbStart = end && db.prepare(`SELECT addedDate FROM deliverable_diff WHERE addedDate < ${end} ORDER BY addedDate DESC LIMIT 1`).get();
            start = dbStart && dbStart.addedDate;
        }

        if(!start || !end || start >= end ) {
            return channel.send('Invalid timespan or insufficient data to generate report.');
        }

        channel.send('Calculating differences between roadmaps...');

        const first = this.buildDeliverables(start, db, true);
        const last = this.buildDeliverables(end, db, true);
        const dbRemovedDeliverables = db.prepare(`SELECT uuid, title FROM deliverable_diff WHERE addedDate <= ${start} AND startDate IS NULL AND endDate IS NULL GROUP BY uuid`).all();

        let messages: string[] = [];
        const compareTime = end;
        let changes = {added: 0, removed: 0, updated: 0, readded: 0};

        const removedDeliverables = first.filter(f => !last.some(l => l.uuid === f.uuid || (f.title && f.title === l.title && !f.title.includes("Unannounced"))));
        if(removedDeliverables.length) {
            messages.push(`## [${removedDeliverables.length}] deliverable(s) *removed*: ##  \n`);
            removedDeliverables.forEach(d => {
                const dMatch = first.find(f => d.uuid === f.uuid || (f.title && f.title === d.title && !f.title.includes("Unannounced"))); // guaranteed to exist if we know it has been removed
                messages.push(he.unescape(`### **${d.title.trim()}** ${args['publish']?RSINetwork.generateProjectIcons(d):''} ###  \n`.toString()));
                messages.push(`*Last scheduled from ${GeneralHelpers.convertTimeToHyphenatedDate(d.startDate)} to ${GeneralHelpers.convertTimeToHyphenatedDate(d.endDate)}*  \n`);
                messages.push(he.unescape(GeneralHelpers.shortenText(`${d.description}  \n`)));

                if(dMatch.teams) {

                    messages.push(GeneralHelpers.shortenText(`The following team(s) have been freed up:`));
                    const freedTeams = dMatch.teams.filter(t => t.timeAllocations);
                    freedTeams.forEach(ft => {
                        GeneralHelpers.mergeDateRanges(ft.timeAllocations);
                        messages.push(GeneralHelpers.shortenText(`* ${ft.title}`));
                        const disciplineSchedules = _._(ft.timeAllocations).groupBy('discipline_id').map(v=>v).value();
                        disciplineSchedules.forEach(ds => {
                            const load = this.generateLoad(ds, compareTime, d);
                            if(load.tasks) {
                                messages.push(`x${ds[0].numberOfMembers} ${ds[0].title} ${load.devs} had ${load.tasks} tasks  \n`);
                            }
                        });
                    });
                    messages.push('  \n');
                }

                messages = [...messages, ...this.generateCardImage(d, dMatch, args['publish'])];
                // removed deliverable implies associated time allocations were removed; no description necessary
                changes.removed++;
            });
            messages.push('---  \n\n');
        }

        const newDeliverables = last.filter(l => !first.some(f => l.uuid === f.uuid || (l.title && l.title === f.title && !l.title.includes("Unannounced"))));
        if(newDeliverables.length) {
            messages.push(`## [${newDeliverables.length}] deliverable(s) *added*: ##  \n`);
            newDeliverables.forEach(d => {
                const dMatch = dbRemovedDeliverables.find((dd) => dd.uuid === d.uuid || (d.title && dd.title === d.title && !d.title.includes("Unannounced")));
                if(dMatch) {
                    changes.readded++;
                }
                const start = GeneralHelpers.convertTimeToHyphenatedDate(d.startDate);
                const end = GeneralHelpers.convertTimeToHyphenatedDate(d.endDate);
                if(args['publish']) {
                    messages.push(he.unescape(`### **<a href="https://${RSINetwork.rsi}/roadmap/progress-tracker/deliverables/${d.slug}" target="_blank">${d.title.trim()}</a>**${dMatch?` (returning!)`:''} ${RSINetwork.generateProjectIcons(d)} ###  \n`.toString()));
                } else {
                    messages.push(he.unescape(`### **${d.title.trim()}**${dMatch?` (returning!)`:''} ###  \n`.toString()));
                }
                messages.push(he.unescape(`*${start} => ${end}*  \n`.toString()));
                messages.push(he.unescape(GeneralHelpers.shortenText(`${d.description}  \n`)));

                if(d.teams) {
                    messages.push(`The following team(s) were assigned:  \n`);
                    _.orderBy(d.teams, [t => t.title.toLowerCase()], ['asc']).forEach(t => {
                        const starting = t.timeAllocations.sort((a,b) => a.startDate - b.startDate)[0];
                        const startingText = starting.startDate < compareTime ? `began work` : `will begin work`;
                        messages.push(`* ${t.title} ${startingText} ${GeneralHelpers.convertTimeToHyphenatedDate(starting.startDate)}  \n`);

                        const disciplineSchedules = _._(t.timeAllocations).groupBy('title').map(v=>v).value();
                        disciplineSchedules.forEach(ds => {
                            const lLoad = this.generateLoad(ds, compareTime, d);
                            if(lLoad.tasks) {
                                messages.push(`x${ds[0].numberOfMembers} ${ds[0].title} ${lLoad.devs} with ${lLoad.tasks} tasks (${lLoad.load}% load)  \n`);
                            } else {
                                messages.push(`x${ds[0].numberOfMembers} ${ds[0].title} ${lLoad.devs} previously completed all available tasks  \n`);
                            }
                        });
                    });
                    messages.push('  \n');
                }

                messages = [...messages, ...this.generateCardImage(d, dMatch, args['publish'])];
                changes.added++;
            });
            messages.push('---  \n\n');
        }

        const remainingDeliverables = first.filter(f => !removedDeliverables.some(r => r.uuid === f.uuid) || !newDeliverables.some(n => n.uuid === f.uuid));
        let updatedDeliverables = [];
        let updatedMessages = [];
        if(remainingDeliverables.length) {
            remainingDeliverables.forEach(f => {
                const l = last.find(x => x.uuid === f.uuid || (f.title && x.title === f.title && !f.title.includes("Unannounced")));
                const d = diff.getDiff(f, l).filter((df) => df.op === 'update');
                if(d.length && l) {
                    const dChanges = d.map(x => ({op: x.op, change: x.path && x.path[0], val: x.val}));
                    const dChangesToDetect = ['endDate','startDate', 'title', 'description', 'teams'];

                    let update = [];
                    if(dChanges.some(p => dChangesToDetect.some(detect => detect.includes(p.change.toString())))) {
                        if(dChanges.some(p => p.change === 'startDate')) {
                            const oldDate = new Date(f.startDate);
                            const newDate = new Date(l.startDate);

                            let updateText = "";
                            if(f.startDate < compareTime && l.startDate < compareTime) {
                                updateText = "been corrected"; // shift in either direction is most likely a time allocation correction
                            } else if(newDate < oldDate) {
                                updateText = "moved closer";
                            } else if(oldDate < newDate) {
                                updateText = "been pushed back";
                            }

                            update.push(`\* Start date has ${updateText} from ${GeneralHelpers.convertTimeToHyphenatedDate(f.startDate)} to ${GeneralHelpers.convertTimeToHyphenatedDate(l.startDate)}  \n`);
                        }
                        if(dChanges.some(p => p.change === 'endDate')) {
                            const oldDate = new Date(f.endDate);
                            const newDate = new Date(l.endDate);

                            let updateText = "";
                            if((compareTime < f.endDate && l.endDate < compareTime) || (compareTime > f.endDate && newDate < oldDate)) {
                                updateText = "moved earlier (time allocation removal(s) or priority up likely)  \n"; // likely team time allocation was removed, but could have finished early
                            } else if(oldDate < newDate) {
                                updateText = "been extended";
                            } else if(newDate < oldDate) {
                                updateText = "moved closer";
                            }

                            update.push(`\* End date has ${updateText} from ${GeneralHelpers.convertTimeToHyphenatedDate(f.endDate)} to ${GeneralHelpers.convertTimeToHyphenatedDate(l.endDate)}  \n`);
                        }

                        if(dChanges.some(p => p.change === 'title')) {
                            update.push(GeneralHelpers.shortenText(`\* Title has been updated from "${f.title}" to "${l.title}"`));
                        }
                        if(dChanges.some(p => p.change === 'description')) {
                            update.push(GeneralHelpers.shortenText(`\* Description has been updated from  \n"${f.description}"  \nto  \n"${l.description}"`));
                        }

                        if(dChanges.some(p => p.change === 'teams')) {
                            const teamChangesToDetect = ['startDate', 'endDate', 'timeAllocations']; // possible for start and end to remain the same while having shifting time allocations
                            _.orderBy(l.teams, [t => t.title.toLowerCase()], ['asc']).forEach(lt => { // added/modified
                                //const lDiff = lt.endDate - lt.startDate; // total timespan for team; irrelevant for deliverable based deltas
                                const assignedStart = lt.timeAllocations && lt.timeAllocations.length ? _.minBy(lt.timeAllocations, 'startDate').startDate : 0;
                                const assignedEnd = lt.timeAllocations && lt.timeAllocations.length ? _.maxBy(lt.timeAllocations, 'endDate').endDate : 0;
                                //const lDiff = assignedEnd - assignedStart; // total timespan for team, adjusted for assigned time allocations;
                                const lDiff = GeneralHelpers.mergeDateRanges(lt.timeAllocations).map(dr => dr.endDate - dr.startDate).reduce((partialSum, a) => partialSum + a, 0);

                                let showDisciplines = false;
                                const teamMatch = f.teams.find(ft => ft.slug === lt.slug);
                                if(teamMatch) {
                                    const teamChanges = diff.getDiff(lt, teamMatch).filter((df) => df.op === 'update');
                                    const tChanges = teamChanges.map(x => ({op: x.op, change: x.path && x.path[0], val: x.val})).filter(tc => teamChangesToDetect.some(td => td.includes(tc.change.toString())));

                                    if(tChanges.length) {
                                        //const tmDiff = teamMatch.endDate - teamMatch.startDate; // total timespan for team; irrelavant for deliverable based deltas
                                        const tmAssignedStart = teamMatch.timeAllocations && teamMatch.timeAllocations.length ? _.minBy(teamMatch.timeAllocations, 'startDate').startDate : 0;
                                        const tmAssignedEnd = teamMatch.timeAllocations && teamMatch.timeAllocations.length ? _.maxBy(teamMatch.timeAllocations, 'endDate').endDate : 0;
                                        //const tmDiff = tmAssignedEnd - tmAssignedStart; // total timespan for team, adjusted for assigned time allocations;
                                        const tmDiff = GeneralHelpers.mergeDateRanges(teamMatch.timeAllocations).map(dr => dr.endDate - dr.startDate).reduce((partialSum, a) => partialSum + a, 0);
                                        const timeDiff = lDiff - tmDiff; // positive is more work
                                        const dayDiff = GeneralHelpers.convertMillisecondsToDays(timeDiff);
                                        const tmDaysRemaining = GeneralHelpers.convertMillisecondsToDays(tmAssignedEnd - (compareTime < tmAssignedStart ? tmAssignedStart : compareTime));
                                        const extraDays = dayDiff - tmDaysRemaining;
                                        const displayDays = extraDays < 0 ? dayDiff : tmDaysRemaining;

                                        if(dayDiff) {
                                            if(tmDiff === 0 && dayDiff > 0) {
                                                update.push(`* ${lt.title} was assigned, ${assignedStart < compareTime ? 'revealing' : 'adding'} ${displayDays} days of work  \n`);
                                                showDisciplines = true;
                                            } else if(displayDays > 0) {
                                                update.push(`* ${lt.title} ${timeDiff > 0 ? "added":"freed up"} ${displayDays} days of work  \n`);
                                                showDisciplines = true;
                                            }
                                        }
                                    }
                                } else {
                                    const daysRemaining = GeneralHelpers.convertMillisecondsToDays(assignedEnd - compareTime);
                                    const dayDiff = GeneralHelpers.convertMillisecondsToDays(lDiff);
                                    //const displayDays = daysRemaining > dayDiff ? dayDiff : daysRemaining;
                                    const extraDays = dayDiff - daysRemaining;
                                    update.push(`* ${lt.title} was assigned, ${assignedStart < compareTime ? 'revealing' : 'adding'} ${extraDays < 0 ? dayDiff : extraDays} days of work  \n`);
                                    showDisciplines = true;
                                }

                                if(showDisciplines) {
                                    const lDisciplineSchedules = _._(lt.timeAllocations).groupBy('discipline_id').map(v=>v).value();
                                    const fDisciplineSchedules = teamMatch ? _._(teamMatch.timeAllocations).groupBy('discipline_id').map(v=>v).value() : [];
                                    lDisciplineSchedules.forEach(ds => {
                                        const matchDisciplineSchedule = fDisciplineSchedules.find(fds => fds[0].title === ds[0].title);
                                        const fLoad = matchDisciplineSchedule ? this.generateLoad(matchDisciplineSchedule, compareTime, f) : false;
                                        const lLoad = this.generateLoad(ds, compareTime, l);
                                        if(lLoad.tasks) {
                                            update.push(`x${`${matchDisciplineSchedule && matchDisciplineSchedule[0].numberOfMembers &&
                                            matchDisciplineSchedule[0].numberOfMembers !== ds[0].numberOfMembers ? `${matchDisciplineSchedule[0].numberOfMembers} => ` : ''}`+
                                            `${ds[0].numberOfMembers}`} ${ds[0].title} ${lLoad.devs} with ${lLoad.tasks} `+
                                            `tasks (${fLoad && fLoad.load && fLoad.load !== lLoad.load ? `${fLoad.load}% => ` : ''}${lLoad.load}% load)  \n`);
                                        }
                                    });
                                }
                            });

                            // removed teams
                            if(f.teams) {
                                const removedTeams = f.teams.filter(f => l.teams && !l.teams.some(l => l.slug === f.slug));
                                removedTeams.forEach(rt => {
                                    const rtDiff = rt.endDate - rt.startDate;
                                    const dayDiff = GeneralHelpers.convertMillisecondsToDays(rtDiff);
                                    update.push(`* ${rt.title} was removed, freeing up ${dayDiff} days of work  \n`);
                                });
                            }
                        }

                        if(update.length) {
                            const deltaHeader = [];
                            const title = f.title === 'Unannounced' ? `${f.title} (${f.description})` : f.title;
                            if(args['publish']) {
                                deltaHeader.push(`### **<a href="https://${RSINetwork.rsi}/roadmap/progress-tracker/deliverables/${l.slug}" target="_blank">${title.trim()}</a>** ${RSINetwork.generateProjectIcons(l)} ###  \n`);
                            } else {
                                deltaHeader.push(`### **${title.trim()}** ###  \n`);
                            }

                            deltaHeader.push(`*${GeneralHelpers.convertTimeToHyphenatedDate(l.startDate)} => ${GeneralHelpers.convertTimeToHyphenatedDate(l.endDate)}*  \n`);

                            updatedMessages.push(he.unescape([...deltaHeader, ...update].join('') + '  \n'));

                            if(f.card && !l.card) {
                                updatedMessages.push("#### Removed from release roadmap! ####  \n  \n");
                            } else if(l.card) {
                                updatedMessages = [...updatedMessages, ...this.generateCardImage(l, f, args['publish'])];
                            }

                            updatedDeliverables.push(f);
                            changes.updated++;
                        }
                    }
                }
            });
        }

        messages.push(`## [${updatedDeliverables.length}] deliverable(s) *updated*: ##  \n`);
        messages = messages.concat(updatedMessages);
        messages.push(`## [${remainingDeliverables.length - updatedDeliverables.length}] deliverable(s) *unchanged* ##  \n\n`);
        messages = [...this.generateDeltaTldr(changes, first, last, start, end, compareTime, args['publish']), ...messages];

        if(args['publish']) {
            messages = [...GeneralHelpers.generateFrontmatter(GeneralHelpers.convertTimeToHyphenatedDate(end), this.ReportCategoryEnum.Delta, "Progress Tracker Delta"), ...messages];
        }

        channel.sendTextFile(messages.join(''), `${GeneralHelpers.convertTimeToHyphenatedDate(end)}-Progress-Tracker-Delta.md`, true);
    }

    /**
     * Generates a tldr collapsable block for displaying additional analysis
     * @param changes The list of changes that occurred between this update and the previous
     * @param first The list of the original deliverables
     * @param last The list of the most current deliverables
     * @param start The start date to compare
     * @param end The end date to compare
     * @param compareTime The time to compare to, usually when the end deliverables were obtained
     * @param publish Whether to generate this section as publish ready markdown
     * @returns The tldr message array
     */
    private static generateDeltaTldr(changes: any[number], first: any[], last: any[], start: number, end: number, compareTime: number, publish: boolean = false): any[] {
        const tldr = [];
        tldr.push(`# Progress Tracker Delta #  \n### ${last.length} deliverables listed | ${GeneralHelpers.convertTimeToHyphenatedDate(start)} => ${GeneralHelpers.convertTimeToHyphenatedDate(end)} ###  \n`);
        const readdedText = changes.readded ? ` (with ${changes.readded} returning)` : "";
        tldr.push(GeneralHelpers.shortenText(`There were ${changes.updated} modifications, ${changes.removed} removals, and ${changes.added} additions${readdedText} in this update. ` +
            `Please note that not all removals are intentional; there is currently a bug with how time is entered on the Progress Tracker that can cause deliverables to disappear.  \n`));

        tldr.push('---  \n\n');

        if(publish) {
            tldr.push('<details><summary><h3>extra analysis (click me)</h3></summary><br/>  \n');
        }

        //#region Percents
        const scheduledDeliverables = last.filter(l => l.endDate > end);
        const devBreakdown = this.generateDevBreakdown(last, end, scheduledDeliverables, publish);
        const deliverableRanks = devBreakdown.deliverableRanks;
        tldr.push(devBreakdown.breakdown);
        //#endregion

        //#region average shift
        let shift = 0; // time shift forwards/backwards
        let shifts = 0;
        let completed = [];
        let lookBack = 86400000 * 14; // 14 days, bi-weekly updates, usually
        lookBack = lookBack > end - start ? lookBack : end - start;
        first.forEach(f => {
            const matchDeliverable = last.find(l => l.uuid === f.uuid || (f.title && f.title === l.title && !f.title.includes("Unannounced")));
            if(matchDeliverable) {
                if(matchDeliverable.endDate > compareTime) {
                    shift += matchDeliverable.endDate - f.endDate;
                    shifts++;
                } else if(matchDeliverable.endDate > compareTime - lookBack){
                    completed.push(matchDeliverable);
                }
            } // else deliverable was removed
        });
        shift = GeneralHelpers.convertMillisecondsToDays(Math.round(shift/shifts));
        let shiftText = '';
        if(Math.sign(shift) > 0) {
            shiftText = `expanded by ${shift} days`;
        } else if(Math.sign(shift) < 0) {
            shiftText = `shrunk by ${shift} days`;
        } else {
            shiftText = 'not moved';
        }
        tldr.push(`  \nOn average, the schedule has ${shiftText}.${completed.length ? ` ${completed.length} deliverables were not extended:` : ''}  \n`);
        if(publish) {
            tldr.push('<ul>');
        }
        completed.forEach(c => {
            let title = c.title.includes("Unannounced") ? c.description : c.title;
            title = publish ? `<a href='https://${RSINetwork.rsi}/roadmap/progress-tracker/deliverables/${c.slug}' target="_blank">${title}</a>` : title;
            tldr.push(`${publish?'<li>':'* '}${title}${publish?'</li>\n':'  \n'}`);
        });
        if(publish) {
            tldr.push('</ul>');
        }
        //#endregion

        if(publish) {
            tldr.push('<input type="text" id="top-deliverables-filter" placeholder="Filter deliverables"/>');
        }

        //#region top 15s
        let rankedTimes = _.orderBy(deliverableRanks, ["time","partTimePercent"], ['desc','asc']);
        rankedTimes = publish ? rankedTimes : rankedTimes.slice(0,15);
        tldr.push(GeneralHelpers.shortenText(`${publish?'<h3>':''}The top${publish?'':' fifteen'} currently scheduled tasks (in estimated man-days) are:${publish?'</h3>':''}  `));
        if(publish) {
            tldr.push('<ol class="ranked-deliverables">');
        }

        rankedTimes.forEach(ttt => {
            const partTimeText = ttt.partTimePercent ? `${ttt.partTimePercent}% part-time` : 'full-time';
            const matchDeliverable = scheduledDeliverables.find(d => d.id === ttt.deliverable_id);
            let title = matchDeliverable.title.includes("Unannounced") ? matchDeliverable.description : matchDeliverable.title;
            title = publish ? `<a href='https://${RSINetwork.rsi}/roadmap/progress-tracker/deliverables/${matchDeliverable.slug}' target="_blank">${title}</a>` : title;
            tldr.push(`${publish?'<li>':'* '}${Math.round(ttt.time)} - ${title} (${partTimeText}) ${publish?RSINetwork.generateProjectIcons(matchDeliverable):''}${publish?'</li>\n':'  \n'}`); // Divide by three to break into 8 hour segments
        });
        if(publish) {
            tldr.push('</ol>');
        }
        tldr.push(GeneralHelpers.shortenText(`\n${publish?'<br/>':''}${publish?'<h3>':''}The top${publish?'':' fifteen'} currently scheduled tasks (in assigned devs) are:${publish?'</h3>':''}  `));
        if(publish) {
            tldr.push('<ol class="ranked-deliverables">');
        }

        let rankedDevs = _.orderBy(deliverableRanks, ["totalMembers","partTimePercent"], ['desc','asc']);
        rankedDevs = publish ? rankedDevs : rankedDevs.slice(0,15);
        rankedDevs.forEach(ttd => {
            const partTimeText = ttd.partTimePercent ? `${ttd.partTimePercent}% part-time` : 'full-time';
            const matchDeliverable = scheduledDeliverables.find(d => d.id === ttd.deliverable_id);
            let title = matchDeliverable.title.includes("Unannounced") ? matchDeliverable.description : matchDeliverable.title;
            title = publish ? `<a href='https://${RSINetwork.rsi}/roadmap/progress-tracker/deliverables/${matchDeliverable.slug}' target="_blank">${title}</a>` : title;
            tldr.push(`${publish?'<li>':'* '}${ttd.totalMembers} - ${title} (${partTimeText}) ${publish?RSINetwork.generateProjectIcons(matchDeliverable):''}${publish?'</li>\n':'  \n'}`);
        });

        if(publish) {
            tldr.push('</ol>');
        }
        //#endregion

        if(publish) {
            tldr.push('</details>');
        }

        tldr.push('  \n---  \n\n');
        return tldr;
    }

    /**
     *
     * @param deliverables The deliverables for the given time
     * @param compareTime The time to compare to
     * @param scheduledDeliverables The deliverables currently being worked on
     * @param publish Whether or not to generate the breakdown for publishing
     * @returns The dev breakdown tldr text and the ranks
     */
    private static generateDevBreakdown(deliverables: any[any], compareTime: number, scheduledDeliverables: any[any], publish: boolean = false): { breakdown: string; deliverableRanks: any; } {
        const deliverableTimes = _._(scheduledDeliverables.filter(sd => sd.teams).flatMap(sd => sd.teams.flatMap(t => t.timeAllocations).filter(ta => ta && ta.endDate > compareTime))).groupBy('deliverable_id').map(v => v).value();
        const deliverableRanks = [];
        deliverableTimes.forEach(dt => {
            let time = 0;
            const members = [];
            let partTime = 0;
            dt.forEach(ta => {
                time += (ta.endDate - ta.startDate) * (ta.partialTime ? 0.6 : 1);
                members[ta.disciplineUuid] = {members: ta.numberOfMembers};
                if(ta.partialTime) {
                    members[ta.disciplineUuid].partialTime = true;
                    partTime++;
                }
            });
            const totalMembers = _.values(members).reduce((partialSum, a) => partialSum + a.members, 0);
            const adjustedMembers = _.values(members).reduce((partialSum, a) => partialSum + a.members * (a.partialTime ? 0.6 : 1), 0);
            deliverableRanks.push({deliverable_id: dt[0].deliverable_id, time: Math.round(GeneralHelpers.convertMillisecondsToDays(time)/3), totalMembers: totalMembers,
                adjustedMembers: adjustedMembers, tasks: dt.length, partTime: partTime, partTimePercent: Math.round(partTime/dt.length*100)});
        });
        const totalDevs = deliverableRanks.reduce((partialSum, a) => partialSum + a.totalMembers, 0); // assuming all devs are unique
        // TODO - user parttime percentage to help adjust dev numbers
        const adjustedTotalDevs = Math.round(deliverableRanks.reduce((partialSum, a) => partialSum + a.adjustedMembers, 0) / 2); // developers are spread across all time into the future, lots of overlap
        const publishBreak = publish?'<br/>':'';

        const squadronNum = scheduledDeliverables.filter(d => d.project_ids === 'SQ42');
        const squadronTimes = _._(squadronNum.filter(sd => sd.teams).flatMap(sd => sd.teams.flatMap(t => t.timeAllocations).filter(ta => ta && ta.endDate > compareTime))).groupBy('deliverable_id').map(v => v).value();

        //const puNum = scheduledDeliverables.filter(d => d.project_ids === 'SC');
        const bothNum = scheduledDeliverables.filter(d => d.project_ids === 'SC,SQ42');

        let squadronDevs = 0;
        let squadronDays = 0;
        squadronTimes.forEach(dt => {
            let time = 0;
            const members = [];
            dt.forEach(ta => {
                time += (ta.endDate - ta.startDate) * (ta.partialTime ? 0.6 : 1);
                members[ta.disciplineUuid] = {members: ta.numberOfMembers};
                if(ta.partialTime) {
                    members[ta.disciplineUuid].partialTime = true;
                }
            });
            squadronDevs += _.values(members).reduce((partialSum, a) => partialSum + a.members * (a.partialTime ? 0.6 : 1), 0);
            squadronDays += GeneralHelpers.convertMillisecondsToDays(time)/3;// split days down to 8 hours rather than 24
        });

        squadronDays = Math.round(squadronDays);
        squadronDevs = Math.round(squadronDevs);

        return {breakdown: GeneralHelpers.shortenText(`There are approximately ${adjustedTotalDevs} devs (out of ~${this.HiredDevs}, or ${Math.round(adjustedTotalDevs/this.HiredDevs*100)}%) with ${totalDevs} assignments scheduled to work on ${deliverableTimes.length} observable deliverables. `+ // no way to determine unique developers
            `Of those deliverables, ${Math.round(squadronNum.length/deliverables.length*100)}% are for SQ42 exclusively, `+
            `with ~${squadronDevs} devs (${Math.round(squadronDevs/this.HiredDevs*100)}%) scheduled for approximately ${squadronDays} man-days. ${Math.round(bothNum.length/deliverables.length*100)}% `+
            `of deliverables are shared between both projects. ${publishBreak}${publishBreak}  \n`), deliverableRanks: deliverableRanks};
    }

    /**
     * Generates a markdown card image for display along with detected changes. Github size limit for images is 5 MB
     * @param deliverable The deliverable to display a card image for
     * @param oldDeliverable The previous deliverable to check for deltas against
     * @param publish Whether to generate additional YAML
     * @returns The image messages
     */
    private static generateCardImage(deliverable: any, oldDeliverable: any, publish: boolean = false): string[] {
        const messages = [];
        if(deliverable.card) {
            if(oldDeliverable && oldDeliverable.card) {
                const d = diff.getDiff(deliverable.card, oldDeliverable.card).filter((df) => df.op === 'update');
                if(d.length) {
                    const dChanges = d.map(x => ({op: x.op, change: x.path && x.path[0], val: x.val}));
                    const changesToDetect = ['title','description', 'category', 'release_title'];
                    dChanges.filter(p => changesToDetect.some(detect => detect.includes(p.change.toString()))).forEach(dc => {
                        messages.push(GeneralHelpers.shortenText(`* Release ${_.capitalize(dc.change)} has been changed from  \n'${oldDeliverable.card[dc.change]}'  \nto '${deliverable.card[dc.change]}'  \n`));
                    });
                }
            }

            if(publish) {
                const cardImage = deliverable.card.thumbnail.includes(RSINetwork.rsi) ? deliverable.card.thumbnail : `https://${RSINetwork.rsi}${deliverable.card.thumbnail}`;
                messages.push(`![](${cardImage})  \n`);
                messages.push(`<sup>Release ${deliverable.card.release_title}</sup>  \n\n`);
            } else {
                messages.push(`Release ${deliverable.card.release_title}  \n\n`);
            }
        }
        return messages;
    }
    //#endregion

    /**
     * Looks up raw data for a given time period or date [TODO]
     * @param channel The origin channel that triggered the command, also provides additional command arguments and the database connection
     */
    private static lookup(channel: MessagingChannel) {
        const args = require('minimist')(channel.args);
        const db = channel.db;
        if(args['_'][0] === 'teams') {
            let compareTime = null;
            if(!args['t']) {
                compareTime = Date.now();
            } else {
                // the pull time is not currently saved as the beginning of the day
                const deltas = this.getDeliverableDeltaDateList(db);
                const latestPull =  GeneralHelpers.convertTimeToHyphenatedDate(deltas && deltas[0], false);
                compareTime = latestPull === args['t'].toString() ? deltas[0] : GeneralHelpers.convertDateToTime(args['t'].toString());
            }

            if(Number(compareTime) && compareTime > 0) {
                const deliverables = this.buildDeliverables(compareTime, db, true);
                const messages = this.generateScheduledDeliverablesReport(compareTime, deliverables, db, args['publish']);
                if(!messages.length) {
                    channel.send("Insufficient data to generate report.");
                    return;
                }
                channel.sendTextFile(messages.join(''), `${GeneralHelpers.convertTimeToHyphenatedDate(compareTime)}-Scheduled-Deliverables.md`, true);
            } else {
                channel.send("Invalid date for Sprint Report lookup. Use YYYYMMDD format.");
            }
        }

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
    }

    /**
     * Generates a report the ships being worked on at the given time
     * @param compareTime The time to lookup time allocations with
     * @param deliverables The list of deliverables to generate the report for
     * @param db The database connection
     * @param publish Whether or not to generate the report online display
     */
    private static generateShipsReport(compareTime: number, deliverables: any[], db: Database, publish: boolean = false) {
        const ships = deliverables.filter(d => d.description.includes('vehicle.') || d.description.includes("Unannounced Vehicle"));
    }

    //#region Generate Schedule Deliverables Report
    /**
     * Generates a report for the items being worked on at the given time
     * @param compareTime The time to lookup time allocations with
     * @param deliverables The list of deliverables to generate the report for
     * @param db The database connection
     * @param publish Whether or not to generate the report online display
     * @returns The report lines array
     */
    private static generateScheduledDeliverablesReport(compareTime: number, deliverables: any[], db: Database, publish: boolean = false): string[] {

        // TODO - round compare time to beginning/end? of day; need to match time set for start/end dates

        const lookForwardOrBack = 86400000 * 16; // Two weeks and two days

        let messages = [];
        const teams = _.uniqBy(deliverables.flatMap(d => d.teams), 'id').filter(t => t).map(t => t.id).toString();

        const scheduledTasks = db.prepare(`SELECT *, MAX(addedDate) FROM timeAllocation_diff WHERE ${compareTime} <= endDate AND team_id IN (${teams}) AND deliverable_id IN (${deliverables.map(l => l.id).toString()}) GROUP BY uuid`).all();

        // Consolidate discipline schedules
        const currentTasks = scheduledTasks.filter(st => st.startDate <= compareTime); // tasks that encompass the comparison time
        const currentDisciplineSchedules = this.getDisciplineSchedules(deliverables, currentTasks, compareTime, lookForwardOrBack);
        const scheduledDeliverables = deliverables.filter(d => currentDisciplineSchedules.some(cds => cds.deliverable_id == d.id));

        const futureTasks = scheduledTasks.filter(ft => !currentTasks.some(st => st.id === ft.id ) && ft.startDate <= compareTime + lookForwardOrBack); // tasks that begin within the next two weeks
        const futureDisciplineSchedules = this.getDisciplineSchedules(deliverables, futureTasks, compareTime, lookForwardOrBack, true);
        const scheduledFutureDeliverables = deliverables.filter(d => futureDisciplineSchedules.some(cds => cds.deliverable_id == d.id));

        if(!scheduledDeliverables.length && !scheduledFutureDeliverables.length) {
            return messages;
        }

        // deliverables that are not being worked on, but will be in the next two weeks
        const newScheduledDeliverables = scheduledFutureDeliverables.filter(sfd => !scheduledDeliverables.some(sd => sd.id === sfd.id));
        const newTasks = futureTasks.filter(ft => newScheduledDeliverables.some(nsd => nsd.id === ft.deliverable_id));
        const futureTeamTasks = _._(newTasks).groupBy('team_id').map(v=>v).value();

        const teamTasks = _._(currentTasks).groupBy('team_id').map(v=>v).value();

        let deltas = this.getDeliverableDeltaDateList(db);
        let past = deltas[0] > _.uniq(deliverables.map(d => d.addedDate).sort((a,b)=>b-a))[0]; // check if most recent deliverable in list is less recent than the most recent possible deliverable

        //#region Preamble
        if(publish) {
            messages = GeneralHelpers.generateFrontmatter(GeneralHelpers.convertTimeToHyphenatedDate(compareTime), this.ReportCategoryEnum.Teams, "Scheduled Deliverables");
        }

        messages.push(`# Scheduled Deliverables #  \n`);
        messages.push(`#### as of ${GeneralHelpers.convertTimeToHyphenatedDate(compareTime)} ####  \n`);

        messages.push(`## There ${past?'were':'are currently'} ${scheduledDeliverables.length} scheduled deliverables being worked on by ${teamTasks.length} teams ##  \n`);

        // TODO list deliverables to start with teams
        messages.push(`### ${newScheduledDeliverables.length} deliverables ${past?'were':'are'} scheduled to begin work by ${futureTeamTasks.length} team(s) within two weeks ###  \n`);

        messages.push("---  \n");

        const introDesc = 'This report lists the actively assigned deliverables and the associated teams, along with the number of developers assigned to '+
            'each time period. Deliverable time allocations are often staggered over their total lifespan and have multiple devs in the same department working in parallel, but their allocations are obviously not going to be equal.';
        const outroDesc = "The load calculation is an approximation based on the sum of the part-time and full-time tasks (averaged at 80 hours to complete a piece) divided by the team capacity (with a focus factor of 60%) over the given time period. "+
            "Without exact hourly estimates for each task, a more accurate assessment doesn't seem likely, so interpret the load as a given dev group's general utilization on a deliverable.";
        if(publish) {
            messages.push(`${introDesc} For a better look at this, clicking the team name (or one of the completion dates listed below it) will display a rendering of the current waterfall chart iteration. This chart provides `+
                `an overview of the schedule breakdown of each team in week long segments. <br/><br/> The timeslots you see on the RSI website are actually fragmented into many smaller sections, usually two week sprints. I do my best `+
                `to combine relevant timespans by looking for overlaps (4 days currently). If a team says they end earlier than you expect, it means that there is some sizeable period of time between then and the next time they start `+
                `working on the deliverable again. <br/><br/> ${outroDesc}  \n  \n`);
        } else {
            messages.push(GeneralHelpers.shortenText(`${introDesc}  \n  \n${outroDesc}\n`));
        }

        messages.push("---  \n");

        messages = [...messages, ...this.generateScheduledTldr(scheduledDeliverables, compareTime, lookForwardOrBack, publish)];
        //#endregion

        // TODO - consolidate the following code:

        scheduledDeliverables.forEach(d => {
            const title = d.title.includes("Unannounced") ? d.description : d.title;
            if(publish) {
                messages.push(`  \n### **<a href="https://${RSINetwork.rsi}/roadmap/progress-tracker/deliverables/${d.slug}" target="_blank">${title.trim()}</a>** ${RSINetwork.generateProjectIcons(d)} ###  \n`);
            } else {
                messages.push(`  \n### **${title.trim()}** [${d.project_ids.replace(',', ', ')}] ###  \n`);
            }
            if(compareTime-lookForwardOrBack<=d.startDate) {
                messages.push(`#### (Recently started!) ####  \n`);
            }
            if(d.endDate<=compareTime+lookForwardOrBack) {
                messages.push(`#### (Scheduled work ending soon!) ####  \n`);
            }

            const schedule = currentDisciplineSchedules.find(cds => cds.deliverable_id === d.id);
            const futureSchedule = futureDisciplineSchedules.find(cds => cds.deliverable_id === d.id);

            const futureTeams = futureSchedule && futureSchedule.teams.filter(fs => !schedule.teams.some(st => st.id === fs.id));
            if(futureSchedule) {
                schedule.teams = [...schedule.teams, ...futureTeams];
            }

            schedule.teams.forEach((mt, i) => {
                messages.push((i ? '  \n' : '') + this.generateWaterfallChart(mt, compareTime, futureSchedule, publish));
            });
        });

        messages.push("---\n");
        messages.push(`  \n## The following deliverables are scheduled to begin (or continue) work within two weeks ##  \n`);

        newScheduledDeliverables.forEach(d => {
            const title = d.title.includes("Unannounced") ? d.description : d.title;
            if(publish) {
                messages.push(`  \n### **<a href="https://${RSINetwork.rsi}/roadmap/progress-tracker/deliverables/${d.slug}" target="_blank">${title.trim()}</a>** ${RSINetwork.generateProjectIcons(d)} ###  \n`);
            } else {
                messages.push(`  \n### **${title.trim()}** [${d.project_ids.replace(',', ', ')}] ###  \n`);
            }
            if(compareTime-lookForwardOrBack<=d.startDate) {
                messages.push(`#### (Starting soon!) ####  \n`);
            }
            if(d.endDate<=compareTime+lookForwardOrBack) {
                messages.push(`#### (Scheduled work ending soon!) ####  \n`);
            }
            
            const futureSchedule = futureDisciplineSchedules.find(cds => cds.deliverable_id === d.id);

            futureSchedule.teams.forEach((mt, i) => {
                messages.push((i ? '  \n' : '') + this.generateWaterfallChart(mt, compareTime, futureSchedule, publish));
            });
        });

        return messages;
    }

    /**
     * Generates extra analysis for the Scheduled Deliverables Report
     * @param scheduledDeliverables The deliverables that are currently being worked on
     * @param compareTime The time the report was run
     * @param lookForward The time period to look across
     * @param publish Whether or not to add additional markdown for website publishing
     * @returns The tldr lines
     */
    private static generateScheduledTldr(scheduledDeliverables: any[any], compareTime: number, lookForward: number, publish: boolean = false): any[string] {
        const tldr = [];
        if(publish) {
            tldr.push('<details><summary><h3>extra analysis (click me)</h3></summary><br/>  \n');
        }

        tldr.push(this.generateDevBreakdown(scheduledDeliverables, compareTime, scheduledDeliverables, publish).breakdown);

        //#region Part-time/full-time
        //const teams = _.uniqBy(scheduledDeliverables.flatMap(d => d.teams), 'id');
        const teamTimeBreakdowns = [];
        scheduledDeliverables.forEach(sd => {
            if(sd.teams) {
                sd.teams.forEach(t => {
                    if(t.timeAllocations) {
                        const disciplineSchedules = _._(t.timeAllocations).groupBy((time) => time.disciplineUuid).map(v=>v).value();
                        disciplineSchedules.forEach(s => {
                            let sprints = _._(s).groupBy((time) => [time.startDate, time.endDate].join()).map(v=>v).value();
                            sprints = sprints.map(sprint => ({fullTime: _.countBy(sprint, t => t.partialTime > 0).false ?? 0, partTime: _.countBy(sprint, t => t.partialTime > 0).true ?? 0, ...sprint[0]}));
                            const scheduledTimeAllocations = GeneralHelpers.mergeDateRanges(sprints).filter(ta => ta.startDate <= compareTime && compareTime <= ta.endDate);
                            if(scheduledTimeAllocations.length) {
                                teamTimeBreakdowns[t.id] = teamTimeBreakdowns[t.id] ?? {full: 0, part: 0, sc: 0, sq42: 0, id: t.id, title: t.title, slug: t.slug};
                                teamTimeBreakdowns[t.id].full += _.sumBy(scheduledTimeAllocations, ta => ta.fullTime);
                                teamTimeBreakdowns[t.id].part += _.sumBy(scheduledTimeAllocations, ta => ta.partTime);
                                teamTimeBreakdowns[t.id].sc += sd.project_ids.includes('SC');
                                teamTimeBreakdowns[t.id].sq42 += sd.project_ids.includes('SQ42');
                            }
                        });
                    }
                });
            }
        });

        const endingSoon = scheduledDeliverables.filter(sd => sd.endDate <= compareTime + lookForward);
        if(endingSoon.length) {
            tldr.push(`${endingSoon.length} deliverable(s) are not currently scheduled to continue work after this sprint:  \n`);
            if(publish) {
                tldr.push('<ul>');
            }
            endingSoon.forEach(es => {
                const title = es.title.includes("Unannounced") ? es.description : es.title;
                if(publish) {
                    tldr.push(`  \n${publish?'<li>':'* '} <a href="https://${RSINetwork.rsi}/roadmap/progress-tracker/deliverables/${es.slug}" target="_blank">${title.trim()}</a> ${RSINetwork.generateProjectIcons(es)}${publish?'</li>':''}  \n`);
                } else {
                    tldr.push(`  \n${publish?'<li>':'* '} ${title.trim()} [${es.project_ids.replace(',', ', ')}]${publish?'</li>':''}  \n`);
                }
            });
            if(publish) {
                tldr.push('</ul>');
            }
        }

        tldr.push(`Below are the time breakdowns for each team:  \n`);
        if(publish) {
            tldr.push('<ul>');
        }

        _.orderBy(teamTimeBreakdowns.filter(tb => tb), [tb => tb.title.toLowerCase()], ['asc']).forEach(tb => {
            const tasks = tb.full + tb.part;
            const taskPercent = Math.round(tb.part / tasks * 100);
            const taskText = taskPercent ? `${taskPercent}% part-time` : 'full-time';
            const projectTasks = tb.sc + tb.sq42;
            const projectPercent = Math.round(tb.sq42 / projectTasks * 100);
            const projectText = projectPercent ? (projectPercent === 100 ? 'all of which are for SQ42' : `${projectPercent}% of which are for SQ42`) : 'all of which are for SC';
            const title = publish?`<a href="https://${RSINetwork.rsi}/roadmap/progress-tracker/teams/${tb.slug}" target="_blank">${tb.title}</a>`:tb.title;
            tldr.push(`${publish?'<li>':'* '}${title}${publish?'<br/>':' | '}${taskText} with ${tasks} task(s) scheduled, ${projectText}${publish?'</li>':''}  \n`);
        });
        if(publish) {
            tldr.push('</ul>');
        }
        //#endregion

        if(publish) {
            tldr.push('</details>');
        }

        tldr.push("---  \n");

        return tldr;
    }

    /**
     * Gets the discipline schedules and sprints for the given task list
     * @param deliverables The deliverables to match tasks with
     * @param tasks The tasks (time allocations) to generate schedule assemblies for
     * @param compareTime The comparison time
     * @param lookForward The time period to look across
     * @param futureSchedule Whether to generate the schedule assemblies for the immediate future (next scheduled)
     * @returns
     */
    private static getDisciplineSchedules(deliverables: any[any], tasks: any[any], compareTime: number, lookForward: number, futureSchedule: boolean = false): any[any] {
        const groupedTasks = _.groupBy(tasks, 'deliverable_id');
        const mergedDisciplineSchedules = [];
        const scheduledDeliverables = deliverables.filter(d => groupedTasks[d.id]);
        scheduledDeliverables.forEach(d => {
            const teams = _.orderBy(d.teams.filter(mt => groupedTasks[d.id].some(s => s.team_id === mt.id)), [d => d.title.toLowerCase()], ['asc']);
            const schedule = {deliverable_id: d.id, teams: []};
            teams.forEach(team => {
                const disciplineSchedules = _._(team.timeAllocations).groupBy((time) => time.disciplineUuid).map(v=>v).value();
                const teamSchedule = {...team, schedules: []};
                disciplineSchedules.forEach(s => { // generate mergeDateRanges for each discipline
                    // I believe it is likely that because there can be more duplicate time entries for a given scheduled period than there are assigned members means each represent
                    // a different task in the same two week sprint period. Some have been marked as needing full time attention and others part time.
                    let sprints = _._(s).groupBy((time) => [time.startDate, time.endDate].join()).map(v=>v).value();
                    sprints = sprints.map(sprint => ({fullTime: _.countBy(sprint, t => t.partialTime > 0).false ?? 0, partTime: _.countBy(sprint, t => t.partialTime > 0).true ?? 0, ...sprint[0]}));
                    const mergeDateRanges = GeneralHelpers.mergeDateRanges(sprints);
                    let mergedSchedule = mergeDateRanges.filter(ms => (!futureSchedule && compareTime <= ms.endDate) || (futureSchedule && compareTime < ms.startDate && ms.startDate <= compareTime + lookForward))[0];
                    if(mergedSchedule && compareTime < mergedSchedule.startDate && !futureSchedule) {
                        mergedSchedule = null;
                    }
                    if(mergedSchedule || !futureSchedule) {
                        teamSchedule.schedules.push({merged: mergedSchedule, sprints: sprints});
                    }
                });
                if(teamSchedule.schedules.length || !futureSchedule)
                {
                    schedule.teams.push(teamSchedule);
                }
            });
            if(schedule.teams.length) {
                mergedDisciplineSchedules.push(schedule);
            }
        });

        return mergedDisciplineSchedules;
    }

    /**
     * Generates a text based waterfall chart displaying weeks for a given team
     * @param team The team
     * @param compareTime The time to generate the chart around (yearly)
     * @param futureSchedule The future work that is scheduled
     * @param publish Whether to generate the waterfall chart or just the details
     * @returns A text based, collapsible waterfall chart text block
     */
     private static generateWaterfallChart(team: any, compareTime, futureSchedule: any, publish: boolean = false): string {
        const timelines = [];
        let waterfalls = [];

        timelines.push(publish ? `<details><summary>${publish?'<ul><li>':''}${team.title.trim()} ${timelines}<br/>\n` : `* ${team.title.trim()}  \n`);

        const futureTeam = futureSchedule && futureSchedule.teams.find(fs => fs.id === team.id);
        if(futureTeam) {
            team.schedules = [...team.schedules, ...futureTeam.schedules.filter(fts => !team.schedules.some(ts => ts.merged && ts.merged.id === fts.merged.id))];
        }
        const allFuture = team.schedules.filter(s => s.merged && s.merged.startDate <= compareTime).length === 0; // all scheduled teams are scheduled in the future
        const filteredSchedules = _._(team.schedules).groupBy(s => s.merged && s.merged.title).map(s => s[0]).value();
        filteredSchedules.forEach(ds => {
            if(publish) {
                const time = new Date(compareTime);
                const firstOfYear = new Date(time.getFullYear(), 0, 1); // 01/01
                const thisWeek = GeneralHelpers.getWeek(time, firstOfYear);
                let newWaterfall = [];

                if(!ds.merged || (ds.merged && ds.merged.startDate <= compareTime) || allFuture) { // future data should always have merged info (how else would we know it is in the future?)
                    ds.sprints.forEach((sprint) => {
                        let start  = new Date(sprint.startDate);
                        start = start < firstOfYear ? firstOfYear : start;
                        const end = new Date(sprint.endDate);
                        if(end < start) {
                            return;
                        }
                        if(!newWaterfall.length) {
                            newWaterfall = new Array(52).fill('..');
                        }
                        const weightedTimePercent = (sprint.fullTime + sprint.partTime * .5) / (sprint.fullTime + sprint.partTime);
                        const startWeek = GeneralHelpers.getWeek(start, firstOfYear);
                        const endWeek = GeneralHelpers.getWeek(end, firstOfYear);
                        let fill = weightedTimePercent > .8 ? '=' : '~'; // Thought about using ≈, but its too easily confused with =
                        const period = new Array(endWeek + 1 - startWeek).fill(fill+fill);
                        period[0] = (5<start.getDay()?'.':fill) + fill;
                        period[period.length-1] = fill + (end.getDay()<3?'.':fill);
                        newWaterfall.splice(startWeek - 1, period.length, ...period);
                    });
                    if(newWaterfall.length) {
                        const weekType = newWaterfall[thisWeek - 1];
                        const day = time.getDay();
                        const alteredWeek = (day<5?'|':weekType[0]) + (5<=day?'|':weekType[1]);
                        newWaterfall.splice(thisWeek - 1, 1, alteredWeek);
                        waterfalls.push(newWaterfall.slice(0,52).join(''));
                    }
                }
            }

            // descriptions for the current weeks in descending order of display
            if(ds.merged) {
                const fullTimePercent = Math.round(this.calculateTaskLoad(ds.merged) * 100);
                const tasks = ds.merged.fullTime + ds.merged.partTime;
                const continuingWork = futureTeam && futureTeam.schedules.find(fts => fts.merged.title === ds.merged.title && fts.merged.id !== ds.merged.id);
                if(ds.merged.startDate <= compareTime) {
                    timelines.push(`${publish?'':' - '}${ds.merged.numberOfMembers}x ${ds.merged.title} dev${ds.merged.numberOfMembers>1?'s':''} working on ${tasks} task${tasks>1?'s':''} (${fullTimePercent}% load)`+
                    ` thru ${GeneralHelpers.convertTimeToHyphenatedDate(ds.merged.endDate)}${publish?'<br/>':''}\n`);

                    // check for continuing work here
                    if(continuingWork) {
                        timelines.push(`↳ will continue ${GeneralHelpers.convertTimeToHyphenatedDate(continuingWork.merged.startDate)} with ${continuingWork.merged.numberOfMembers}x dev${continuingWork.merged.numberOfMembers>1?'s':''}${publish?'<br/>':''}\n`);
                    }
                } else if(!continuingWork) { // list future work
                    timelines.push(`${publish?'':' - '}${ds.merged.numberOfMembers}x ${ds.merged.title} dev${ds.merged.numberOfMembers>1?'s':''} will work on ${tasks} task${tasks>1?'s':''} (${fullTimePercent}% load)`+
                    ` starting ${GeneralHelpers.convertTimeToHyphenatedDate(ds.merged.startDate)} thru ${GeneralHelpers.convertTimeToHyphenatedDate(ds.merged.endDate)}${publish?'<br/>':''}\n`);
                }
            }
        });

        timelines.push(`${publish?'</li></ul>':''}`);
        return timelines.join('') + (publish ? `</summary><p>${waterfalls.join('<br>')}</p></details>` : '');
    }
    //#endregion

    /**
     * Converts database model(s) to json and exports them
     * Arguments: (-t YYYYMMDD for specific one or --all for all)
     * @param channel The origin channel that triggered the command, also provides additional command arguments  and the database connection
     * @param discord Whether to send the file to discord or to save locally
     */
    private static async exportJson(channel: MessagingChannel, discord: boolean = false) {
        let exportDates: number[] = [];

        const args = require('minimist')(channel.args.slice(1));
        const db = channel.db;

        if(args['all'] === true) {
            exportDates = this.getDeliverableDeltaDateList(db);
        } else {
            // select closest existing date prior to or on entered date
            if(args['t'] && args['t'] !== true) {
                if(Number(args['t'])) {
                    const dbEnd = db.prepare(`SELECT addedDate FROM deliverable_diff WHERE addedDate <= ${GeneralHelpers.convertDateToTime(args['t'].toString())} ORDER BY addedDate DESC LIMIT 1`).get();
                    exportDates.push(dbEnd && dbEnd.addedDate);
                }
            } else {
                const dbEnd = db.prepare("SELECT addedDate FROM deliverable_diff ORDER BY addedDate DESC LIMIT 1").get();
                exportDates.push(dbEnd && dbEnd.addedDate);
            }

            if(!exportDates.length) {
                return channel.send('Invalid timespan or insufficient data to generate report.');
            }
        }

        await exportDates.forEach(async (exportDate) => {
            const deliverablesToExport = this.buildDeliverables(exportDate, db, true);
            deliverablesToExport.forEach(d => { // strip added fields
                delete(d.id);
                delete(d.card_id);
                delete(d.addedDate);
                delete(d.max);
                d.startDate = GeneralHelpers.convertTimeToFullDate(d.startDate);
                d.endDate = GeneralHelpers.convertTimeToFullDate(d.endDate);
                d.updateDate = GeneralHelpers.convertTimeToFullDate(d.updateDate);
                d.description = _.escape(d.description);
                d.title = _.escape(d.title);
                d.projects = [];
                d.project_ids.split(',').forEach(pi => {
                    d.projects.push({title: pi === 'SC' ? 'Star Citizen' : 'Squadron 42'});
                });
                delete(d.project_ids);
                if(d.card) {
                    d.card.id = d.card.tid;
                    d.card.updateDate = GeneralHelpers.convertTimeToFullDate(d.card.updateDate);
                    d.card.release = {
                        id: d.card.release_id,
                        title: d.card.release_title
                    };
                    delete(d.card.addedDate);
                    delete(d.card.tid);
                } else {
                    d.card = null;
                }

                if(d.teams) {
                    d.teams.forEach(t => {
                        delete(t.addedDate);
                        delete(t.id);
                        t.startDate = GeneralHelpers.convertTimeToFullDate(t.startDate);
                        t.endDate = GeneralHelpers.convertTimeToFullDate(t.endDate);
                        if(t.timeAllocations) {
                            t.timeAllocations.forEach(ta => {
                                ta.startDate = GeneralHelpers.convertTimeToFullDate(ta.startDate);
                                ta.endDate = GeneralHelpers.convertTimeToFullDate(ta.endDate);
                                ta.discipline = {
                                    title: ta.title,
                                    numberOfMembers: ta.numberOfMembers,
                                    uuid: ta.disciplineUuid
                                };
                                delete(ta.title);
                                delete(ta.addedDate);
                                delete(ta.id);
                                delete(ta.deliverable_id);
                                delete(ta.discipline_id);
                                delete(ta.team_id);
                                delete(ta.numberOfMembers);
                                delete(ta.disciplineUuid);
                                delete(ta['MAX(ta.addedDate)']);
                            });
                        }
                    });
                }
            });

            const filename = `${GeneralHelpers.convertTimeToHyphenatedDate(exportDate)}.json`;
            const json = JSON.stringify(deliverablesToExport);

            if(discord && this.AllowExportSnapshotsToDiscord) {
                channel.sendTextFile(json, filename, false);
            } else {
                // save to local directory
                const data_exports = path.join(__dirname, '..', 'data_exports');
                await fs.mkdir(data_exports, { recursive: true }, (err) => {
                    if (err) throw err;
                  });
                fs.writeFile(path.join(data_exports, filename), json, () => {channel.send('Export complete.');});
            }
        });
    }

    //#region Helper methods
    /**
     * Approximates the developer load for the given task numbers
     * @param schedule The developer discipline schedule (numberOfMembers, fullTime, partTime, endDate, startDate)
     * @returns The weighted average of full-time load
     */
    private static calculateTaskLoad(schedule: any): number {
        const timespan = GeneralHelpers.convertMillisecondsToDays(schedule.endDate - schedule.startDate);
        const teamCapacity = schedule.numberOfMembers * 0.6 * timespan * 8; // focus factor
        const scheduleLoad = (schedule.fullTime + schedule.partTime * .5) * 80; // guess at 80 hours per task on average
        //const taskMemberRatio = (schedule.fullTime + schedule.partTime * .5) / schedule.numberOfMembers;
        //const weightedTaskAverage = (schedule.fullTime + schedule.partTime * .5) / (schedule.fullTime + schedule.partTime);
        return scheduleLoad / teamCapacity;
    }

    /**
     * Calculates and returns load, tasks, and developers for a given deliverable
     * @param disciplineSchedule The list of time allocations tied to a given discipline
     * @param compareTime The time in ms that is being compared to, generally when the report is run
     * @param deliverable The deliverable the discipline schedules belong to
     * @returns The load estimation, number of tasks, and the correct plural of 'dev'
     */
    public static generateLoad(disciplineSchedule: any[any], compareTime: number, deliverable): any[any] {
        let partTime = 0;
        let fullTime = 0;
        let timeSpan = 0;
        disciplineSchedule.filter(v => deliverable.updateDate < v.endDate).forEach(ds => {
            if(ds.partialTime) {
                partTime++;
            } else {
                fullTime++;
            }
            timeSpan += ds.endDate - ds.startDate;
        });
        let load = Math.round(100 * this.calculateTaskLoad({numberOfMembers: disciplineSchedule[0].numberOfMembers, fullTime: fullTime, partTime: partTime, startDate: 0, endDate: timeSpan}));
        const tasks = partTime + fullTime;
        const devs = 'dev' + (disciplineSchedule[0].numberOfMembers>1?'s':'');
        if(!Number(load)) {
            load = 0;
        }
        return {load: load, tasks: tasks, devs: devs};
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
     * Looks up deliverables for a given date and connects the associated teams, cards, and time allocations
     * @param date The date to lookup data for
     * @param db The database connection
     * @param alphabetize Whether to alphabetize the list
     * @returns The list of deliverables
     */
    private static buildDeliverables(date: number, db: Database, alphabetize: boolean = false): any[] {
        let dbDeliverables = db.prepare(`SELECT *, MAX(addedDate) as max FROM deliverable_diff WHERE addedDate <= ${date} GROUP BY uuid ORDER BY addedDate DESC`).all();
        let removedDeliverables = dbDeliverables.filter(d => d.startDate === null && d.endDate === null);
        dbDeliverables = dbDeliverables.filter(d => !removedDeliverables.some(r => r.uuid === d.uuid || (r.title && r.title === d.title && !r.title.includes("Unannounced"))));
        const announcedDeliverables = _._(dbDeliverables.filter(d => d.title && !d.title.includes("Unannounced"))).groupBy('title').map(d => d[0]).value();
        const unAnnouncedDeliverables = dbDeliverables.filter(d => d.title && d.title.includes("Unannounced"));
        dbDeliverables = [...announcedDeliverables, ...unAnnouncedDeliverables];

        const cardIds = dbDeliverables.filter((dd) => dd.card_id).map((dd) => dd.card_id).toString();
        const dbCards = db.prepare(`SELECT * FROM card_diff WHERE id IN (${cardIds})`).all();

        const deliverableIds = dbDeliverables.map((dd) => dd.id).toString();

        const dbDeliverableTeams = db.prepare(`SELECT *, MAX(addedDate) FROM team_diff WHERE addedDate <= ${date} AND id IN (SELECT team_id FROM deliverable_teams WHERE deliverable_id IN (${deliverableIds})) GROUP BY slug ORDER BY addedDate DESC`).all();
        const deliverableTeamIds = dbDeliverableTeams.map(dt => dt.id).toString()
        const deliverableTeams = _.groupBy(db.prepare(`SELECT * FROM deliverable_teams WHERE team_id IN (${deliverableTeamIds}) AND deliverable_id IN (${deliverableIds})`).all(), 'deliverable_id');

        let dbTimeAllocations = db.prepare(`SELECT *, MAX(ta.addedDate), ta.id AS time_id, ta.uuid AS time_uuid, ta.addedDate AS time_added FROM timeAllocation_diff AS ta JOIN discipline_diff AS di ON di.id = ta.discipline_id`+
        ` WHERE deliverable_id IN (${deliverableIds}) AND team_id IN (${dbDeliverableTeams.map(z => z.id).join(',')}) AND partialTime IS NOT NULL GROUP BY ta.uuid`).all();
        //let teamIds = dbTimeAllocations.map(z => z.team_id).filter((value, index, self) => self.indexOf(value) === index);
        dbTimeAllocations.forEach(ta => {
            ta.disciplineUuid = ta.uuid;
            ta.id = ta.time_id;
            ta.uuid = ta.time_uuid;
            ta.addedDate = ta.time_added;
            delete(ta.time_id);
            delete(ta.time_uuid);
            delete(ta.time_added);
        });
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
                team.timeAllocations = timeAllocations[t.id] && timeAllocations[t.id].filter(z => z.startDate && z.endDate);
                d.teams.push(team);
            });
        });

        return alphabetize ? _.orderBy(dbDeliverables, [d => d.title.toLowerCase()], ['asc']) : dbDeliverables;
    };
    //#endregion
}