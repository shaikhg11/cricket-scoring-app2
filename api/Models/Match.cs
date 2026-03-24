namespace CricketScoringApi.Models;

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

    // Navigation properties
    public ICollection<Player> Players { get; set; } = new List<Player>();
    public ICollection<Delivery> Deliveries { get; set; } = new List<Delivery>();
}
