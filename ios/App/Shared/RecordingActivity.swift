import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// The recording Live Activity's data. `startedAt` is all the UI needs —
/// the lock-screen timer counts on its own via Text(timerInterval:), so the
/// activity never has to be updated while recording runs.
@available(iOS 16.1, *)
struct RecordingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var startedAt: Date
    }
}
#endif

#if canImport(AppIntents) && canImport(ActivityKit)
import AppIntents

/// The Live Activity's Stop button. LiveActivityIntents run inside the app's
/// process, so a NotificationCenter post reaches AudioRecorderPlugin, which
/// finalizes the recording exactly like an in-app stop.
@available(iOS 17.0, *)
struct StopRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop recording"
    static var isDiscoverable = false

    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(
            name: Notification.Name("donote.stopRecording"),
            object: nil
        )

        // End the card here too: if the recording's process died earlier
        // (jetsam mid-recording), the plugin has nothing to stop, but the
        // stale card must still dismiss.
        for activity in Activity<RecordingActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        return .result()
    }
}
#endif
