using CricketScoringApi.Models;
using Microsoft.EntityFrameworkCore;

namespace CricketScoringApi.Data;

public class CricketDbContext(DbContextOptions<CricketDbContext> options) : DbContext(options)
{
    public DbSet<Match> Matches => Set<Match>();
    public DbSet<Player> Players => Set<Player>();
    public DbSet<Delivery> Deliveries => Set<Delivery>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        // ── Match ──────────────────────────────────────────────────
        model.Entity<Match>(e =>
        {
            e.HasKey(m => m.Id);
            e.Property(m => m.Id).HasMaxLength(50);
            e.Property(m => m.TeamA).HasMaxLength(100).IsRequired();
            e.Property(m => m.TeamB).HasMaxLength(100).IsRequired();
            e.Property(m => m.ApiUrl).HasMaxLength(500);
            e.Property(m => m.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
        });

        // ── Player ─────────────────────────────────────────────────
        model.Entity<Player>(e =>
        {
            e.HasKey(p => p.Id);
            e.Property(p => p.Name).HasMaxLength(100).IsRequired();
            e.Property(p => p.Team).HasMaxLength(1).IsRequired();

            e.HasOne(p => p.Match)
             .WithMany(m => m.Players)
             .HasForeignKey(p => p.MatchId)
             .OnDelete(DeleteBehavior.Cascade);

            // Unique: one entry per (match, team, index)
            e.HasIndex(p => new { p.MatchId, p.Team, p.PlayerIndex }).IsUnique();
        });

        // ── Delivery ───────────────────────────────────────────────
        model.Entity<Delivery>(e =>
        {
            e.HasKey(d => d.Id);
            e.Property(d => d.Extra).HasMaxLength(20);
            e.Property(d => d.DismissalType).HasMaxLength(50);
            e.Property(d => d.RecordedAt).HasDefaultValueSql("GETUTCDATE()");

            e.HasOne(d => d.Match)
             .WithMany(m => m.Deliveries)
             .HasForeignKey(d => d.MatchId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(d => d.MatchId);
            e.HasIndex(d => new { d.MatchId, d.Innings });
        });
    }
}
