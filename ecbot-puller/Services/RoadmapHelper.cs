using ecbot_puller.Models;
using ecbot_puller.Models.Enums;
using System.Data.SQLite;

namespace ecbot_puller.Services
{
    internal class RoadmapHelper
    {
        public static void RetrieveDelta()
        {
            Console.WriteLine("Retrieving roadmap state...");

            var start = DateTime.Now;
            var deliverables = new List<Deliverable>();
            var offset = 0;
            var completedQuery = true;
            var initialResponse = RSINetwork.GetResponse(RSINetwork.DeliverableQuery(offset, 1), QueryType.Deliverables);
            initialResponse.RunSynchronously();

            if(initialResponse.Result != null)
            {
                var deliverableRequests = new List<Task<RSIResponse?>>();
                var teamRequests = new List<(string DeliverableSlug, Task<RSIResponse?> Task)>();

                do
                {
                    deliverableRequests.Add(RSINetwork.GetResponse(RSINetwork.DeliverableQuery(offset, 20), QueryType.Deliverables, offset));
                    offset += 20;
                } while (offset < (initialResponse.Result.Data.ProgressTracker.Deliverables?.TotalCount ?? 0));

                Console.WriteLine("Retrieving deliverables...");
                Parallel.ForEach(deliverableRequests, (deliverableRequest, c) => {
                    deliverableRequest.RunSynchronously();
                    if(deliverableRequest.Result == null)
                    {
                        c.Break();
                        completedQuery = false;
                    }
                    else
                    {
                        var deliverablesReturned = deliverableRequest.Result.Data.ProgressTracker.Deliverables?.MetaData;
                        if(deliverablesReturned != null)
                        {
                            lock (deliverables)
                                deliverables.AddRange(deliverablesReturned);
                            lock (teamRequests)
                            {
                                foreach (var deliverable in deliverablesReturned)
                                {
                                    teamRequests.Add(new(deliverable.Slug, RSINetwork.GetResponse(RSINetwork.TeamsQuery(deliverable.Slug, offset), QueryType.Teams, 20 * teamRequests.Count)));
                                }
                            }
                        }
                    }
                });

                if (completedQuery)
                {
                    var teams = new List<Team>();
                    Console.WriteLine("Retrieving teams and disciplines...");
                    Parallel.ForEach(teamRequests, (teamRequest, c) => {
                        teamRequest.Task.RunSynchronously();
                        if(teamRequest.Task.Result == null)
                        {
                            c.Break();
                            completedQuery = false;
                        }
                        else
                        {
                            var teamsReturned = teamRequest.Task.Result.Data.ProgressTracker.Teams?.MetaData;
                            if(teamsReturned != null)
                            {
                                lock (teams)
                                    teams.AddRange(teamsReturned);
                                foreach(var team in teamsReturned)
                                {
                                    var disciplineResponse = RSINetwork.GetResponse(RSINetwork.DisciplinesQuery(team.Slug, teamRequest.DeliverableSlug), QueryType.Disciplines, 20);
                                    disciplineResponse.RunSynchronously();
                                    if(disciplineResponse.Result != null)
                                    {
                                        if(disciplineResponse.Result.Data.ProgressTracker.Disciplines != null)
                                        foreach(var discipline in disciplineResponse.Result.Data.ProgressTracker.Disciplines)
                                        {
                                            if(discipline.TimeAllocations != null)
                                            foreach(var timeAllocation in discipline.TimeAllocations)
                                            {
                                                team.TimeAllocations.Single(ta => ta.Uuid == timeAllocation.Uuid).Discipline = new Discipline() { 
                                                    Uuid = discipline.Uuid,
                                                    NumberOfMembers = discipline.NumberOfMembers,
                                                    Title = discipline.Title
                                                }; ;
                                            }
                                        }
                                    }
                                }

                                deliverables.Single(d => d.Slug == teamRequest.DeliverableSlug).Teams = teamsReturned;
                            }
                        }
                    });

                    if (completedQuery)
                    {
                        var timeToDownload = DateTime.Now - start;
                        Console.WriteLine($"Deliverables: {deliverables.Count} in {timeToDownload.TotalMilliseconds} milliseconds. Finding delta...");

                        using (var db = new SQLiteConnection("Data Source=delta.db;Version=3;"))
                        {
                            db.Open();

                            // TODO - populate db with initial values

                            var newDeliverables = AdjustData(deliverables);
                            var changes = InsertChanges(db, start.Subtract(new DateTime(1970, 1, 1)).TotalMilliseconds, newDeliverables);

                            if(changes.ChangesDetected)
                            {
                                CacheDeliverableIds(db);
                                Console.WriteLine($"Database updated with delta in {(DateTime.Now - start).TotalMilliseconds} ms");
                            }
                            else
                            {
                                Console.WriteLine("No changes were detected");
                            }
                        }
                    }
                    else
                    {
                        Console.WriteLine("Roadmap team retrieval timed out; please try again later.");
                    }
                }
                else
                {
                    Console.WriteLine("Roadmap retrieval timed out; please try again later.");
                }
            }
        }

