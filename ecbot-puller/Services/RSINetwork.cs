using ecbot_puller.Models.Enums;
using System.Dynamic;
using System.Text.Json;

namespace ecbot_puller.Services
{
    /// <summary>
    /// RSI network and query related methods
    /// </summary>
    internal static class RSINetwork
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
                endDate = "2050-12-31",
                limit = limit,
                offset = offset,
                sortBy = sortBy.ToString()
            };

            return JsonSerializer.Serialize(query);
        }

        /// <summary>
        /// Generates a graphql query for retrieving teams data from RSI
        /// </summary>
        /// <param name="deliverableSlug">The deliverable slug</param>
        /// <param name="offset">The offset</param>
        /// <param name="sortBy">Sort type</param>
        /// <returns>The query</returns>
        public static string TeamsQuery(string deliverableSlug, int offset = 0, SortBy sortBy = SortBy.ALPHABETICAL)
        {
            dynamic query = new ExpandoObject();
            query.operationName = "teams";
            query.query = File.ReadAllText("GraphQL\\teams.graphql");
            query.variables = new
            {
                startDate = "2020-01-01",
                endDate = "2050-12-31",
                limit = 20,
                offset = offset,
                sortBy = sortBy.ToString(),
                deliverableSlug = deliverableSlug
            };

            return JsonSerializer.Serialize(query);
        }

        /// <summary>
        /// Generates a graphql query for tretrieving disciplines data from RSI
        /// </summary>
        /// <param name="teamSlug">The team slug</param>
        /// <param name="deliverableSlug">The deliverable slug</param>
        /// <returns>The query</returns>
        public static string DisciplinesQuery(string teamSlug, string deliverableSlug)
        {
            dynamic query = new ExpandoObject();
            query.operationName = "disciplines";
            query.query = File.ReadAllText("GraphQL\\disciplines.graphql");
            query.variables = new
            {
                startDate = "2020-01-01",
                endDate = "2050-12-31",
                teamSlug = teamSlug,
                deliverableSlug = deliverableSlug
            };

            return JsonSerializer.Serialize(query);
        }
    }
}
