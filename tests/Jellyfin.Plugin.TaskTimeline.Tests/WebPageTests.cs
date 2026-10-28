using System.Runtime.CompilerServices;
using MediaBrowser.Model.Plugins;
using Xunit;

namespace Jellyfin.Plugin.TaskTimeline.Tests;

public class WebPageTests
{
    [Fact]
    public void NormalPluginExposesTimelineAndSelfContainedModuleResources()
    {
        Assert.True(typeof(IHasWebPages).IsAssignableFrom(typeof(Plugin)));
        // Page metadata has no dependency on plugin configuration or paths.
        var pages = ((IHasWebPages)RuntimeHelpers.GetUninitializedObject(typeof(Plugin))).GetPages().ToArray();
        foreach (var name in new[] { "taskTimeline", "taskTimelineJs", "taskTimelineModelJs", "taskTimelineTaskUpdatesJs" })
        {
            var page = Assert.Single(pages, p => p.Name == name);
            Assert.Contains(page.EmbeddedResourcePath, typeof(Plugin).Assembly.GetManifestResourceNames());
        }
        Assert.DoesNotContain(pages, p => p.Name.Contains("Diagnostics", StringComparison.Ordinal));
    }
}