        private static List<Deliverable> AdjustData(List<Deliverable> deliverables)
        {
            // TODO - update deliverable model to set the following
            foreach(var deliverable in deliverables)
            {
            //    d.startDate = Date.parse(d.startDate);
            //    d.endDate = Date.parse(d.endDate);
            //    d.updateDate = Date.parse(d.updateDate);
            //    d.title = _.unescape(d.title);
            //    d.description = _.unescape(d.description);
            //    if (d.card)
            //    {
            //        d.card.tid = d.card.id;
            //        if (d.card.release)
            //        {
            //            d.card.release_id = d.card.release.id;
            //            d.card.release_title = d.card.release.title;
            //        }
            //        else
            //        {
            //            d.card.release_id = d.card.release_id;
            //            d.card.release_title = d.card.release_title;
            //        }
            //        d.card.updateDate = Date.parse(d.card.updateDate);
            //        delete(d.card.id);
            //    }
            //    if (d.teams)
            //    {
            //        d.teams.forEach((team) => {
            //            team.startDate = Number(team.startDate) ? team.startDate : Date.parse(team.startDate);
            //            team.endDate = Number(team.endDate) ? team.endDate : Date.parse(team.endDate);
            //            if (team.timeAllocations)
            //            {
            //                team.timeAllocations.forEach((ta) => {
            //                    ta.startDate = Date.parse(ta.startDate);
            //                    ta.endDate = Date.parse(ta.endDate);
            //                    if (ta.discipline)
            //                    {
            //                        ta.numberOfMembers = ta.discipline.numberOfMembers;
            //                        ta.title = ta.discipline.title;
            //                        ta.disciplineUuid = ta.discipline.uuid;
            //                        delete(ta.discipline);
            //                    }
            //                });
            //            }
            //        });
            //    }
            }
            return deliverables;
        }

