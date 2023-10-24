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
        public List<MetaData> MetaData { get; set; }
    }

    public class Teams
    {
        // TODO
    }

    public class Disciplines
    {
        // TODO
    }

    public class MetaData
    {
        public required string Uuid { get; set; }
        public required string Slug { get; set; }
        public required string Title { get; set; }
        public required string Description { get; set; }
        public string? StartDate { get; set; }
        public string? EndDate { get; set; }
        public int NumberOfDisciplines { get; set; }
        public int NumberOfTeams { get; set; }
        public string? UpdateDate { get; set; }
        public int? TotalCount { get; set; }
        public string? Card { get; set; }
        public List<Project>? Projects { get; set; }
    }

    public class Project
    {
        public required string Title { get; set; }
    }
}
