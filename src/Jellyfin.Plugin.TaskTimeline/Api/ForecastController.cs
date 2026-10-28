using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.TaskTimeline.Jellyfin;
using Jellyfin.Plugin.TaskTimeline.Scheduling;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.TaskTimeline.Api;

[ApiController]
[Route("TaskTimeline")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class ForecastController(ITaskSnapshotReader reader, ForecastBuilder builder, ILogger<ForecastController> logger) : ControllerBase
{
    // Keep the plugin contract independent of host-wide PascalCase/null settings.
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    [HttpGet("Forecast")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(ForecastResponse), StatusCodes.Status200OK)]
    public ActionResult GetForecast(CancellationToken cancellationToken)
    {
        try
        {
            var now = DateTimeOffset.UtcNow;
            var snapshot = reader.Read(cancellationToken);
            var response = builder.Build(snapshot, now, TimeZoneInfo.Local, cancellationToken);
            return new JsonResult(response, JsonOptions);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unable to build the scheduled task forecast");
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Task forecast unavailable", detail: "Unable to read scheduled task data. Retry the request and check the server logs if the problem persists.");
        }
    }
}
