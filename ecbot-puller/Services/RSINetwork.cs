using ecbot_puller.Models.Enums;
using System.Dynamic;
using System.Text.Json;

namespace ecbot_puller.Services
{
    internal class RSINetwork
    {
        public static void GetResponse(string data, QueryType type, int delay = 0, int retry = 0)
        {
            var sner = "";
        }

        /// <summary>
        /// Generates a graphql query for retrieving deliverables data from RSI
        /// </summary>
        /// <param name="offset">The offset</param>
        /// <param name="limit">The limit (max 20)</param>
        /// <param name="sortBy">Sort type</param>
        /// <returns>The query</returns>
        public static string DeliverableQuery(int offset = 0, int limit = 20, SortBy sortBy = SortBy.ALPHABETICAL)
        {
            dynamic query = new ExpandoObject();
            query.operationName = "deliverables";
            query.query = File.ReadAllText("GraphQL\\deliverables.graphql");
            query.variables = new
            {
                startDate = "2020-01-01",
                endDate = "2024-12-31",
                limit = limit,
                offset = offset,
                sortBy = sortBy.ToString()
            };

            return JsonSerializer.Serialize(query);
        }
    }
}