        private static Changes InsertChanges(SQLiteConnection db, double compareTime, List<Deliverable> deliverables)
        {
            //const deliverableInsert = db.prepare("INSERT INTO deliverable_diff (uuid, slug, title, description, addedDate, numberOfDisciplines, numberOfTeams, totalCount, card_id, project_ids, startDate, endDate, updateDate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
            //const cardsInsert = db.prepare("INSERT INTO card_diff (tid, title, description, category, release_id, release_title, updateDate, addedDate, thumbnail) VALUES (?,?,?,?,?,?,?,?,?)");
            //const teamsInsert = db.prepare("INSERT INTO team_diff (abbreviation, title, description, startDate, endDate, addedDate, numberOfDeliverables, slug) VALUES (?,?,?,?,?,?,?,?)");
            //const deliverableTeamsInsert = db.prepare("INSERT OR IGNORE INTO deliverable_teams (deliverable_id, team_id) VALUES (?,?)");
            //const timeAllocationInsert = db.prepare("INSERT OR IGNORE INTO timeAllocation_diff (startDate, endDate, addedDate, uuid, partialTime, team_id, deliverable_id, discipline_id) VALUES (?,?,?,?,?,?,?,?)");
            //const disciplinesInsert = db.prepare("INSERT INTO discipline_diff (numberOfMembers, title, uuid, addedDate) VALUES (?,?,?,?)");

            //// filter out deliverables that had their uuids changed, except for unnanounced content (we don't know if one content is the same as another if their uuid changes)
            //let dbDeliverables = db.prepare("SELECT *, MAX(addedDate) FROM deliverable_diff GROUP BY uuid ORDER BY addedDate DESC").all();
            //const announcedDeliverables = _._(dbDeliverables.filter(d => d.title && !d.title.includes("Unannounced"))).groupBy('title').map(d => d[0]).value();
            //const unAnnouncedDeliverables = dbDeliverables.filter(d => d.title && d.title.includes("Unannounced"));
            //dbDeliverables = [...announcedDeliverables, ...unAnnouncedDeliverables];

            //let dbTeams = db.prepare("SELECT *, MAX(addedDate) FROM team_diff GROUP BY slug").all();
            //const mostRecentDeliverableIds = dbDeliverables.map((dd) => dd.id).toString();
            //const dbDeliverableTeams = db.prepare(`SELECT * FROM team_diff WHERE id IN(SELECT team_id FROM deliverable_teams WHERE deliverable_id IN(${ mostRecentDeliverableIds}))`).all();
            //const dbCards = db.prepare("SELECT *, MAX(addedDate) FROM card_diff GROUP BY tid").all();
            //let dbTimeAllocations = db.prepare(`SELECT *, MAX(addedDate) FROM timeAllocation_diff WHERE deliverable_id IN(${ mostRecentDeliverableIds}) GROUP BY uuid`).all();
            //// TODO - group time allocations by deliverable_id to speed up process

            //const mostRecentDisciplineIds = dbTimeAllocations.filter(dd => dd.discipline_id).map((dd) => dd.discipline_id).toString();
            //let dbDisciplines = db.prepare(`SELECT *, MAX(addedDate), uuid AS disciplineUuid FROM discipline_diff WHERE id IN(${ mostRecentDisciplineIds}) GROUP BY uuid ORDER BY id`).all();

            //// TODO - investigate cleaning up removed deliverables code below, check buildDeliverables()
            //const dbRemovedDeliverables = dbDeliverables.filter(d => d.startDate === null && d.endDate === null);
            //const removedDeliverables = dbDeliverables.filter(f => !deliverables.some(l => l.uuid === f.uuid || (l.title && l.title === f.title && !l.title.includes("Unannounced"))) &&
            //    !dbRemovedDeliverables.some(l => l.uuid === f.uuid || (l.title && l.title === f.title && !l.title.includes("Unannounced"))));

            return InsertDeliverables(deliverables);
        }

