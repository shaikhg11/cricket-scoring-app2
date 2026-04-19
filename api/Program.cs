using CricketScoringApi.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ── Services ──────────────────────────────────────────────────────
builder.Services.AddDbContext<CricketDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        sql => sql.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(10),
            errorNumbersToAdd: null)));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new()
    {
        Title = "Cricket Scoring API",
        Version = "v1",
        Description = "REST API for saving and retrieving cricket match data from the Howzat app."
    });
    var xmlFile = $"{System.Reflection.Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    if (File.Exists(xmlPath)) c.IncludeXmlComments(xmlPath);
});

// CORS — allow the Howzat app origins
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? [];

builder.Services.AddCors(opts =>
    opts.AddDefaultPolicy(policy =>
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()));

// ── Pipeline ──────────────────────────────────────────────────────
var app = builder.Build();

// Add new columns if they don't exist (safe for existing DB)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CricketDbContext>();
    await db.Database.ExecuteSqlRawAsync(@"
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Matches' AND COLUMN_NAME='BattingFirst')
            ALTER TABLE [dbo].[Matches] ADD [BattingFirst] NVARCHAR(1) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Matches' AND COLUMN_NAME='TossWinner')
            ALTER TABLE [dbo].[Matches] ADD [TossWinner] NVARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Matches' AND COLUMN_NAME='Inn1BatterA')
            ALTER TABLE [dbo].[Matches] ADD [Inn1BatterA] INT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Matches' AND COLUMN_NAME='Inn1BatterB')
            ALTER TABLE [dbo].[Matches] ADD [Inn1BatterB] INT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Matches' AND COLUMN_NAME='Inn2BatterA')
            ALTER TABLE [dbo].[Matches] ADD [Inn2BatterA] INT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Matches' AND COLUMN_NAME='Inn2BatterB')
            ALTER TABLE [dbo].[Matches] ADD [Inn2BatterB] INT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Deliveries' AND COLUMN_NAME='NextBatterIdx')
            ALTER TABLE [dbo].[Deliveries] ADD [NextBatterIdx] INT NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Deliveries' AND COLUMN_NAME='BattersCrossed')
            ALTER TABLE [dbo].[Deliveries] ADD [BattersCrossed] BIT NULL;
    ");
}

//if (app.Environment.IsDevelopment())
//{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Cricket Scoring API v1"));
//}

// Redirect root to Swagger in development
app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();

app.MapGet("/db-ping", async (CricketDbContext db) =>
{
    try
    {
        var version = await db.Database.SqlQueryRaw<string>("SELECT @@VERSION AS Value").FirstAsync();
        return Results.Ok(new { connected = true, version });
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message, title: "DB connection failed");
    }
}).ExcludeFromDescription();

app.UseCors();
app.UseAuthorization();
app.MapControllers();

app.Run();
