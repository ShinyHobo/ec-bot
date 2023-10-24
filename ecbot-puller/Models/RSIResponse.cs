namespace ecbot_puller.Models
{
    internal class RSIResponse
    {
        public required Data Data { get; set; }
    }

    public class Data
    {
        public required ProgressTracker ProgressTracker { get; set; }
    }

    public class ProgressTracker
    {
        public Deliverables? Deliverables { get; set; }
        public Teams? Teams { get; set; }
        public Disciplines? Disciplines { get; set; }
    }

    public class Deliverables
    {
        public int TotalCount { get; set; }
        public required List<Deliverable> MetaData { get; set; }
    }

    public class Teams
    {
        public int TotalCount { get; set; }
        public required List<Team> MetaData { get; set; }
    }

    public class Disciplines
    {
        public required List<Discipline> MetaData { get; set; }
    }
}
