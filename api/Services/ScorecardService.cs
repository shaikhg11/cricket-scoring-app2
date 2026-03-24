using CricketScoringApi.DTOs;
using CricketScoringApi.Models;

namespace CricketScoringApi.Services;

/// <summary>
/// Computes batting / bowling stats from raw deliveries — mirrors the
/// computeInnings() logic in the React front-end.
/// </summary>
public static class ScorecardService
{
    public static InningsScorecardResponse Compute(
        int inningsNumber,
        List<Delivery> allDeliveries,
        List<string> battingTeam,
        List<string> bowlingTeam)
    {
        var dels = allDeliveries
            .Where(d => d.Innings == inningsNumber)
            .OrderBy(d => d.Over).ThenBy(d => d.Ball)
            .ToList();

        // ── Totals ────────────────────────────────────────────────
        int runs = 0, wickets = 0, legalBalls = 0;
        int wides = 0, noBalls = 0, byes = 0, legByes = 0;

        foreach (var d in dels)
        {
            bool isWide   = d.Extra == "Wide";
            bool isNoBall = d.Extra == "No Ball";
            bool isBye    = d.Extra == "Bye";
            bool isLegBye = d.Extra == "Leg Bye";
            bool isLegal  = !isWide && !isNoBall;

            runs += d.Runs + (isWide || isNoBall ? 1 : 0);
            if (isWide)   wides   += 1;
            if (isNoBall) noBalls += 1;
            if (isBye)    byes    += d.Runs;
            if (isLegBye) legByes += d.Runs;
            if (d.IsWicket) wickets++;
            if (isLegal) legalBalls++;
        }

        int completedOvers = legalBalls / 6;
        int remBalls       = legalBalls % 6;
        int extras         = wides + noBalls + byes + legByes;

        // ── Batting ───────────────────────────────────────────────
        var batterIndices = dels.Select(d => d.BatterIdx).Distinct().OrderBy(i => i);
        var batting = new List<BatterStats>();

        foreach (var idx in batterIndices)
        {
            var myDels = dels.Where(d => d.BatterIdx == idx).ToList();

            int bRuns  = myDels
                .Where(d => d.Extra != "Bye" && d.Extra != "Leg Bye" && d.Extra != "Wide")
                .Sum(d => d.Runs);
            int bBalls = myDels.Count(d => d.Extra != "Wide");
            int fours  = myDels.Count(d => d.Runs == 4 && d.Extra == null);
            int sixes  = myDels.Count(d => d.Runs == 6);
            string sr  = bBalls > 0 ? ((bRuns / (double)bBalls) * 100).ToString("F1") : "—";

            var wicketDel = dels.FirstOrDefault(d =>
                d.IsWicket &&
                (d.BatsmanOutIdx == idx || (d.BatsmanOutIdx == null && d.BatterIdx == idx)));

            string dismissal = "not out";
            if (wicketDel != null)
            {
                dismissal = wicketDel.DismissalType ?? "Out";
                if (wicketDel.FielderIdx.HasValue)
                {
                    var fielder = wicketDel.FielderIdx.Value < bowlingTeam.Count
                        ? bowlingTeam[wicketDel.FielderIdx.Value]
                        : $"P{wicketDel.FielderIdx.Value + 1}";
                    dismissal += $" ({fielder})";
                }
            }

            string name = idx < battingTeam.Count ? battingTeam[idx] : $"P{idx + 1}";
            batting.Add(new BatterStats(idx, name, bRuns, bBalls, fours, sixes, sr, dismissal));
        }

        // ── Bowling ───────────────────────────────────────────────
        var bowlerIndices = dels.Select(d => d.BowlerIdx).Distinct().OrderBy(i => i);
        var bowling = new List<BowlerStats>();

        foreach (var idx in bowlerIndices)
        {
            var myDels    = dels.Where(d => d.BowlerIdx == idx).ToList();
            var legalDels = myDels.Where(d => d.Extra != "Wide" && d.Extra != "No Ball").ToList();

            int totalLegal  = legalDels.Count;
            int bowlOvers   = totalLegal / 6;
            int bowlRemBalls= totalLegal % 6;

            int bowlRuns = myDels.Sum(d =>
                d.Runs + (d.Extra == "Wide" || d.Extra == "No Ball" ? 1 : 0));

            int bowlWickets = myDels.Count(d =>
                d.IsWicket && d.DismissalType != "Run Out");

            // Maidens: complete overs (6 legal balls) with 0 runs
            int maidens = 0;
            foreach (var ov in myDels.Select(d => d.Over).Distinct())
            {
                var ovDels  = myDels.Where(d => d.Over == ov).ToList();
                var ovLegal = ovDels.Count(d => d.Extra != "Wide" && d.Extra != "No Ball");
                if (ovLegal < 6) continue;
                int ovRuns = ovDels.Sum(d =>
                    d.Runs + (d.Extra == "Wide" || d.Extra == "No Ball" ? 1 : 0));
                if (ovRuns == 0) maidens++;
            }

            string eco = totalLegal > 0
                ? ((bowlRuns / (double)totalLegal) * 6).ToString("F2")
                : "—";

            string oversStr = bowlRemBalls > 0
                ? $"{bowlOvers}.{bowlRemBalls}"
                : bowlOvers.ToString();

            string name = idx < bowlingTeam.Count ? bowlingTeam[idx] : $"P{idx + 1}";
            bowling.Add(new BowlerStats(idx, name, oversStr, maidens, bowlRuns, bowlWickets, eco));
        }

        string oversPlayed = remBalls > 0
            ? $"{completedOvers}.{remBalls}"
            : completedOvers.ToString();

        return new InningsScorecardResponse(
            inningsNumber,
            battingTeam.Count > 0 ? "Team" : "Team",
            bowlingTeam.Count > 0 ? "Team" : "Team",
            runs, wickets, oversPlayed, extras,
            new ExtrasBreakdown(wides, noBalls, byes, legByes),
            batting, bowling
        );
    }

    public static (InningsSummary i1, InningsSummary i2) ComputeSummaries(
        List<Delivery> deliveries)
    {
        return (ComputeSummary(deliveries, 1), ComputeSummary(deliveries, 2));
    }

    private static InningsSummary ComputeSummary(List<Delivery> deliveries, int innings)
    {
        var dels = deliveries.Where(d => d.Innings == innings).ToList();
        int runs = 0, wickets = 0, legalBalls = 0, extras = 0;

        foreach (var d in dels)
        {
            bool isWide   = d.Extra == "Wide";
            bool isNoBall = d.Extra == "No Ball";
            bool isBye    = d.Extra == "Bye";
            bool isLegBye = d.Extra == "Leg Bye";

            runs += d.Runs + (isWide || isNoBall ? 1 : 0);
            if (isWide || isNoBall) extras += 1;
            if (isBye || isLegBye)  extras += d.Runs;
            if (d.IsWicket) wickets++;
            if (!isWide && !isNoBall) legalBalls++;
        }

        int ov  = legalBalls / 6;
        int rem = legalBalls % 6;
        string oversStr = rem > 0 ? $"{ov}.{rem}" : ov.ToString();

        return new InningsSummary(runs, wickets, oversStr, extras);
    }
}
