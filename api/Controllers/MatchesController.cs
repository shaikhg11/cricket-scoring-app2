using CricketScoringApi.Data;
using CricketScoringApi.DTOs;
using CricketScoringApi.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CricketScoringApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class MatchesController(CricketDbContext db) : ControllerBase
{
    /// <summary>Returns a summary list of all matches (newest first).</summary>
    [HttpGet]
    [ProducesResponseType<List<MatchSummaryResponse>>(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAll()
    {
        var matches = await db.Matches
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new
            {
                m.Id, m.TeamA, m.TeamB, m.Overs, m.CreatedAt,
                Deliveries = m.Deliveries.ToList()
            })
            .ToListAsync();

        var result = matches.Select(m =>
        {
            var (i1, i2) = ScorecardService.ComputeSummaries(m.Deliveries);
            return new MatchSummaryResponse(m.Id, m.TeamA, m.TeamB, m.Overs, m.CreatedAt, i1, i2);
        });

        return Ok(result);
    }

    /// <summary>Returns full match detail including player rosters and innings summaries.</summary>
    [HttpGet("{id}")]
    [ProducesResponseType<MatchDetailResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(string id)
    {
        var match = await db.Matches
            .Include(m => m.Players.OrderBy(p => p.PlayerIndex))
            .Include(m => m.Deliveries)
            .FirstOrDefaultAsync(m => m.Id == id);

        if (match == null) return NotFound();

        var playersA = match.Players
            .Where(p => p.Team == "A")
            .OrderBy(p => p.PlayerIndex)
            .Select(p => p.Name)
            .ToList();

        var playersB = match.Players
            .Where(p => p.Team == "B")
            .OrderBy(p => p.PlayerIndex)
            .Select(p => p.Name)
            .ToList();

        var (i1, i2) = ScorecardService.ComputeSummaries(match.Deliveries.ToList());

        return Ok(new MatchDetailResponse(
            match.Id, match.TeamA, match.TeamB, match.Overs,
            playersA, playersB, match.CreatedAt, i1, i2,
            match.BattingFirst, match.TossWinner,
            match.Inn1BatterA, match.Inn1BatterB,
            match.Inn2BatterA, match.Inn2BatterB));
    }

    /// <summary>Returns the full scorecard with batting and bowling stats for both innings.</summary>
    [HttpGet("{id}/scorecard")]
    [ProducesResponseType<ScorecardResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetScorecard(string id)
    {
        var match = await db.Matches
            .Include(m => m.Players.OrderBy(p => p.PlayerIndex))
            .Include(m => m.Deliveries)
            .FirstOrDefaultAsync(m => m.Id == id);

        if (match == null) return NotFound();

        var playersA = match.Players
            .Where(p => p.Team == "A").OrderBy(p => p.PlayerIndex)
            .Select(p => p.Name).ToList();

        var playersB = match.Players
            .Where(p => p.Team == "B").OrderBy(p => p.PlayerIndex)
            .Select(p => p.Name).ToList();

        var dels = match.Deliveries.ToList();

        // Innings 1: Team A bats, Team B bowls
        var inn1 = ScorecardService.Compute(1, dels, playersA, playersB);
        inn1 = inn1 with { BattingTeam = match.TeamA, BowlingTeam = match.TeamB };

        // Innings 2: Team B bats, Team A bowls
        var inn2 = ScorecardService.Compute(2, dels, playersB, playersA);
        inn2 = inn2 with { BattingTeam = match.TeamB, BowlingTeam = match.TeamA };

        return Ok(new ScorecardResponse(
            match.Id, match.TeamA, match.TeamB, match.Overs, inn1, inn2));
    }

    /// <summary>Returns all raw deliveries for a match.</summary>
    [HttpGet("{id}/deliveries")]
    [ProducesResponseType<List<DeliveryResponse>>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetDeliveries(string id)
    {
        var exists = await db.Matches.AnyAsync(m => m.Id == id);
        if (!exists) return NotFound();

        var deliveries = await db.Deliveries
            .Where(d => d.MatchId == id)
            .OrderBy(d => d.Innings).ThenBy(d => d.Over).ThenBy(d => d.Ball)
            .Select(d => new DeliveryResponse(
                d.Id, d.Innings, d.Over, d.Ball, d.Runs,
                d.Extra, d.IsWicket, d.FreeHit,
                d.BatterIdx, d.BowlerIdx,
                d.DismissalType, d.FielderIdx, d.BatsmanOutIdx, d.NextBatterIdx, d.BattersCrossed))
            .ToListAsync();

        return Ok(deliveries);
    }

    /// <summary>Deletes a match and all its associated data.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(string id)
    {
        var match = await db.Matches.FindAsync(id);
        if (match == null) return NotFound();

        db.Matches.Remove(match);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
