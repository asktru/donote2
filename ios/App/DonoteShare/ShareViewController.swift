import MobileCoreServices
import UIKit
import UniformTypeIdentifiers

/// The Donote ShareSheet extension — a custom compose card (the stock
/// SLComposeServiceViewController renders as broken floating pills on modern
/// iOS): Cancel / Save header, inline editable note title, comment field,
/// and an inline team dropdown.
///
/// Deliberately offline: whatever is shared (a web page, text, photos,
/// files) is queued — with the title/comment/team chosen here — as JSON +
/// payload files in the App Group container. The main app drains the queue
/// on its next launch/foreground (see `ShareInboxPlugin` +
/// `resources/js/lib/shareInbox.ts`), where the normal auth, upload, and
/// sync machinery lives. The extension never needs credentials and a share
/// always succeeds instantly, even with no network.
class ShareViewController: UIViewController {
    private static let appGroupId = "group.io.air.donote"
    private static let queueFolder = "ShareInbox"
    private static let teamsFile = "share-teams.json"
    private static let lastTeamKey = "donote-share-last-team"

    private struct Team {
        let slug: String
        let name: String
    }

    private struct PageInfo {
        var url = ""
        var title = ""
        var description = ""
        var pageText = ""
    }

    private var teams: [Team] = []
    private var selectedTeamSlug = ""

    /** Shared web page, loaded up-front so the title field can prefill. */
    private var pageInfo: PageInfo?
    private var isUrlShare = false

    // MARK: - Views

