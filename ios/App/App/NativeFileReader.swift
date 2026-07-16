import Capacitor
import Foundation

/// Chunked base64 file reads over the plugin bridge. The iOS shell loads the
/// remote web app, so Capacitor's convertFileSrc/local-scheme file serving is
/// unavailable — container files (recording segments, shared payloads) reach
/// JS through this instead.
enum NativeFileReader {
    /// Same file, same string: on iOS /var is a symlink to /private/var, and
    /// APIs disagree about which spelling they return (directory enumeration
    /// says /private/var, FileManager.urls says /var). Resolve before any
    /// prefix comparison or the containment check fails for real files.
    static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().path
    }

    static func isInside(_ path: String, dir: URL) -> Bool {
        canonical(path).hasPrefix(canonical(dir.path))
    }

    /// Handle a readFile({ path, offset?, length? }) call, restricted to
    /// files inside `allowedDir`. Resolves { base64, size }.
    static func handle(_ call: CAPPluginCall, allowedDir: URL?) {
        guard
            let path = call.getString("path"),
            let dir = allowedDir,
            isInside(path, dir: dir),
            let handle = FileHandle(forReadingAtPath: path)
        else {
            call.reject("File is not readable.")

            return
        }

        defer {
            handle.closeFile()
        }

        let attributes = try? FileManager.default.attributesOfItem(atPath: path)
        let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
        let offset = call.getInt("offset") ?? 0
        let length = call.getInt("length") ?? size

        handle.seek(toFileOffset: UInt64(max(0, offset)))
        let data = handle.readData(ofLength: max(0, length))

        call.resolve([
            "base64": data.base64EncodedString(),
            "size": size,
        ])
    }
}
