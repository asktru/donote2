import ActivityKit
import SwiftUI
import WidgetKit

/// The recording card: lock-screen banner + Dynamic Island presence while a
/// voice memo records in the background. The elapsed timer counts natively
/// (Text(timerInterval:)) so the activity needs no updates; the Stop button
/// posts back into the app's AudioRecorderPlugin via StopRecordingIntent.
struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            LockScreenRecordingView(startedAt: context.state.startedAt)
                .padding(14)
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        PulsingDot()
                        Text("Recording")
                            .font(.headline)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ElapsedTimer(startedAt: context.state.startedAt)
                        .font(.headline.monospacedDigit())
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    StopButton()
                }
            } compactLeading: {
                Image(systemName: "mic.fill")
                    .foregroundStyle(.red)
            } compactTrailing: {
                ElapsedTimer(startedAt: context.state.startedAt)
                    .font(.caption2.monospacedDigit())
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "mic.fill")
                    .foregroundStyle(.red)
            }
        }
    }
}

private struct LockScreenRecordingView: View {
    let startedAt: Date

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.red.opacity(0.2))
                    .frame(width: 40, height: 40)
                Image(systemName: "mic.fill")
                    .foregroundStyle(.red)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Donote")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Recording…")
                    .font(.headline)
            }

            Spacer()

            ElapsedTimer(startedAt: startedAt)
                .font(.title3.monospacedDigit())

            StopButton()
        }
    }
}

/// Counts up from the recording start without any activity updates. The
/// upper bound just needs to be far away; 24 h outlives any real memo.
private struct ElapsedTimer: View {
    let startedAt: Date

    var body: some View {
        Text(
            timerInterval: startedAt...startedAt.addingTimeInterval(24 * 3600),
            countsDown: false
        )
        .multilineTextAlignment(.trailing)
    }
}

private struct StopButton: View {
    var body: some View {
        if #available(iOS 17.0, *) {
            Button(intent: StopRecordingIntent()) {
                Label("Stop", systemImage: "stop.fill")
                    .font(.subheadline.bold())
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
        }
    }
}

private struct PulsingDot: View {
    var body: some View {
        Circle()
            .fill(Color.red)
            .frame(width: 8, height: 8)
    }
}