    private let card = UIView()
    private let subtitleLabel = UILabel()
    private let titleField = UITextField()
    private let titleCaption = UILabel()
    private let commentView = UITextView()
    private let commentPlaceholder = UILabel()
    private let teamButton = UIButton(type: .system)
    private let teamCaption = UILabel()
    private let saveButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        loadTeams()
        buildCard()
        describeShare()
        peekPageInfo()
    }

    // MARK: - Layout

    private func buildCard() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        // Tap the dimmed backdrop (only — see the gesture delegate) to cancel.
        let dismissTap = UITapGestureRecognizer(target: self, action: #selector(cancel))
        dismissTap.delegate = self
        view.addGestureRecognizer(dismissTap)

        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 22
        card.layer.cornerCurve = .continuous
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let cancelButton = UIButton(type: .system)
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)

        let header = UILabel()
        header.text = "Save to Donote"
        header.font = .preferredFont(forTextStyle: .headline)
        header.textAlignment = .center

        var config = UIButton.Configuration.filled()
        config.title = "Save"
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(
            top: 7,
            leading: 18,
            bottom: 7,
            trailing: 18
        )
        saveButton.configuration = config
        saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)

        let headerRow = UIStackView(arrangedSubviews: [cancelButton, header, saveButton])
        headerRow.axis = .horizontal
        headerRow.alignment = .center
        headerRow.distribution = .equalCentering

        subtitleLabel.font = .preferredFont(forTextStyle: .footnote)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.lineBreakMode = .byTruncatingMiddle

        styleCaption(titleCaption, text: "Title")
        titleField.font = .preferredFont(forTextStyle: .body)
        titleField.backgroundColor = .tertiarySystemBackground
        titleField.layer.cornerRadius = 10
        titleField.layer.cornerCurve = .continuous
        titleField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        titleField.leftViewMode = .always
        titleField.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        titleField.rightViewMode = .always
        titleField.clearButtonMode = .whileEditing
        titleField.placeholder = "Note title"
        titleField.heightAnchor.constraint(equalToConstant: 42).isActive = true

        commentView.font = .preferredFont(forTextStyle: .body)
        commentView.backgroundColor = .tertiarySystemBackground
        commentView.layer.cornerRadius = 10
        commentView.layer.cornerCurve = .continuous
        commentView.textContainerInset = UIEdgeInsets(
            top: 10,
            left: 8,
            bottom: 10,
            right: 8
        )
        commentView.delegate = self
        commentView.heightAnchor.constraint(equalToConstant: 72).isActive = true

        commentPlaceholder.text = "Add a comment (optional)…"
        commentPlaceholder.font = .preferredFont(forTextStyle: .body)
        commentPlaceholder.textColor = .placeholderText
        commentPlaceholder.translatesAutoresizingMaskIntoConstraints = false
        commentView.addSubview(commentPlaceholder)
        NSLayoutConstraint.activate([
            commentPlaceholder.topAnchor.constraint(
                equalTo: commentView.topAnchor,
                constant: 10
            ),
            commentPlaceholder.leadingAnchor.constraint(
                equalTo: commentView.leadingAnchor,
                constant: 12
            ),
        ])

        styleCaption(teamCaption, text: "Team")
        var teamConfig = UIButton.Configuration.gray()
        teamConfig.cornerStyle = .medium
        teamConfig.contentInsets = NSDirectionalEdgeInsets(
            top: 10,
            leading: 12,
            bottom: 10,
            trailing: 12
        )
        teamConfig.image = UIImage(systemName: "chevron.up.chevron.down")
        teamConfig.imagePlacement = .trailing
        teamConfig.imagePadding = 8
        teamConfig.preferredSymbolConfigurationForImage =
            UIImage.SymbolConfiguration(textStyle: .caption1)
        teamButton.configuration = teamConfig
        teamButton.contentHorizontalAlignment = .leading
        teamButton.showsMenuAsPrimaryAction = true
        refreshTeamMenu()

        let stack = UIStackView(arrangedSubviews: [
            headerRow,
            subtitleLabel,
            titleCaption,
            titleField,
            commentView,
            teamCaption,
            teamButton,
        ])
        stack.axis = .vertical
        stack.spacing = 8
        stack.setCustomSpacing(10, after: headerRow)
        stack.setCustomSpacing(14, after: subtitleLabel)
        stack.setCustomSpacing(4, after: titleCaption)
        stack.setCustomSpacing(14, after: titleField)
        stack.setCustomSpacing(14, after: commentView)
        stack.setCustomSpacing(4, after: teamCaption)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        // Title rows appear only for URL/text shares; team row only when
        // there's a real choice to make.
        setTitleRowVisible(false)
        setTeamRowVisible(teams.count > 1)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            card.bottomAnchor.constraint(
                equalTo: view.keyboardLayoutGuide.topAnchor,
                constant: -10
            ),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])
    }

    private func styleCaption(_ label: UILabel, text: String) {
        label.text = text.uppercased()
        label.font = .preferredFont(forTextStyle: .caption2)
        label.textColor = .secondaryLabel
    }

    private func setTitleRowVisible(_ visible: Bool) {
        titleCaption.isHidden = !visible
        titleField.isHidden = !visible
    }

    private func setTeamRowVisible(_ visible: Bool) {
        teamCaption.isHidden = !visible
        teamButton.isHidden = !visible
    }

    /// One line under the header describing what's being saved.
    private func describeShare() {
        let providers = allProviders()

        if providers.contains(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier)
                || (!$0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
                    && $0.hasItemConformingToTypeIdentifier(UTType.url.identifier))
        }) {
            isUrlShare = true
            subtitleLabel.text = "Web page → note in Web Clips"
            setTitleRowVisible(true)

            return
        }

        let fileCount = providers.filter {
            $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
                || $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
                || $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
                || $0.hasItemConformingToTypeIdentifier(UTType.data.identifier)
        }.count

        if fileCount > 0 {
            subtitleLabel.text = fileCount == 1
                ? "1 attachment → today's daily note"
                : "\(fileCount) attachments → today's daily note"

            return
        }

        subtitleLabel.text = "Text → note in Web Clips"
        setTitleRowVisible(true)
    }

    // MARK: - Teams

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

    private func refreshTeamMenu() {
        let actions = teams.map { team in
            UIAction(
                title: team.name,
                state: team.slug == selectedTeamSlug ? .on : .off
            ) { [weak self] _ in
                guard let self else {
                    return
                }

                self.selectedTeamSlug = team.slug
                UserDefaults(suiteName: Self.appGroupId)?
                    .set(team.slug, forKey: Self.lastTeamKey)
                self.refreshTeamMenu()
            }
        }

        teamButton.menu = UIMenu(children: actions)
        teamButton.configuration?.title =
            teams.first(where: { $0.slug == selectedTeamSlug })?.name ?? "Team"
    }

    // MARK: - Page info (title prefill)

    private func allProviders() -> [NSItemProvider] {
        ((extensionContext?.inputItems as? [NSExtensionItem]) ?? [])
            .flatMap { $0.attachments ?? [] }
    }

    private var fallbackTitle: String {
        (extensionContext?.inputItems as? [NSExtensionItem])?
            .first?.attributedTitle?.string ?? ""
    }

    private func peekPageInfo() {
        let providers = allProviders()
        let fallback = fallbackTitle

        if let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier)
        }) {
            provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier) {
                [weak self] item, _ in
                let results =
                    (item as? NSDictionary)?[NSExtensionJavaScriptPreprocessingResultsKey]
                        as? NSDictionary
                let title = results?["title"] as? String ?? ""

                self?.setPageInfo(PageInfo(
                    url: results?["url"] as? String ?? "",
                    title: title.isEmpty ? fallback : title,
                    description: results?["description"] as? String ?? "",
                    pageText: results?["pageText"] as? String ?? ""
                ))
            }

            return
        }

        if let provider = providers.first(where: {
            !$0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
                && $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
        }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) {
                [weak self] item, _ in
                guard let url = item as? URL else {
                    return
                }

                self?.setPageInfo(PageInfo(
                    url: url.absoluteString,
                    title: fallback
                ))
            }
        }
    }

    private func setPageInfo(_ info: PageInfo) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }

            self.pageInfo = info

            if self.titleField.text?.isEmpty != false {
                self.titleField.text = info.title
            }

            if let host = URL(string: info.url)?.host {
                self.subtitleLabel.text = host.replacingOccurrences(
                    of: "www.",
                    with: ""
                ) + " → note in Web Clips"
            }
        }
    }

    private var noteTitle: String {
        let typed = titleField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        return typed.isEmpty ? (pageInfo?.title ?? "") : typed
    }

    // MARK: - Actions

    @objc private func cancel() {
        extensionContext?.cancelRequest(
            withError: NSError(domain: "io.air.donote.share", code: 0)
        )
    }

    @objc private func save() {
        saveButton.isEnabled = false

        let comment = commentView.text?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let group = DispatchGroup()

        for provider in allProviders() {
            group.enter()
            queue(provider: provider, comment: comment) {
                group.leave()
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    // MARK: - Provider routing

    private func queue(
        provider: NSItemProvider,
        comment: String,
        done: @escaping () -> Void
    ) {
        // Safari runs GetPageInfo.js and hands its result as a property list —
        // the richest form (title + meta description + page text). peekPageInfo
        // already loaded it to prefill the title field; reuse that cache.
        if provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier)
            || (!provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
                && provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)) {
            if let info = pageInfo {
                writeItem([
                    "kind": "url",
                    "url": info.url,
                    "title": noteTitle,
                    "description": info.description,
                    "pageText": info.pageText,
                    "comment": comment,
                ])
                done()

                return
            }

            // Save tapped before peekPageInfo resolved — load the bare URL so
            // the share is never dropped.
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                let fallback = fallbackTitle

                provider.loadItem(forTypeIdentifier: UTType.url.identifier) {
                    [weak self] item, _ in
                    self?.writeItem([
                        "kind": "url",
                        "url": (item as? URL)?.absoluteString ?? "",
                        "title": self?.noteTitle.isEmpty == false
                            ? (self?.noteTitle ?? fallback)
                            : fallback,
                        "description": "",
                        "comment": comment,
                    ])
                    done()
                }

                return
            }

            done()

            return
        }

        // Files app and document providers share file URLs — these conform to
        // public.url too, but the fileURL check above already excluded them.
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

        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                self?.writeItem([
                    "kind": "text",
                    "title": self?.noteTitle ?? "",
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

extension ShareViewController: UITextViewDelegate {
    func textViewDidChange(_ textView: UITextView) {
        commentPlaceholder.isHidden = !textView.text.isEmpty
    }
}

extension ShareViewController: UIGestureRecognizerDelegate {
    /// Only the dimmed backdrop dismisses — taps inside the card don't.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldReceive touch: UITouch
    ) -> Bool {
        touch.view === view
    }
}
