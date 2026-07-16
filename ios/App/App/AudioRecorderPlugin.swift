import AVFoundation
import Capacitor
import Foundation

/// Native voice-memo capture for iOS. WKWebView's getUserMedia is suspended
/// the moment the app backgrounds, so on iOS the web recorder is replaced by
/// AVAudioRecorder + the `audio` background mode: recording keeps running
/// with the screen locked or another app in front.
///
/// Segments rotate on a timer (~90 s of 32 kbps mono AAC ≈ 360 KB) so every
/// upload stays well under server body limits, and a crash loses at most the
/// segment in flight — mirroring the web recorder's size-based rotation.
/// Finished segment files are emitted to JS, which folds them into the same
/// offline memo queue the web recorder uses (see stores/memos.ts).
///
/// While recording, a Live Activity shows a lock-screen/Dynamic Island card
/// with a running timer and (iOS 17+) a Stop button, which posts
/// `donote.stopRecording` back into this plugin.
///
/// JS name: `AudioRecorder` (see `resources/js/lib/nativeRecorder.ts`).
///   start()            -> { groupId, startedAt }
///   stop()             -> { parts, durationSec }   (also emits "stopped")
///   discard()          -> {}
///   isRecording()      -> { recording, startedAt? }
///   pendingSegments()  -> { items: [{ path, groupId, part, sizeBytes, createdAt }] }
///   removeSegment({ path }) -> {}
///
/// Events:
///   "segment" { path, groupId, part, mimeType, durationSec, last }
///   "stopped" { groupId, parts, durationSec }
@objc(AudioRecorderPlugin)
public class AudioRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioRecorderPlugin"
    public let jsName = "AudioRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingSegments", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeSegment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
    ]

    private static let segmentSeconds: TimeInterval = 90

    private var recorder: AVAudioRecorder?
    private var groupId = ""
    private var part = 0
    private var startedAt = Date()
    private var segmentStartedAt = Date()
    private var rotationTimer: Timer?
    private var observersInstalled = false

    // MARK: - Controls

    @objc func start(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async { [weak self] in
                guard let self else {
                    return
                }

                guard granted else {
                    call.reject("Microphone access was denied.")

                    return
                }

                guard self.recorder == nil else {
                    call.reject("Already recording.")

                    return
                }

                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(
                        .playAndRecord,
                        mode: .default,
                        options: [.allowBluetooth, .defaultToSpeaker]
                    )
                    try session.setActive(true)
                } catch {
                    call.reject("Could not start the audio session: \(error.localizedDescription)")

                    return
                }

                self.groupId = UUID().uuidString
                self.part = 0
                self.startedAt = Date()
                self.installObservers()

                do {
                    try self.startSegment()
                } catch {
                    call.reject("Could not start recording: \(error.localizedDescription)")

                    return
                }

                self.startLiveActivity(startedAt: self.startedAt)
                call.resolve([
                    "groupId": self.groupId,
                    "startedAt": self.startedAt.timeIntervalSince1970 * 1000,
                ])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }

            guard self.recorder != nil else {
                call.resolve(["parts": 0, "durationSec": 0])

                return
            }

            let summary = self.finishRecording()
            call.resolve(summary)
        }
    }

    @objc func discard(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }

            self.rotationTimer?.invalidate()
            self.rotationTimer = nil
            self.recorder?.stop()
            self.recorder = nil
            self.deactivateSession()
            self.endLiveActivity()

            if !self.groupId.isEmpty, let dir = Self.segmentsDir() {
                let files = (try? FileManager.default.contentsOfDirectory(
                    at: dir,
                    includingPropertiesForKeys: nil
                )) ?? []

                for file in files
                where file.lastPathComponent.hasPrefix("rec-\(self.groupId)-") {
                    try? FileManager.default.removeItem(at: file)
                }
            }

            self.groupId = ""
            call.resolve()
        }
    }

    @objc func isRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }

            if self.recorder != nil {
                call.resolve([
                    "recording": true,
                    "startedAt": self.startedAt.timeIntervalSince1970 * 1000,
                    "groupId": self.groupId,
                ])
            } else {
                call.resolve(["recording": false])
            }
        }
    }

    /// Segment files a previous run left behind (app killed mid-recording).
    @objc func pendingSegments(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let dir = Self.segmentsDir() else {
                call.resolve(["items": []])

                return
            }

            let files = (try? FileManager.default.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.fileSizeKey, .creationDateKey]
            )) ?? []

            var items: [[String: Any]] = []

            for file in files where file.pathExtension == "m4a" {
                // rec-<groupId>-<part>.m4a — skip the group being recorded now.
                let stem = file.deletingPathExtension().lastPathComponent
                let pieces = stem.split(separator: "-")

                guard pieces.count >= 3, pieces.first == "rec" else {
                    continue
                }

                let filePart = Int(pieces.last ?? "") ?? 0
                let fileGroup = pieces.dropFirst().dropLast().joined(separator: "-")

                if self.recorder != nil, fileGroup == self.groupId {
                    continue
                }

                let attrs = try? file.resourceValues(
                    forKeys: [.fileSizeKey, .creationDateKey]
                )

                items.append([
                    "path": file.path,
                    "groupId": fileGroup,
                    "part": filePart,
                    "sizeBytes": attrs?.fileSize ?? 0,
                    "createdAt": ISO8601DateFormatter().string(
                        from: attrs?.creationDate ?? Date()
                    ),
                ])
            }

            call.resolve(["items": items])
        }
    }

    /// Chunked base64 read of a segment file — the remote-loading shell has
    /// no convertFileSrc file serving (see NativeFileReader).
    @objc func readFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            NativeFileReader.handle(call, allowedDir: Self.segmentsDir())
        }
    }

    @objc func removeSegment(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard
                let path = call.getString("path"),
                let dir = Self.segmentsDir(),
                path.hasPrefix(dir.path)
            else {
                call.resolve()

                return
            }

            try? FileManager.default.removeItem(atPath: path)
            call.resolve()
        }
    }

    // MARK: - Recording internals (main queue)

    private func startSegment() throws {
        guard let dir = Self.segmentsDir() else {
            throw NSError(domain: "donote.recorder", code: 1)
        }

        let url = dir.appendingPathComponent("rec-\(groupId)-\(part).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32000,
        ]

        let newRecorder = try AVAudioRecorder(url: url, settings: settings)
        newRecorder.record()
        recorder = newRecorder
        segmentStartedAt = Date()

        rotationTimer?.invalidate()
        rotationTimer = Timer.scheduledTimer(
            withTimeInterval: Self.segmentSeconds,
            repeats: false
        ) { [weak self] _ in
            self?.rotate()
        }
    }

    private func rotate() {
        guard recorder != nil else {
            return
        }

        finishSegment(last: false)

        part += 1

        do {
            try startSegment()
        } catch {
            // Could not open the next segment — end the recording with what
            // was captured rather than silently losing audio.
            _ = finishRecording()
        }
    }

    /// Stop the current AVAudioRecorder and emit its finished file to JS.
    private func finishSegment(last: Bool) {
        guard let current = recorder else {
            return
        }

        let url = current.url
        current.stop()
        recorder = nil

        notifyListeners("segment", data: [
            "path": url.path,
            "groupId": groupId,
            "part": part,
            "mimeType": "audio/mp4",
            "durationSec": Int(Date().timeIntervalSince(segmentStartedAt).rounded()),
            "last": last,
        ])
    }

    /// Finalize everything (called by stop(), the Live Activity intent, and
    /// unrecoverable interruptions) and tell JS the recording is complete.
    @discardableResult
    private func finishRecording() -> [String: Any] {
        rotationTimer?.invalidate()
        rotationTimer = nil

        finishSegment(last: true)
        deactivateSession()
        endLiveActivity()

        let summary: [String: Any] = [
            "groupId": groupId,
            "parts": part + 1,
            "durationSec": Int(Date().timeIntervalSince(startedAt).rounded()),
        ]

        notifyListeners("stopped", data: summary)
        groupId = ""
        part = 0

        return summary
    }

    private func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: .notifyOthersOnDeactivation
        )
    }

    // MARK: - Observers (stop intent + interruptions)

    private func installObservers() {
        guard !observersInstalled else {
            return
        }

        observersInstalled = true

        // The Live Activity's Stop button (LiveActivityIntent runs in-process).
        NotificationCenter.default.addObserver(
            forName: Notification.Name("donote.stopRecording"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.recorder != nil else {
                return
            }

            self.finishRecording()
        }

        // Phone calls, Siri, other apps grabbing the session: close the
        // current segment (audio captured so far is safe), then resume into
        // a new segment when the system says the interruption ended.
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard
                let self,
                let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                let type = AVAudioSession.InterruptionType(rawValue: raw)
            else {
                return
            }

            switch type {
            case .began:
                if self.recorder != nil {
                    self.finishSegment(last: false)
                    self.part += 1
                }
            case .ended:
                let optionsRaw =
                    notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)

                if !self.groupId.isEmpty, self.recorder == nil,
                   options.contains(.shouldResume) {
                    try? AVAudioSession.sharedInstance().setActive(true)
                    try? self.startSegment()
                } else if !self.groupId.isEmpty, self.recorder == nil {
                    // No resume permitted — end the recording cleanly.
                    self.finishRecording()
                }
            @unknown default:
                break
            }
        }
    }

    // MARK: - Live Activity

    private func startLiveActivity(startedAt: Date) {
        guard #available(iOS 16.2, *) else {
            return
        }

        let state = RecordingActivityAttributes.ContentState(startedAt: startedAt)

        _ = try? Activity.request(
            attributes: RecordingActivityAttributes(),
            content: .init(state: state, staleDate: nil)
        )
    }

    private func endLiveActivity() {
        guard #available(iOS 16.2, *) else {
            return
        }

        Task {
            for activity in Activity<RecordingActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    // MARK: - Storage

    private static func segmentsDir() -> URL? {
        guard
            let base = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first
        else {
            return nil
        }

        let dir = base.appendingPathComponent("Recordings", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: dir,
            withIntermediateDirectories: true
        )

        return dir
    }
}

#if canImport(ActivityKit)
import ActivityKit
#endif
