using Jellyfin.Plugin.TaskTimeline.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.TaskTimeline;

public sealed class Plugin : BasePlugin<PluginConfiguration>
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
    }

    public override string Name => "Task Timeline";

    public override Guid Id => Guid.Parse("ac82f485-7bb4-472f-b122-248e1772eca6");

    public override string Description => "Visualise scheduled tasks on a timeline";
}
