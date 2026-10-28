#if TASKTIMELINE_DIAGNOSTICS
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.TaskTimeline.Diagnostics;

// These manual-only tasks are omitted entirely from normal plugin builds.
public abstract class DiagnosticTask : IScheduledTask
{
    public abstract string Name { get; }

    public abstract string Key { get; }

    public string Description => "Test-only task that waits without accessing media or changing server settings.";

    public string Category => "Task Timeline diagnostics";

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => [];

    public abstract Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken);
}

public sealed class ProgressDiagnosticTask : DiagnosticTask
{
    public override string Name => "Task Timeline diagnostic — reported progress";

    public override string Key => "TaskTimeline.Diagnostics.Progress";

    public override async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        for (var percentage = 0; percentage <= 100; percentage += 25)
        {
            cancellationToken.ThrowIfCancellationRequested();
            progress.Report(percentage);
            await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken).ConfigureAwait(false);
        }
    }
}

public sealed class IndeterminateDiagnosticTask : DiagnosticTask
{
    public override string Name => "Task Timeline diagnostic — no percentage";

    public override string Key => "TaskTimeline.Diagnostics.Indeterminate";

    public override Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
        => Task.Delay(TimeSpan.FromSeconds(12), cancellationToken);
}
#endif
