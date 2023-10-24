namespace ecbot_puller.Models
{
    internal class RSIResponse
    {
        public Data Data { get; set; }
    }

    public class Data
    {
        public ProgressTracker ProgressTracker { get; set; }
    }

    public class ProgressTracker
    {
        public Deliverables Deliverables { get; set; }
        public Teams Teams { get; set; }
        public Disciplines Disciplines { get; set; }
    }

    public class Deliverables
    {
        public int TotalCount { get; set; }
        public List<Deliverable> MetaData { get; set; }
    }

    public class Teams
    {
        // TODO
    }

    public class Disciplines
    {
        // TODO
    }
}
