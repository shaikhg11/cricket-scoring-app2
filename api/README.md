# Cricket Scoring API

ASP.NET Core 8 Web API backed by SQL Server via Entity Framework Core.
Stores match data from the **Howzat** cricket scoring app and exposes it for retrieval by any client.

---

## Endpointsa

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/sync` | Full sync from the mobile app (upsert match + deliveries) |
| `GET` | `/api/matches` | List all matches with innings summaries |
| `GET` | `/api/matches/{id}` | Match detail with player rosters |
| `GET` | `/api/matches/{id}/scorecard` | Full scorecard — batting stats, bowling stats, extras |
| `GET` | `/api/matches/{id}/deliveries` | Raw ball-by-ball delivery data |
| `DELETE` | `/api/matches/{id}` | Delete a match and all its data |

Swagger UI is available at `/swagger` in Development mode.

---

## Setup

### Prerequisites
- .NET 8 SDK
- SQL Server (local or Azure)

### 1. Configure the connection string

Edit `appsettings.json` (or use User Secrets / environment variables):

```json
"ConnectionStrings": {
  "DefaultConnection": "Server=localhost;Database=CricketScoringDb;Trusted_Connection=True;TrustServerCertificate=True;"
}
```

### 2. Apply database migrations

```bash
cd api
dotnet ef migrations add InitialCreate
dotnet ef database update
```

The app also auto-applies pending migrations on startup.

### 3. Run

```bash
dotnet run
# API is available at https://localhost:5001
```

---

## Connect the Howzat app

In the **Setup** tab of the Howzat app, set the **Sync API URL** to:

```
https://<your-server>/api/sync
```

Tapping the **Sync** button will POST the full match payload to this endpoint.

---

## Database Schema

```
Matches       (Id PK, TeamA, TeamB, Overs, ApiUrl, Synced, CreatedAt, UpdatedAt)
Players       (Id PK, MatchId FK, Team, PlayerIndex, Name)
Deliveries    (Id PK, MatchId FK, Innings, Over, Ball, Runs, Extra,
               IsWicket, FreeHit, BatterIdx, BowlerIdx,
               DismissalType, FielderIdx, BatsmanOutIdx, RecordedAt)
```

---

## Project Structure

```
api/
├── Controllers/
│   ├── MatchesController.cs   — GET /api/matches, scorecard, deliveries, DELETE
│   └── SyncController.cs      — POST /api/sync
├── Data/
│   └── CricketDbContext.cs    — EF DbContext + model configuration
├── DTOs/
│   └── MatchDtos.cs           — Request / response records
├── Models/
│   ├── Match.cs
│   ├── Player.cs
│   └── Delivery.cs
├── Services/
│   └── ScorecardService.cs    — Batting / bowling stat computation
├── Program.cs
├── appsettings.json
└── CricketScoringApi.csproj
```