        private static Changes InsertDeliverables(List<Deliverable> deliverables)
        {
            //let changes = { added: 0, removed: 0, updated: 0, readded: 0}; // TODO - keep track of other changes (teams, disciplines, cards, times). Possible that these are sometimes changed without affecting the deliverable
            //                                                               // check for team differences
            //const dTeams = _.uniqBy(dList.filter((d) => d.teams).flatMap((d) => d.teams).map((t) => _.omit(t, 'timeAllocations', 'uuid')), 'slug');
            //if(dbTeams.length) {
            //    const dbRemovedTeams = dbTeams.filter(t => t.startDate === null && t.endDate === null);
            //    const removedTeams = dbTeams.filter(f => !dTeams.some(l => l.slug === f.slug) && !dbRemovedTeams.some(l => l.slug === f.slug))
            //                removedTeams.forEach((rt) => {
            //                    teamsInsert.run([rt.abbreviation, rt.title, rt.description, null, null, now, rt.numberOfDeliverables, rt.slug]);
            //                });
            //} 
            //else
            //{ // initialize team_diff
            //    const inserts = insertTeamsAndTimeAllocations(dTeams, false); // changes to teams or time allocations
            //    dbTeams = inserts.teams;
            //    dbTimeAllocations = inserts.timeAllocations;
            //}

            //if (dbTimeAllocations.length)
            //{
            //    const groupedTimeAllocations = _.groupBy(dbTimeAllocations, 'deliverable_id');

            //    dList.forEach(d => {
            //        if (d.teams)
            //        {
            //            const oldDeliverable = dbDeliverables.find(od => od.uuid === d.uuid || (d.title && od.title === d.title && !d.title.includes("Unannounced")));
            //            if (oldDeliverable && groupedTimeAllocations[oldDeliverable.id])
            //            { // won't be any removed time allocations if there were none to begin with
            //                const dbRemovedTimeAllocations = groupedTimeAllocations[oldDeliverable.id].filter(ta => ta.startDate === null && ta.endDate === null && ta.partialTime === null);
            //                const removedTimes = groupedTimeAllocations[oldDeliverable.id].filter(f => f.teams && !f.teams.some(t => t.timeAllocations && t.timeAllocations.some(l => l.uuid === f.uuid)) && !dbRemovedTimeAllocations.some(l => l.uuid === f.uuid));
            //                removedTimes.forEach((rt) => {
            //                    timeAllocationInsert.run([null, null, now, rt.uuid, null, rt.team_id, rt.deliverable_id, rt.discipline_id]);
            //                });

            //                // disciplines are directly tied to time allocations by their uuid, one to many relationship
            //                const dbRemovedDisciplines = dbDisciplines.filter(di => di.numberOfMembers === null);
            //                const removedDisciplines = dbDisciplines.filter(f => f.teams && !f.teams.some(t => t.timeAllocations && t.timeAllocations.some(l => l.disciplineUuid === f.uuid)) && !dbRemovedDisciplines.some(l => l.uuid === f.uuid));
            //                removedDisciplines.forEach((rd) => {
            //                    disciplinesInsert.run([null, rd.title, rd.uuid, now]);
            //                });
            //            }
            //        }
            //    });
            //}

            //if (dbCards.length)
            //{
            //    const dCards = dList.filter((d) => d.card).flatMap((d) => d.card);
            //    const dbRemovedCards = dbCards.filter(f => f.updateDate === null && f.release_id === null && f.release_title === null);
            //    const removedCards = dbCards.filter(f => !dCards.some(l => l.tid === f.tid) && !dbRemovedCards.some(l => l.tid === f.tid));
            //    removedCards.forEach((rc) => {
            //        cardsInsert.run([rc.tid, rc.title, rc.description, rc.category, null, null, null, now, rc.thumbnail]);
            //    });
            //}

            //removedDeliverables.forEach((r) => {
            //    deliverableInsert.run([r.uuid, r.slug, r.title, r.description, now, null, null, r.totalCount, null, null, null, null, null]);
            //    changes.removed++;
            //});

            //let addedCards = []; // some deliverables share the same release view card (ie. 'Bombs' and 'MOAB')
            //let addedTeams = []; // team parameters can change without related deliverables updating (ie. end date shifts outward)
            //let addedDeliverables = []; // deliverables can update without affecting children (name/description/updateDate)
            //dList.forEach((d) => {
            //    const dMatch = dbDeliverables.find((dd) => dd.uuid === d.uuid || (d.title && dd.title === d.title && !d.title.includes("Unannounced")));
            //    const gd = diff.getDiff(dMatch, d).filter((df) => df.op === 'update');

            //    let team_ids = [];
            //    let timeAllocations = [];
            //    // check for changes to team and time allocations separate from deliverable. possible for sprints to change without affecting aggregate start and end dates
            //    if (d.teams)
            //    {
            //        const inserts = insertTeamsAndTimeAllocations(d.teams); // changes to teams or time allocations
            //        team_ids = inserts.teams;
            //        addedTeams = [...addedTeams, ...inserts.addedTeams];
            //        timeAllocations = inserts.timeAllocations; // updated time allocations
            //    }

            //    if (gd.length || !dMatch || !dbDeliverableTeams.length || team_ids.length || timeAllocations.length)
            //    {
            //        let card_id = null;
            //        if (d.card)
            //        {
            //            const cMatch = dbCards.find((dc) => dc.tid === d.card.tid);
            //            const cgd = diff.getDiff(cMatch, d.card).filter((df) => df.op === 'update');
            //            if (!cMatch || cgd.length)
            //            {
            //                const sharedCard = addedCards.find(c => c.tid === d.card.tid);
            //                if (sharedCard)
            //                {
            //                    card_id = sharedCard.id;
            //                }
            //                else
            //                {
            //                    const row = cardsInsert.run([d.card.tid, d.card.title, d.card.description, d.card.category, d.card.release_id, d.card.release_title, d.card.updateDate, now, d.card.thumbnail]);
            //                    card_id = row.lastInsertRowid;
            //                    addedCards.push({ tid: d.card.tid, id: card_id});
            //                            }
            //                        } else
            //{
            //    card_id = cMatch.id;
            //}
            //                    }

            //                    const projectIds = _.uniq(d.projects.map(p => { return p.title === 'Star Citizen' ? 'SC' : (p.title === 'Squadron 42' ? 'SQ42' : null); })).toString();

            //let did = null;
            //if (!dMatch || (dMatch && gd.length))
            //{
            //    const row = deliverableInsert.run([d.uuid, d.slug, d.title, d.description, now, d.numberOfDisciplines, d.numberOfTeams, d.totalCount, card_id, projectIds, d.startDate, d.endDate, d.updateDate]);
            //    did = row.lastInsertRowid;
            //    if (dMatch)
            //    {
            //        addedDeliverables.push({ matchId: dMatch.id, newId: did});
            //    }
            //    if (dMatch && dMatch.startDate && dMatch.endDate)
            //    {
            //        changes.updated++;
            //    }
            //    else
            //    {
            //        changes.added++;
            //        if (dMatch)
            //        {
            //            changes.readded++;
            //        }
            //    }
            //}
            //else
            //{
            //    did = dMatch.id;
            //}

            //team_ids.forEach((tid) => {
            //    deliverableTeamsInsert.run([did, tid]);
            //});

            //timeAllocations.forEach((ta) => {
            //    if (!ta.nochange)
            //    {
            //        timeAllocationInsert.run([ta.startDate, ta.endDate, now, ta.uuid, ta.partialTime ? 1 : 0, ta.team_id, did, ta.discipline_id]);
            //    }
            //});
            //                }
            //            });

            //// Update deliverable team relationships when deliverable and team update separately from each other
            //const addedTeamIds = addedTeams.map(z => z.matchId).join(',');
            //const addedDeliverableIds = addedDeliverables.map(z => z.matchId).join(',');
            //const oldDeliverableTeams = db.prepare(`SELECT * FROM deliverable_teams WHERE team_id IN(${addedTeamIds}) OR deliverable_id IN (${addedDeliverableIds})`).all();
            //oldDeliverableTeams.forEach(dt => {
            //    const matchedTeam = addedTeams.find(at => at.matchId === dt.team_id);
            //    const matchedDeliverable = addedDeliverables.find(d => d.matchId === dt.deliverable_id);
            //    const teamExists = dList.find(dl => dl.teams && dl.teams.some(dt => dt.uuid === dt.uuid));
            //    if ((matchedTeam || matchedDeliverable) && teamExists)
            //    {
            //        deliverableTeamsInsert.run([matchedDeliverable ? matchedDeliverable.newId : dt.deliverable_id, matchedTeam ? matchedTeam.newId : dt.team_id]);
            //    }
            //});

            //// Update time allocations when team or deliverable update, but time allocations don't
            //const oldTimeAllocations = db.prepare(`SELECT *, MAX(addedDate) FROM timeAllocation_diff WHERE team_id IN(${addedTeamIds}) OR deliverable_id IN (${addedDeliverableIds}) AND partialTime IS NOT NULL GROUP BY uuid`).all();
            //oldTimeAllocations.forEach(ta => {
            //    const matchedTeam = addedTeams.find(at => at.matchId === at.team_id);
            //    const matchedDeliverable = addedDeliverables.find(d => d.matchId === ta.deliverable_id);
            //    // Don't add a time allocation for a new version of either team or deliverable if the time allocation was removed
            //    const timeAllocationExists = dList.find(dl => dl.teams && dl.teams.some(dt => dt.timeAllocations && dt.timeAllocations.some(dta => dta.uuid === ta.uuid)));
            //    if ((matchedTeam || matchedDeliverable) && timeAllocationExists)
            //    {
            //        timeAllocationInsert.run([ta.startDate, ta.endDate, now, ta.uuid, ta.partialTime, matchedTeam ? matchedTeam.newId : ta.team_id, matchedDeliverable ? matchedDeliverable.newId : ta.deliverable_id, ta.discipline_id]);
            //    }
            //});
            return new Changes();
        }

