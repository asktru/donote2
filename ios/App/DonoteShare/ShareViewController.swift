import MobileCoreServices
import Social
import UIKit
import UniformTypeIdentifiers

/// The Donote ShareSheet extension. Deliberately offline: whatever is shared
/// (a web page, text, photos, files) is queued — with the optional comment
/// typed into the compose box — as JSON + payload files in the App Group
/// container. The main app drains the queue on its next launch/foreground
/// (see `ShareInboxPlugin` + `resources/js/lib/shareInbox.ts`), where the
/// normal auth, upload, and sync machinery lives. The extension never needs
/// credentials and a share always succeeds instantly, even with no network.
class ShareViewController: SLComposeServiceViewController {
    private static let appGroupId = "group.io.air.donote"
    private static let queueFolder = "ShareInbox"
    private static let teamsFile = "share-teams.json"
    private static let lastTeamKey = "donote-share-last-team"

    private struct Team {
        let slug: String
        let name: String
    }

    /** Team workspaces the app published for routing (see publishTeams). */
    private var teams: [Team] = []
    private var selectedTeamSlug = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        loadTeams()
    }

    override func presentationAnimationDidFinish() {
        super.presentationAnimationDidFinish()
        placeholder = "Add a comment (optional)…"
    }

    override func isContentValid() -> Bool {
        true
    }

    // MARK: - Team routing

    /// Read the team list the main app published into the shared container:
    /// `{ "current": slug, "teams": [{ "slug", "name" }] }`. Default to the
    /// last team shared to (if still valid), else the app's current team.
    private func loadTeams() {
        guard
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: Self.appGroupId
            ),
            let data = try? Data(contentsOf: container.appendingPathComponent(Self.teamsFile)),
            let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return
        }

        teams = ((parsed["teams"] as? [[String: String]]) ?? []).compactMap { entry in
            guard let slug = entry["slug"], let name = entry["name"] else {
                return nil
            }

            return Team(slug: slug, name: name)
        }

        let remembered = UserDefaults(suiteName: Self.appGroupId)?
            .string(forKey: Self.lastTeamKey)

        if let remembered, teams.contains(where: { $0.slug == remembered }) {
            selectedTeamSlug = remembered
        } else {
            selectedTeamSlug = parsed["current"] as? String ?? teams.first?.slug ?? ""
        }
    }

    private var selectedTeamName: String {
        teams.first(where: { $0.slug == selectedTeamSlug })?.name ?? ""
    }

    override func didSelectPost() {
        let comment = contentText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let providers = (extensionContext?.inputItems as? [NSExtensionItem])?
            .flatMap { $0.attachments ?? [] } ?? []
        let pageTitle = (extensionContext?.inputItems as? [NSExtensionItem])?
            .first?.attributedTitle?.string ?? ""

        let group = DispatchGroup()

        for provider in providers {
            group.enter()
            queue(provider: provider, comment: comment, fallbackTitle: pageTitle) {
                group.leave()
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    override func configurationItems() -> [Any]! {
        guard teams.count > 1, let item = SLComposeSheetConfigurationItem() else {
            return []
        }

        item.title = "Team"
        item.value = selectedTeamName
        item.tapHandler = { [weak self] in
            guard let self else {
                return
            }

            let picker = TeamPickerViewController(
                teams: self.teams.map { ($0.slug, $0.name) },
                selectedSlug: self.selectedTeamSlug
            ) { [weak self] slug in
                guard let self else {
                    return
                }

                self.selectedTeamSlug = slug
                UserDefaults(suiteName: Self.appGroupId)?
                    .set(slug, forKey: Self.lastTeamKey)
                item.value = self.selectedTeamName
                self.popConfigurationViewController()
            }

            self.pushConfigurationViewController(picker)
        }

        return [item]
    }

    // MARK: - Provider routing

    private func queue(
        provider: NSItemProvider,
        comment: String,
        fallbackTitle: String,
        done: @escaping () -> Void
    ) {
        // Safari runs GetPageInfo.js and hands its result as a property list —
        // the richest form (title + meta description). Checked first.
        if provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier) {
                [weak self] item, _ in
                let results =
                    (item as? NSDictionary)?[NSExtensionJavaScriptPreprocessingResultsKey]
                        as? NSDictionary
                self?.writeItem([
                    "kind": "url",
                    "url": results?["url"] as? String ?? "",
                    "title": results?["title"] as? String ?? fallbackTitle,
                    "description": results?["description"] as? String ?? "",
                    "comment": comment,
                ])
                done()
            }

            return
        }

        // Files app and document providers share file URLs — these conform to
        // public.url too, so they must be intercepted before the web-URL case.
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            copyFile(provider: provider, type: UTType.fileURL.identifier, comment: comment, done: done)

            return
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            copyFile(provider: provider, type: UTType.image.identifier, comment: comment, done: done)

            return
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            copyFile(provider: provider, type: UTType.movie.identifier, comment: comment, done: done)

            return
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] item, _ in
                self?.writeItem([
                    "kind": "url",
                    "url": (item as? URL)?.absoluteString ?? "",
                    "title": fallbackTitle,
                    "description": "",
                    "comment": comment,
                ])
                done()
            }

            return
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                self?.writeItem([
                    "kind": "text",
                    "title": fallbackTitle,
                    "description": item as? String ?? "",
                    "comment": comment,
                ])
                done()
            }

            return
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
            copyFile(provider: provider, type: UTType.data.identifier, comment: comment, done: done)

            return
        }

        done()
    }

    // MARK: - Payload persistence

    /// Copy a file-backed item into the queue folder. The temp URL Apple hands
    /// the completion handler is only valid inside it, so the copy is
    /// synchronous there.
    private func copyFile(
        provider: NSItemProvider,
        type: String,
        comment: String,
        done: @escaping () -> Void
    ) {
        let suggested = provider.suggestedName

        provider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, _ in
            guard let self, let url, let folder = Self.queueUrl() else {
                done()

                return
            }

            let id = UUID().uuidString
            let name = Self.safeName(suggested ?? url.lastPathComponent)
            let storedName = "\(id)-\(name)"

            do {
                try FileManager.default.copyItem(
                    at: url,
                    to: folder.appendingPathComponent(storedName)
                )
                self.writeItem(
                    [
                        "kind": "file",
                        "fileName": name,
                        "storedName": storedName,
                        "mimeType": Self.mimeType(for: name),
                        "comment": comment,
                    ],
                    id: id
                )
            } catch {
                // Copy failed (disk full, vanished temp) — drop this item.
            }

            done()
        }
    }

    /// Persist one queue entry as `<id>.json` in the shared container.
    private func writeItem(_ fields: [String: String], id: String = UUID().uuidString) {
        guard let folder = Self.queueUrl() else {
            return
        }

        var entry = fields
        entry["id"] = id
        entry["createdAt"] = ISO8601DateFormatter().string(from: Date())

        if !selectedTeamSlug.isEmpty {
            entry["teamSlug"] = selectedTeamSlug
        }

        if let data = try? JSONSerialization.data(withJSONObject: entry) {
            try? data.write(to: folder.appendingPathComponent("\(id).json"))
        }
    }

    private static func queueUrl() -> URL? {
        guard
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: appGroupId
            )
        else {
            return nil
        }

        let folder = container.appendingPathComponent(queueFolder, isDirectory: true)
        try? FileManager.default.createDirectory(
            at: folder,
            withIntermediateDirectories: true
        )

        return folder
    }

    private static func safeName(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "-")

        return cleaned.isEmpty ? "shared" : cleaned
    }

    private static func mimeType(for name: String) -> String {
        let ext = (name as NSString).pathExtension

        return UTType(filenameExtension: ext)?.preferredMIMEType
            ?? "application/octet-stream"
    }
}
