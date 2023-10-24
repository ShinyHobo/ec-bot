namespace ecbot_puller.Models
{
    public class Deliverable
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
        public Card? Card { get; set; }
        public List<Project>? Projects { get; set; }
        public List<Team>? Teams { get; set; }
    }

    public class Card
    {
        public required int Id { get; set; }
        public required string Title { get; set; }
        public required string Description { get; set; }
        public required string Category { get; set; }
        public required Release Release { get; set; }
        public required Board Board { get; set; }
        public required string UpdateDate { get; set; }
        public required string Thumbnail { get; set; }
    }

    public class Release
    {
        public required int Id { get; set; }
        public required string Title { get; set; }
    }

    public class Board
    {
        public required int Id { get; set; }
        public required string Title { get; set; }
    }

    public class Project
    {
        public required string Title { get; set; }
    }
}
