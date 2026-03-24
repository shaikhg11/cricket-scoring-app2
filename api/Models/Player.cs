namespace CricketScoringApi.Models;

public class Player
{
    public int Id { get; set; }
    public string MatchId { get; set; } = string.Empty;

    /// <summary>"A" or "B"</summary>
    public string Team { get; set; } = string.Empty;

    /// <summary>Zero-based index within the team roster</summary>
    public int PlayerIndex { get; set; }

    public string Name { get; set; } = string.Empty;

    // Navigation
    public Match Match { get; set; } = null!;
}
