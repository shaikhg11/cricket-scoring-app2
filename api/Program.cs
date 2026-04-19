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

//Auto - apply migrations on startup
//using (var scope = app.Services.CreateScope())
//{
//    var dbCtx = scope.ServiceProvider.GetRequiredService<CricketDbContext>();
//    dbCtx.Database.Migrate();
//}

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