        private static void InsertTimeAllocations(List<Team> teams, bool justIds = true)
        {
        //    const rTeams = [];
        //    const rTimes = [];
        //    const rAddedTeams = [];
        //    if (teams)
        //    {
        //        const disciplineProperties = ['numberOfMembers', 'title', 'disciplineUuid'];
        //        const timeAllocationProperties = ['startDate', 'endDate', 'uuid', 'partialTime'];
        //        teams.forEach((dt) => {
        //            const match = dbTeams.sort((a, b) => b.addedDate - a.addedDate).find(t => t.slug === dt.slug);
        //            const tDiff = diff.getDiff(match, dt).filter((df) => df.op === 'update');
        //            const tChanges = tDiff.map(x => ({ change: x.path && x.path[0], val: x.val})).filter(x => x.change !== 'timeAllocations');
        //        let teamId = null;
        //        if (tChanges.length || !match)
        //        { // new or changed
        //            const teamRow = teamsInsert.run([dt.abbreviation, dt.title, dt.description, Number(dt.startDate) ? dt.startDate : Date.parse(dt.startDate), Number(dt.endDate) ? dt.endDate : Date.parse(dt.endDate), now, dt.numberOfDeliverables, dt.slug]);
        //            teamId = teamRow.lastInsertRowid;
        //            if (match)
        //            {
        //                rAddedTeams.push({ matchId: match.id, newId: teamId});
        //            }
        //            dbTeams.push({ id: teamId, addedDate: now, ...dt});
        //            if (justIds)
        //            {
        //                rTeams.push(teamId);
        //            }
        //            else
        //            {
        //                rTeams.push({ id: teamId, ...dt});
        //            }
        //        }
        //        else
        //        {
        //            teamId = match.id;
        //            rTeams.push(teamId);
        //        }

        //        // analyze changes to time allocations
        //        if (dt.timeAllocations)
        //        {
        //            dt.timeAllocations.forEach((ta) => {
        //            let disciplineId = null;
        //            const diMatch = dbDisciplines.sort((a, b) => b.addedDate - a.addedDate).find(di => di.disciplineUuid === ta.disciplineUuid);
        //            const diDiff = diff.getDiff(diMatch, ta);
        //            const diChanges = diDiff.map(x => ({ change: x.path && x.path[0], val: x.val}));
        //            if (!diMatch || diChanges.some(tac => disciplineProperties.includes(tac.change && tac.change.toString())))
        //            {
        //                const disciplineRow = disciplinesInsert.run([ta.numberOfMembers, ta.title, ta.disciplineUuid, now]);
        //                disciplineId = disciplineRow.lastInsertRowid;
        //                dbDisciplines.push({ id: disciplineId, addedDate: now, ...ta}); // filter duplicates
        //            }
        //            else
        //            {
        //                disciplineId = diMatch.id;
        //            }

        //            const taMatch = dbTimeAllocations.sort((a, b) => b.addedDate - a.addedDate).find(t => t.uuid === ta.uuid);
        //            if (taMatch)
        //            {
        //                taMatch.partialTime = taMatch.partialTime ? true : false;
        //            }
        //            const taDiff = diff.getDiff(taMatch, ta);
        //            const taChanges = taDiff.map(x => ({ change: x.path && x.path[0], val: x.val}));

        //            if (!taMatch || taChanges.some(tad => timeAllocationProperties.includes(tad.change && tad.change.toString())))
        //            {
        //                dbTimeAllocations.push({ team_id: teamId, discipline_id: disciplineId, addedDate: now, ...ta});
        //                rTimes.push({ team_id: teamId, discipline_id: disciplineId, ...ta});
        //            }
        //            else
        //            {
        //                rTimes.push({ nochange: true, team_id: teamId, discipline_id: disciplineId, ...taMatch});
        //            }
        //        });
        //                }
        //            });
        //        }
        //            return {teams: rTeams, timeAllocations: rTimes, addedTeams: rAddedTeams
        //    };
        }

