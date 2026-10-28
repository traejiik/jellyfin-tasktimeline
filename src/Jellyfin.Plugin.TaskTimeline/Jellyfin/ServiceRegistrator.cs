using Jellyfin.Plugin.TaskTimeline.Scheduling;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.TaskTimeline.Jellyfin;

public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<ITaskSnapshotReader, TaskSnapshotReader>();
        serviceCollection.AddSingleton<ForecastBuilder>();
    }
}
