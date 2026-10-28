using Jellyfin.Plugin.TaskTimeline.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
#if TASKTIMELINE_DIAGNOSTICS
using MediaBrowser.Model.Plugins;
#endif

namespace Jellyfin.Plugin.TaskTimeline;

public sealed class Plugin : BasePlugin<PluginConfiguration>
#if TASKTIMELINE_DIAGNOSTICS
    , IHasWebPages
#endif
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
    }

    public override string Name => "Task Timeline";

    public override Guid Id => Guid.Parse("ac82f485-7bb4-472f-b122-248e1772eca6");

    public override string Description => "Visualise scheduled tasks on a timeline";
#if TASKTIMELINE_DIAGNOSTICS
    public IEnumerable<PluginPageInfo> GetPages()
    {
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
    }
#endif
}
