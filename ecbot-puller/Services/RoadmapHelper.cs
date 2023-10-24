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
            var deliverables = new List<RSIResponse>();
            var offset = 0;
            var completedQuery = true;
            var initialResponse = await RSINetwork.GetResponse(RSINetwork.DeliverableQuery(offset, 1), QueryType.Deliverables);
        }
    }
}
