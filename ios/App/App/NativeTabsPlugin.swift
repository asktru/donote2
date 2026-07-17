import Capacitor
import Foundation
import UIKit

/// Bridge between the native tab bar (DonoteTabBarController) and the web
/// app. Tabs and FAB actions flow to JS as events; the web app reports its
/// own navigation back via setActive so the bar highlights correctly.
///
/// JS name: `NativeTabs` (see `resources/js/lib/nativeTabs.ts`).
///   setActive({ id })  -> {}          (journal|reminders|tasks|calendar)
///   height()           -> { height }  (px the bar covers at the bottom)
///
/// Events:
///   "tab"    { id }   — user tapped a tab
///   "action" { id }   — user picked a FAB menu action
@objc(NativeTabsPlugin)
public class NativeTabsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeTabsPlugin"
    public let jsName = "NativeTabs"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setActive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "height", returnType: CAPPluginReturnPromise),
    ]

    public override func load() {
        NotificationCenter.default.addObserver(
            forName: Notification.Name("donote.tabSelected"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let id = notification.userInfo?["id"] as? String else {
                return
            }

            self?.notifyListeners("tab", data: ["id": id])
        }

        NotificationCenter.default.addObserver(
            forName: Notification.Name("donote.fabAction"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let id = notification.userInfo?["id"] as? String else {
                return
            }

            self?.notifyListeners("action", data: ["id": id])
        }
    }

    @objc func setActive(_ call: CAPPluginCall) {
        guard
            let id = call.getString("id"),
            DonoteTabBarController.tabIds.contains(id)
        else {
            call.resolve()

            return
        }

        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: Notification.Name("donote.setActiveTab"),
                object: nil,
                userInfo: ["id": id]
            )
            call.resolve()
        }
    }

    /// How many points of the window bottom the bar covers — the web app
    /// pads its layout by this so content never hides underneath.
    @objc func height(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard
                let tabs = self?.bridge?.viewController?.tabBarController
            else {
                call.resolve(["height": 0])

                return
            }

            let bar = tabs.tabBar
            let covered = tabs.view.bounds.maxY - bar.frame.minY

            call.resolve(["height": max(0, covered)])
        }
    }
}
