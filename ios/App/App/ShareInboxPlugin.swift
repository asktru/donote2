import Capacitor
import Foundation

/// Reads the queue the Donote share extension writes into the App Group
/// container. The web app drains it on launch/foreground: URL/text items
/// become Inbox notes, file items are uploaded and linked from the daily
/// note (see `resources/js/lib/shareInbox.ts`).
///
/// JS name: `ShareInbox`.
///   list()           -> { items: [{ id, kind, createdAt, title?, url?,
///                                   description?, comment?, fileName?,
///                                   mimeType?, filePath? }] }
///   remove({ id })   -> {}    (deletes the JSON entry + its payload file)
@objc(ShareInboxPlugin)
public class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareInboxPlugin"
    public let jsName = "ShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
    ]

    private static let appGroupId = "group.io.air.donote"
    private static let queueFolder = "ShareInbox"

    @objc func list(_ call: CAPPluginCall) {
        guard let folder = Self.queueUrl() else {
            call.resolve(["items": []])

            return
        }

        let entries = (try? FileManager.default.contentsOfDirectory(
            at: folder,
            includingPropertiesForKeys: nil
        )) ?? []

        var items: [[String: String]] = []

        for entry in entries where entry.pathExtension == "json" {
            guard
                let data = try? Data(contentsOf: entry),
                let parsed = try? JSONSerialization.jsonObject(with: data),
                var item = parsed as? [String: String]
            else {
                continue
            }

            if let storedName = item["storedName"] {
                item["filePath"] = folder.appendingPathComponent(storedName).path
            }

            items.append(item)
        }

        // Oldest first, so a multi-item share lands in the order it was sent.
        items.sort { ($0["createdAt"] ?? "") < ($1["createdAt"] ?? "") }

        call.resolve(["items": items])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard
            let id = call.getString("id"),
            !id.isEmpty,
            !id.contains("/"),
            let folder = Self.queueUrl()
        else {
            call.resolve()

            return
        }

        let json = folder.appendingPathComponent("\(id).json")

        if
            let data = try? Data(contentsOf: json),
            let parsed = try? JSONSerialization.jsonObject(with: data),
            let item = parsed as? [String: String],
            let storedName = item["storedName"],
            !storedName.contains("/")
        {
            try? FileManager.default.removeItem(
                at: folder.appendingPathComponent(storedName)
            )
        }

        try? FileManager.default.removeItem(at: json)
        call.resolve()
    }

    private static func queueUrl() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent(queueFolder, isDirectory: true)
    }
}
