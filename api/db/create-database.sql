-- ============================================================
-- Cricket Scoring Database - SQL Server creation script
-- Generated from CricketDbContext / EF Core model
-- ============================================================

-- Create database (run separately if needed)
-- CREATE DATABASE CricketScoring;
-- GO
-- USE CricketScoring;
-- GO

-- ============================================================
-- Table: Matches
-- ============================================================
CREATE TABLE [dbo].[Matches] (
    [Id]        NVARCHAR(50)  NOT NULL,
    [TeamA]     NVARCHAR(100) NOT NULL,
    [TeamB]     NVARCHAR(100) NOT NULL,
    [Overs]     INT           NOT NULL,
    [ApiUrl]    NVARCHAR(500) NULL,
    [Synced]    BIT           NOT NULL CONSTRAINT [DF_Matches_Synced]   DEFAULT (0),
    [CreatedAt] DATETIME2     NOT NULL CONSTRAINT [DF_Matches_CreatedAt] DEFAULT (GETUTCDATE()),
    [UpdatedAt] DATETIME2     NULL,

    CONSTRAINT [PK_Matches] PRIMARY KEY CLUSTERED ([Id])
);
GO

-- ============================================================
-- Table: Players
-- ============================================================
CREATE TABLE [dbo].[Players] (
    [Id]          INT           NOT NULL IDENTITY(1,1),
    [MatchId]     NVARCHAR(50)  NOT NULL,
    [Team]        NVARCHAR(1)   NOT NULL,   -- 'A' or 'B'
    [PlayerIndex] INT           NOT NULL,   -- zero-based index within team roster
    [Name]        NVARCHAR(100) NOT NULL,

    CONSTRAINT [PK_Players] PRIMARY KEY CLUSTERED ([Id]),

    CONSTRAINT [FK_Players_Matches] FOREIGN KEY ([MatchId])
        REFERENCES [dbo].[Matches] ([Id])
        ON DELETE CASCADE,

    -- One entry per (match, team, index)
    CONSTRAINT [UQ_Players_Match_Team_Index]
        UNIQUE ([MatchId], [Team], [PlayerIndex])
);
GO

CREATE INDEX [IX_Players_MatchId] ON [dbo].[Players] ([MatchId]);
GO

-- ============================================================
-- Table: Deliveries
-- ============================================================
CREATE TABLE [dbo].[Deliveries] (
    [Id]             BIGINT        NOT NULL IDENTITY(1,1),
    [MatchId]        NVARCHAR(50)  NOT NULL,
    [Innings]        INT           NOT NULL,   -- 1 or 2
    [Over]           INT           NOT NULL,
    [Ball]           INT           NOT NULL,
    [Runs]           INT           NOT NULL,
    [Extra]          NVARCHAR(20)  NULL,       -- NULL | 'Wide' | 'No Ball' | 'Bye' | 'Leg Bye'
    [IsWicket]       BIT           NOT NULL CONSTRAINT [DF_Deliveries_IsWicket] DEFAULT (0),
    [FreeHit]        BIT           NOT NULL CONSTRAINT [DF_Deliveries_FreeHit]  DEFAULT (0),
    [BatterIdx]      INT           NOT NULL,   -- zero-based index into batting team players
    [BowlerIdx]      INT           NOT NULL,   -- zero-based index into bowling team players
    [DismissalType]  NVARCHAR(50)  NULL,       -- 'Bowled' | 'Caught' | 'Stumped' | 'Run Out' | 'Hit Wicket' | 'Retired'
    [FielderIdx]     INT           NULL,       -- index of fielder (catch / run-out)
    [BatsmanOutIdx]  INT           NULL,       -- actual batter dismissed (differs from BatterIdx on run-outs)
    [RecordedAt]     DATETIME2     NOT NULL CONSTRAINT [DF_Deliveries_RecordedAt] DEFAULT (GETUTCDATE()),

    CONSTRAINT [PK_Deliveries] PRIMARY KEY CLUSTERED ([Id]),

    CONSTRAINT [FK_Deliveries_Matches] FOREIGN KEY ([MatchId])
        REFERENCES [dbo].[Matches] ([Id])
        ON DELETE CASCADE
);
GO

CREATE INDEX [IX_Deliveries_MatchId]         ON [dbo].[Deliveries] ([MatchId]);
CREATE INDEX [IX_Deliveries_MatchId_Innings] ON [dbo].[Deliveries] ([MatchId], [Innings]);
GO
