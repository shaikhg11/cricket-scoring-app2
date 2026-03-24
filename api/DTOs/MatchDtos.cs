namespace CricketScoringApi.DTOs;

// ── Requests ──────────────────────────────────────────────────────

public record SyncPayloadRequest(
    MatchRequest Match,
    List<DeliveryRequest> Deliveries
);

public record MatchRequest(
    string Id,
    string TeamA,
    string TeamB,
    int Overs,
    List<string> PlayersA,
    List<string> PlayersB,
    string? ApiUrl,
    bool Synced
);

public record DeliveryRequest(
    long Id,
    string MatchId,
    int Innings,
    int Over,
    int Ball,
    int Runs,
    string? Extra,
    bool IsWicket,
    bool FreeHit,
    int BatterIdx,
    int BowlerIdx,
    string? DismissalType,
    int? FielderIdx,
    int? BatsmanOutIdx
);

// ── Responses ─────────────────────────────────────────────────────

public record MatchSummaryResponse(
    string Id,
    string TeamA,
    string TeamB,
    int Overs,
    DateTime CreatedAt,
    InningsSummary Innings1,
    InningsSummary Innings2
);

public record InningsSummary(
    int Runs,
    int Wickets,
    string Overs,
    int Extras
);

public record MatchDetailResponse(
    string Id,
    string TeamA,
    string TeamB,
    int Overs,
    List<string> PlayersA,
    List<string> PlayersB,
    DateTime CreatedAt,
    InningsSummary Innings1,
    InningsSummary Innings2
);

public record DeliveryResponse(
    long Id,
    int Innings,
    int Over,
    int Ball,
    int Runs,
    string? Extra,
    bool IsWicket,
    bool FreeHit,
    int BatterIdx,
    int BowlerIdx,
    string? DismissalType,
    int? FielderIdx,
    int? BatsmanOutIdx
);

// ── Scorecard ─────────────────────────────────────────────────────

public record ScorecardResponse(
    string MatchId,
    string TeamA,
    string TeamB,
    int Overs,
    InningsScorecardResponse Innings1,
    InningsScorecardResponse Innings2
);

public record InningsScorecardResponse(
    int InningsNumber,
    string BattingTeam,
    string BowlingTeam,
    int Runs,
    int Wickets,
    string OversPlayed,
    int Extras,
    ExtrasBreakdown ExtrasBreakdown,
    List<BatterStats> Batting,
    List<BowlerStats> Bowling
);

public record ExtrasBreakdown(int Wides, int NoBalls, int Byes, int LegByes);

public record BatterStats(
    int PlayerIndex,
    string Name,
    int Runs,
    int Balls,
    int Fours,
    int Sixes,
    string StrikeRate,
    string Dismissal
);

public record BowlerStats(
    int PlayerIndex,
    string Name,
    string Overs,
    int Maidens,
    int Runs,
    int Wickets,
    string Economy
);
