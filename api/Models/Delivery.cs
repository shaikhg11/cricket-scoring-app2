using System.ComponentModel.DataAnnotations.Schema;

namespace CricketScoringApi.Models;

[Table("Deliveries", Schema = "dbo")]
public class Delivery
{
    public long Id { get; set; }
    public string MatchId { get; set; } = string.Empty;

    /// <summary>1 or 2</summary>
    public int Innings { get; set; }

    public int Over { get; set; }
    public int Ball { get; set; }
    public int Runs { get; set; }

    /// <summary>null | "Wide" | "No Ball" | "Bye" | "Leg Bye"</summary>
    public string? Extra { get; set; }

    public bool IsWicket { get; set; }
    public bool FreeHit { get; set; }

    /// <summary>Zero-based index into the batting team's player list</summary>
    public int BatterIdx { get; set; }

    /// <summary>Zero-based index into the bowling team's player list</summary>
    public int BowlerIdx { get; set; }

    /// <summary>"Bowled" | "Caught" | "Stumped" | "Run Out" | "Hit Wicket" | "Retired"</summary>
    public string? DismissalType { get; set; }

    /// <summary>Index of fielder (catch / run-out)</summary>
    public int? FielderIdx { get; set; }

    /// <summary>Actual batter dismissed (differs from BatterIdx on run-outs)</summary>
    public int? BatsmanOutIdx { get; set; }

    /// <summary>Manually chosen incoming batter index after a wicket</summary>
    public int? NextBatterIdx { get; set; }

    /// <summary>For Caught: did batters cross before the catch? (affects strike rotation)</summary>
    public bool? BattersCrossed { get; set; }

    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Match Match { get; set; } = null!;
}
