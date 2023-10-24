using ecbot_puller.Models;
using ecbot_puller.Models.Enums;
using System.Dynamic;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace ecbot_puller.Services
{
    /// <summary>
    /// RSI network and query related methods
    /// </summary>
    internal static class RSINetwork
    {
        #region Properties
        public static readonly string RSI = "https://robertsspaceindustries.com/";
        #endregion

        /// <summary>
        /// Gets data from RSI
        /// </summary>
        /// <param name="data">The graphql query</param>
        /// <param name="type">The graphql query type</param>
        /// <param name="delay">The number of milliseconds to delay the call by</param>
        /// <param name="retry">The number of retries that have been attempted</param>
        /// <returns>The RSI response</returns>
        public static Task<RSIResponse?> GetResponse(string data, QueryType type, int delay = 0, int retry = 0)
        {
            return Task.Run(async () => {
                HttpClient client = new HttpClient
                {
                    BaseAddress = new Uri(RSI),
                    Timeout = new TimeSpan(0, 0, 10)
                };
                client.DefaultRequestHeaders.Accept
                  .Add(new MediaTypeWithQualityHeaderValue("application/json"));

                HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, "/graphql")
                {
                    Content = new StringContent(data, Encoding.UTF8, "application/json")
                };

                RSIResponse? rsiResponse = null;

                var result = await client.SendAsync(request);
                switch (result.StatusCode)
                {
                    case System.Net.HttpStatusCode.OK:
                        var response = await result.Content.ReadAsStringAsync();
                        try
                        {
                            rsiResponse = Newtonsoft.Json.JsonConvert.DeserializeObject<RSIResponse>(response);
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine(ex.Message);
                        }
                        break;
                    case System.Net.HttpStatusCode.RequestTimeout:
                        // TODO
                        break;
                    default:
                        // TODO
                        break;
                }

                return rsiResponse;
            });
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
