using Jellyfin.Plugin.TaskTimeline.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.TaskTimeline;

public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
    }

    public override string Name => "Task Timeline";

    public override Guid Id => Guid.Parse("ac82f485-7bb4-472f-b122-248e1772eca6");

    public override string Description => "Visualise scheduled tasks on a timeline";
    public IEnumerable<PluginPageInfo> GetPages()
    {
        yield return new PluginPageInfo
        {
            Name = "taskTimeline",
            DisplayName = "Task Timeline",
            EmbeddedResourcePath = "Jellyfin.Plugin.TaskTimeline.Web.timeline.html",
            EnableInMainMenu = true,
            MenuSection = "server",
            MenuIcon = "schedule"
        };
        foreach (var (name, file) in new[] { ("taskTimelineJs", "timeline.js"), ("taskTimelineModelJs", "timeline-model.js"), ("taskTimelineTaskUpdatesJs", "task-updates.js") })
        {
            yield return new PluginPageInfo { Name = name, EmbeddedResourcePath = $"Jellyfin.Plugin.TaskTimeline.Web.{file}" };
        }
#if TASKTIMELINE_DIAGNOSTICS
        yield return new PluginPageInfo
        {
            Name = "taskTimelineDiagnostics",
            DisplayName = "Task Timeline diagnostics",
            EmbeddedResourcePath = "Jellyfin.Plugin.TaskTimeline.Web.Diagnostics.diagnostics.html",
            EnableInMainMenu = true,
            MenuSection = "server",
            MenuIcon = "schedule"
        };
        yield return new PluginPageInfo
        {
            Name = "taskTimelineDiagnosticsJs",
            EmbeddedResourcePath = "Jellyfin.Plugin.TaskTimeline.Web.Diagnostics.diagnostics.js"
        };
#endif
    }
}
