namespace ecbot_puller.Models
{
    public class Team
    {
        public required string Title { get; set; }
        public required string Description { get; set; }
        public required string Abbreviation { get; set; }
        public required string StartDate { get; set; }
        public required string EndDate { get; set; }
        public int NumberOfDeliverables { get; set; }
        public required string Slug { get; set; }
        public required List<TimeAllocation> TimeAllocations { get; set; }
    }

    public class TimeAllocation
    {
        public required string StartDate { get; set; }
        public required string EndDate { get; set; }
        public required string Uuid { get; set; }
        public bool PartialTime { get; set; }
    }
}
