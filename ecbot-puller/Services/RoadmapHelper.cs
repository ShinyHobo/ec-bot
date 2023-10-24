using ecbot_puller.Models;
using ecbot_puller.Models.Enums;

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
                                deliverables.Single(d => d.Slug == teamRequest.DeliverableSlug).Teams = teamsReturned;
                                // TODO - add discipline results here
                            }
                        }
                    });

                    var end = DateTime.Now - start;

                    if (completedQuery)
                    {

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
    }
}
