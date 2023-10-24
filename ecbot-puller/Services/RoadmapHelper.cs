using ecbot_puller.Models;
using ecbot_puller.Models.Enums;

namespace ecbot_puller.Services
{
    internal class RoadmapHelper
    {
        public static async void RetrieveDelta()
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

                do
                {
                    deliverableRequests.Add(RSINetwork.GetResponse(RSINetwork.DeliverableQuery(offset, 20), QueryType.Deliverables, offset));
                    offset += 20;
                } while (offset < initialResponse.Result.Data.ProgressTracker.Deliverables.TotalCount);

                Parallel.ForEach(deliverableRequests, async deliverableRequest => {
                    deliverableRequest.RunSynchronously();
                });
            }
        }
    }
}
