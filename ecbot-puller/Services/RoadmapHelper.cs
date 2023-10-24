using ecbot_puller.Models;
using ecbot_puller.Models.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

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
            var compiledQuery = true;
            //var initialResponse = 
            RSINetwork.GetResponse(RSINetwork.DeliverableQuery(offset, 1), QueryType.Deliverables);
        }
    }
}
