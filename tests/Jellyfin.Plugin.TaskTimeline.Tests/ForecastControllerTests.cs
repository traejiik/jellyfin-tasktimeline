using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Jellyfin.Plugin.TaskTimeline.Api;
using Jellyfin.Plugin.TaskTimeline.Jellyfin;
using Jellyfin.Plugin.TaskTimeline.Scheduling;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Jellyfin.Plugin.TaskTimeline.Tests;

public class ForecastControllerTests
{
    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData("user", HttpStatusCode.Forbidden)]
    [InlineData("admin", HttpStatusCode.OK)]
    public async Task EnforcesAdministratorPolicyThroughHttp(string? identity, HttpStatusCode status)
    {
        var reader = new Reader();
        using var server = await Server(reader);
        using var client = server.GetTestClient();
        if (identity is not null) client.DefaultRequestHeaders.Add("Test-Identity", identity);
        using var response = await client.GetAsync("/TaskTimeline/Forecast");
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(identity == "admin" ? 1 : 0, reader.Reads);
        if (identity != "admin") return;
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;
        Assert.Equal(TimeSpan.FromHours(168), root.GetProperty("rangeEnd").GetDateTime() - root.GetProperty("rangeStart").GetDateTime());
        Assert.EndsWith("Z", root.GetProperty("generatedAt").GetString());
        var task = root.GetProperty("tasks")[0];
        Assert.Equal(JsonValueKind.Null, task.GetProperty("progressPercentage").ValueKind);
        Assert.Equal(JsonValueKind.Null, task.GetProperty("lastExecution").ValueKind);
        Assert.Equal("timingUnknown", root.GetProperty("triggers")[0].GetProperty("projectionStatus").GetString());
    }

    [Fact]
    public async Task IntegrationFailureIsNotAnEmptySuccessfulForecast()
    {
        using var server = await Server(new Reader { Fail = true });
        using var client = server.GetTestClient();
        client.DefaultRequestHeaders.Add("Test-Identity", "admin");
        using var response = await client.GetAsync("/TaskTimeline/Forecast");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.DoesNotContain("private test detail", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task RequestCancellationReachesTheSnapshotReader()
    {
        var reader = new Reader { WaitForCancellation = true };
        using var server = await Server(reader);
        using var client = server.GetTestClient();
        client.DefaultRequestHeaders.Add("Test-Identity", "admin");
        using var cancellation = new CancellationTokenSource();
        var request = client.GetAsync("/TaskTimeline/Forecast", cancellation.Token);
        await reader.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => request);
        await reader.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    private static async Task<IHost> Server(Reader reader) => await Host.CreateDefaultBuilder()
        .ConfigureWebHost(web => web.UseTestServer()
        .ConfigureServices(services =>
        {
            services.AddLogging();
            services.AddAuthentication("test").AddScheme<AuthenticationSchemeOptions, TestAuthentication>("test", _ => { });
            services.AddAuthorization(options => options.AddPolicy(Policies.RequiresElevation, policy => policy.RequireAuthenticatedUser().RequireRole("Administrator")));
            services.AddSingleton<ITaskSnapshotReader>(reader);
            services.AddSingleton<ForecastBuilder>();
            services.AddControllers().AddApplicationPart(typeof(ForecastController).Assembly);
        })
        .Configure(app =>
        {
            app.UseRouting();
            app.UseAuthentication();
            app.UseAuthorization();
            app.UseEndpoints(endpoints => endpoints.MapControllers());
        })).StartAsync();

    private sealed class Reader : ITaskSnapshotReader
    {
        public int Reads { get; private set; }
        public bool Fail { get; init; }
        public bool WaitForCancellation { get; init; }
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Cancelled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public IReadOnlyList<TaskInput> Read(CancellationToken cancellationToken)
        {
            Reads++;
            Entered.TrySetResult();
            if (WaitForCancellation)
            {
                cancellationToken.WaitHandle.WaitOne(TimeSpan.FromSeconds(10));
                if (cancellationToken.IsCancellationRequested) Cancelled.TrySetResult();
                cancellationToken.ThrowIfCancellationRequested();
            }
            if (Fail) throw new InvalidOperationException("private test detail");
            return [ForecastBuilderTests.Task("a", new TriggerInput("IntervalTrigger", IntervalTicks: TimeSpan.TicksPerHour))];
        }
    }

    private sealed class TestAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var name = Request.Headers["Test-Identity"].ToString();
            if (name.Length == 0) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.Name, name) };
            if (name == "admin") claims.Add(new(ClaimTypes.Role, "Administrator"));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name)), Scheme.Name)));
        }
    }
}
