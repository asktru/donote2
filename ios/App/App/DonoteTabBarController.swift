import UIKit

/// The iOS shell's root: a real UITabBarController (which is what gets the
/// system's full tab-bar treatment — liquid glass on iOS 26, translucent
/// material before) around the single Capacitor web view. Tabs don't own
/// separate screens: the web view is reparented into whichever tab is
/// selected and the selection is bridged to the web app as navigation
/// (NativeTabsPlugin), so the SPA keeps all its state across switches.
///
/// A floating "+" button above the bar shows a native menu whose actions
/// depend on the active tab (meet-with/timeblock on Calendar, note/recording/
/// attach/AI elsewhere); actions are forwarded to the web layer the same way.
class DonoteTabBarController: UITabBarController, UITabBarControllerDelegate {
    static let tabIds = ["journal", "reminders", "tasks", "calendar"]

    private let bridge: UIViewController
    private let fab = UIButton(type: .system)
    private var suppressEvent = false

    init(bridge: UIViewController) {
        self.bridge = bridge
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self

        let tabs: [(String, String)] = [
            ("Journal", "book.closed"),
            ("Reminders", "bell"),
            ("Tasks", "checklist"),
            ("Calendar", "calendar"),
        ]

        viewControllers = tabs.enumerated().map { index, tab in
            let container = UIViewController()
            container.view.backgroundColor = .systemBackground
            container.tabBarItem = UITabBarItem(
                title: tab.0,
                image: UIImage(systemName: tab.1),
                tag: index
            )

            return container
        }

        embedBridge(in: viewControllers![0])
        setupFab()
        updateFabMenu()

        // The web app reports its own navigation so the bar stays in sync
        // (e.g. jumping to Calendar through an in-app link).
        NotificationCenter.default.addObserver(
            forName: Notification.Name("donote.setActiveTab"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard
                let self,
                let id = notification.userInfo?["id"] as? String,
                let index = Self.tabIds.firstIndex(of: id),
                index != self.selectedIndex,
                let target = self.viewControllers?[index]
            else {
                return
            }

            // Programmatic selection doesn't call the delegate — embed and
            // refresh the menu ourselves, without echoing back to JS.
            self.suppressEvent = true
            self.selectedIndex = index
            self.embedBridge(in: target)
            self.updateFabMenu()
            self.suppressEvent = false
        }
    }

    // MARK: - Tab selection

    func tabBarController(
        _ tabBarController: UITabBarController,
        didSelect viewController: UIViewController
    ) {
        embedBridge(in: viewController)
        updateFabMenu()

        if !suppressEvent {
            NotificationCenter.default.post(
                name: Notification.Name("donote.tabSelected"),
                object: nil,
                userInfo: ["id": Self.tabIds[viewController.tabBarItem.tag]]
            )
        }
    }

    /// Move the (single) web view into the selected tab's container. The
    /// web view instance survives, so the SPA never reloads on tab switches.
    private func embedBridge(in container: UIViewController) {
        guard bridge.parent !== container else {
            return
        }

        if bridge.parent != nil {
            bridge.willMove(toParent: nil)
            bridge.view.removeFromSuperview()
            bridge.removeFromParent()
        }

        container.addChild(bridge)
        bridge.view.frame = container.view.bounds
        bridge.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.view.addSubview(bridge.view)
        bridge.didMove(toParent: container)
    }

    // MARK: - Contextual FAB

    private func setupFab() {
        var config: UIButton.Configuration

        if #available(iOS 26.0, *) {
            config = .prominentGlass()
        } else {
            config = .filled()
        }

        config.image = UIImage(
            systemName: "plus",
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 22,
                weight: .medium
            )
        )
        config.cornerStyle = .capsule

        fab.configuration = config
        fab.showsMenuAsPrimaryAction = true
        fab.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(fab)

        NSLayoutConstraint.activate([
            fab.widthAnchor.constraint(equalToConstant: 56),
            fab.heightAnchor.constraint(equalToConstant: 56),
            fab.trailingAnchor.constraint(
                equalTo: view.trailingAnchor,
                constant: -20
            ),
            fab.bottomAnchor.constraint(equalTo: tabBar.topAnchor, constant: -16),
        ])
    }

    private func updateFabMenu() {
        let onCalendar = Self.tabIds[selectedIndex] == "calendar"

        let actions: [(String, String, String)] = onCalendar
            ? [
                ("Meet with…", "person.2", "meet-with"),
                ("New timeblock", "calendar.badge.plus", "timeblock"),
            ]
            : [
                ("New note", "square.and.pencil", "new-note"),
                ("New recording", "mic", "record"),
                ("Attach file", "paperclip", "attach"),
                ("AI prompt", "sparkles", "ai-prompt"),
            ]

        fab.menu = UIMenu(children: actions.map { title, icon, id in
            UIAction(title: title, image: UIImage(systemName: icon)) { _ in
                NotificationCenter.default.post(
                    name: Notification.Name("donote.fabAction"),
                    object: nil,
                    userInfo: ["id": id]
                )
            }
        })
    }
}
