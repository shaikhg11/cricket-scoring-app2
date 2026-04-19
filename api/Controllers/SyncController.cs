using CricketScoringApi.Data;
using CricketScoringApi.DTOs;
using CricketScoringApi.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using Match = CricketScoringApi.Models.Match;

namespace CricketScoringApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SyncController(CricketDbContext db) : ControllerBase
{


    /// <summary>
    /// Full sync from the Howzat app — upserts match, players, and all deliveries.
    /// This is the endpoint the mobile app posts to.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> TestConnection()
    {
        return Ok(new { message = "Connection successful" });
    }

    /// <summary>
    /// Full sync from the Howzat app — upserts match, players, and all deliveries.
    /// This is the endpoint the mobile app posts to.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Sync([FromBody] SyncPayloadRequest payload)
    {
        var strategy = db.Database.CreateExecutionStrategy();

        var matchid = string.Empty;
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();

            // ── Upsert match ──────────────────────────────────────────
            var match = await db.Matches.FindAsync(payload.Match.Id);
            if (match == null)
            {
                match = new Match { Id = payload.Match.Id, CreatedAt = DateTime.UtcNow };
                db.Matches.Add(match);
            }

            match.TeamA       = payload.Match.TeamA;
            match.TeamB       = payload.Match.TeamB;
            match.Overs       = payload.Match.Overs;
            match.ApiUrl      = payload.Match.ApiUrl;
            match.Synced      = true;
            match.UpdatedAt   = DateTime.UtcNow;
            match.BattingFirst = payload.Match.BattingFirst;
            match.TossWinner   = payload.Match.TossWinner;
            match.Inn1BatterA  = payload.Match.Inn1BatterA;
            match.Inn1BatterB  = payload.Match.Inn1BatterB;
            match.Inn2BatterA  = payload.Match.Inn2BatterA;
            match.Inn2BatterB  = payload.Match.Inn2BatterB;

            // ── Upsert players ────────────────────────────────────────
            var existingPlayers = await db.Players
                .Where(p => p.MatchId == match.Id)
                .ToListAsync();

            void UpsertTeam(List<string> names, string team)
            {
                for (int i = 0; i < names.Count; i++)
                {
                    var p = existingPlayers.FirstOrDefault(x => x.Team == team && x.PlayerIndex == i);
                    if (p == null)
                    {
                        db.Players.Add(new Player
                        {
                            MatchId     = match.Id,
                            Team        = team,
                            PlayerIndex = i,
                            Name        = names[i]
                        });
                    }
                    else
                    {
                        p.Name = names[i];
                    }
                }
            }

            UpsertTeam(payload.Match.PlayersA, "A");
            UpsertTeam(payload.Match.PlayersB, "B");

            // ── Upsert deliveries ─────────────────────────────────────
            var incomingIds = payload.Deliveries.Select(d => d.Id).ToHashSet();
            var existingIds = await db.Deliveries
                .Where(d => d.MatchId == match.Id)
                .Select(d => d.Id)
                .ToListAsync();

            var toAdd = payload.Deliveries
                .Where(d => !existingIds.Contains(d.Id))
                .Select(d => new Delivery
                {
                    //Id            = d.Id,
                    MatchId       = match.Id,
                    Innings       = d.Innings,
                    Over          = d.Over,
                    Ball          = d.Ball,
                    Runs          = d.Runs,
                    Extra         = d.Extra,
                    IsWicket      = d.IsWicket,
                    FreeHit       = d.FreeHit,
                    BatterIdx     = d.BatterIdx,
                    BowlerIdx     = d.BowlerIdx,
                    DismissalType = d.DismissalType,
                    FielderIdx    = d.FielderIdx,
                    BatsmanOutIdx = d.BatsmanOutIdx,
                    NextBatterIdx  = d.NextBatterIdx,
                    BattersCrossed = d.BattersCrossed,
                    RecordedAt     = DateTime.UtcNow,
                });

            await db.Deliveries.AddRangeAsync(toAdd);

            // Remove any deliveries that were undone in the app
            var toRemove = await db.Deliveries
                .Where(d => d.MatchId == match.Id && !incomingIds.Contains(d.Id))
                .ToListAsync();
            db.Deliveries.RemoveRange(toRemove);

            await db.SaveChangesAsync();
            await tx.CommitAsync();
            matchid = match.Id;
           
        });

        if(string.IsNullOrEmpty(matchid))
        {
            return BadRequest(new { message = "Sync failed" });
        }   
        return Ok(new { message = "Sync successful", matchId = matchid });
    }
}