        private static void CacheDeliverableIds(SQLiteConnection db)
        {
            Console.Write("Beginning caching process");
            //const sampleDatesQuery = db.prepare("SELECT GROUP_CONCAT(addedDate) FROM (SELECT DISTINCT addedDate FROM deliverable_diff ORDER BY addedDate DESC)").get();
            //const sampleDates = sampleDatesQuery['GROUP_CONCAT(addedDate)']?.split(",") ?? [];

            //const inProgressSampleDatesQuery = db.prepare("SELECT GROUP_CONCAT(sampleDate) FROM in_progress_deliverables_cache").get();
            //const inProgressSampleDates = inProgressSampleDatesQuery['GROUP_CONCAT(sampleDate)']?.split(",") ?? [];

            //const cachedSampleDatesQuery = db.prepare("SELECT GROUP_CONCAT(sampleDate) FROM sample_date_deliverables_cache").get();
            //const cachedSampleDates = cachedSampleDatesQuery['GROUP_CONCAT(sampleDate)']?.split(",") ?? [];

            //const cachedDeliverableTeamsQuery = db.prepare("SELECT GROUP_CONCAT(sampleDate) FROM deliverable_teams_cache").get();
            //const cachedDeliverableTeams = cachedDeliverableTeamsQuery['GROUP_CONCAT(sampleDate)']?.split(",") ?? [];

            //const inProgressCacheInsert = db.prepare("INSERT INTO in_progress_deliverables_cache (sampleDate, deliverable_ids) VALUES (?,?)");
            //const sampleDateCacheInsert = db.prepare("INSERT INTO sample_date_deliverables_cache (sampleDate, deliverable_ids) VALUES (?,?)");
            //const deliverableTeamsCacheInsert = db.prepare("INSERT INTO deliverable_teams_cache (sampleDate, team_ids) VALUES (?,?)");

            //const insertRows = db.transaction(() => {
            //    sampleDates.forEach((sd) => {
            //        const hasInProgressCache = inProgressSampleDates.includes(sd);
            //        const hasSampleDateCache = cachedSampleDates.includes(sd);
            //        const hasDeliverableTeamsCache = cachedDeliverableTeams.includes(sd);

            //        // already cached completely
            //        if (hasInProgressCache && hasSampleDateCache && hasDeliverableTeamsCache)
            //        {
            //            return;
            //        }

            //        const deliverablesForSampleDate = this.getUniqueDeliverables(db, sd);
            //        const deliverableIds = deliverablesForSampleDate.map(d => d.id);

            //        // cache in progress deliverable ids
            //        if (!hasInProgressCache)
            //        {
            //            const inProgressIds = this.getInProgressDeliverables(db, sd, deliverablesForSampleDate);
            //            inProgressCacheInsert.run([sd, inProgressIds.join(",")]);
            //        }

            //        // cache sample date deliverable ids
            //        if (!hasSampleDateCache)
            //        {
            //            sampleDateCacheInsert.run([sd, deliverableIds.join(",")]);
            //        }

            //        // cache deliverable teams that were used for the given sample date
            //        if (!hasDeliverableTeamsCache)
            //        {
            //            const teamIds = this.getDeliverableTeams(db, deliverablesForSampleDate);
            //            deliverableTeamsCacheInsert.run([sd, teamIds.join(",")]);
            //        }
            //    });
            //});
            //insertRows();
            Console.WriteLine("Caching process complete!");
        }
    }
}
