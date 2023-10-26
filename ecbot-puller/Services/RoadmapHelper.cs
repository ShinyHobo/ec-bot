﻿using ecbot_puller.Models;
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

        public static List<Deliverable> AdjustData(List<Deliverable> deliverables)
        {
            // TODO
            return deliverables;
        }

        public static Changes InsertChanges(SQLiteConnection db, double compareTime, List<Deliverable> newDeliverables)
        {
            // TODO
            return new Changes();
        }

        public static void CacheDeliverableIds(SQLiteConnection db)
        {
            // TODO
        }
    }
}
