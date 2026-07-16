import Capacitor
import UIKit

/// The app's Capacitor bridge controller. Overriding `capacitorDidLoad`
/// explicitly registers our app-local plugins — a Swift `CAPBridgedPlugin`
/// in the app target is not auto-discovered the way packaged plugins are.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleCalendarPlugin())
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(AudioRecorderPlugin())
    }
}
