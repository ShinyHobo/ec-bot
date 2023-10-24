namespace ecbot_puller.Models
{
    public class Discipline
    {
        public required string Title { get; set; }
        public required string Uuid { get; set; }
        public int NumberOfMembers { get; set; }
        public List<TimeAllocation>? TimeAllocations { get; set; }
    }
}
