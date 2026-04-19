using System.ComponentModel.DataAnnotations.Schema;

namespace CricketScoringApi.Models;

[Table("Matches", Schema = "dbo")]
public class Match
{
    public string Id { get; set; } = string.Empty;
    public string TeamA { get; set; } = string.Empty;
    public string TeamB { get; set; } = string.Empty;
    public int Overs { get; set; }
    public string? ApiUrl { get; set; }
    public bool Synced { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public string? BattingFirst { get; set; }
    public string? TossWinner { get; set; }
    public int? Inn1BatterA { get; set; }
    public int? Inn1BatterB { get; set; }
    public int? Inn2BatterA { get; set; }
    public int? Inn2BatterB { get; set; }

    // Navigation properties
    public ICollection<Player> Players { get; set; } = new List<Player>();
    public ICollection<Delivery> Deliveries { get; set; } = new List<Delivery>();
}
