import Capacitor
import EventKit
import Foundation

/// Reads the device's calendars via EventKit and exposes them to the web
/// app, mirroring the four operations of the Electron `donote-eventkit`
/// helper so the frontend (`EventsList.vue`) can treat macOS and iOS as one
/// "Apple Calendar" source.
///
/// JS name: `AppleCalendar` (see `resources/js/lib/appleCalendar.ts`).
///   status()               -> { status: "notDetermined|authorized|denied|restricted|writeOnly|unknown" }
///   requestAccess()        -> { granted: Bool }   (prompts the user)
///   calendars()            -> { calendars: [{ id, title, color, source }] }
///   events({ from, to })   -> { events: [{ id, seriesId, calendarId, calendarTitle,
///                                          title, start, end, allDay, location, isRecurring }] }
@objc(AppleCalendarPlugin)
public class AppleCalendarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleCalendarPlugin"
    public let jsName = "AppleCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "calendars", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "events", returnType: CAPPluginReturnPromise),
    ]

    private let store = EKEventStore()

    private lazy var iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]

        return formatter
    }()

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["status": AppleCalendarPlugin.statusString()])
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        let completion: (Bool, Error?) -> Void = { granted, _ in
            call.resolve(["granted": granted])
        }

        if #available(iOS 17.0, *) {
            store.requestFullAccessToEvents(completion: completion)
        } else {
            store.requestAccess(to: .event, completion: completion)
        }
    }

    @objc func calendars(_ call: CAPPluginCall) {
        let calendars = store.calendars(for: .event)
            .map { calendar -> [String: Any] in
                [
                    "id": calendar.calendarIdentifier,
                    "title": calendar.title,
                    "color": AppleCalendarPlugin.hexColor(calendar) as Any,
                    "source": calendar.source?.title ?? "",
                ]
            }
            .sorted { lhs, rhs in
                let leftKey = ((lhs["source"] as? String) ?? "", (lhs["title"] as? String) ?? "")
                let rightKey = ((rhs["source"] as? String) ?? "", (rhs["title"] as? String) ?? "")

                return leftKey < rightKey
            }

        call.resolve(["calendars": calendars])
    }

    @objc func events(_ call: CAPPluginCall) {
        guard let fromRaw = call.getString("from"),
              let toRaw = call.getString("to"),
              let from = AppleCalendarPlugin.parseDate(fromRaw),
              let to = AppleCalendarPlugin.parseDate(toRaw)
        else {
            call.reject("events requires ISO 'from' and 'to' dates")

            return
        }

        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
        let events = store.events(matching: predicate)
            .map { event -> [String: Any] in
                let seriesId = event.eventIdentifier ?? UUID().uuidString
                let location = (event.location?.isEmpty == false) ? event.location : nil

                return [
                    "id": "\(seriesId)@\(Int(event.startDate.timeIntervalSince1970))",
                    "seriesId": seriesId,
                    "calendarId": event.calendar?.calendarIdentifier ?? "",
                    "calendarTitle": event.calendar?.title ?? "",
                    "title": event.title ?? "(no title)",
                    "start": iso.string(from: event.startDate),
                    "end": iso.string(from: event.endDate),
                    "allDay": event.isAllDay,
                    "location": location as Any,
                    "isRecurring": event.hasRecurrenceRules || event.isDetached,
                ]
            }
            .sorted { lhs, rhs in
                ((lhs["start"] as? String) ?? "") < ((rhs["start"] as? String) ?? "")
            }

        call.resolve(["events": events])
    }

    private static func statusString() -> String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .writeOnly: return "writeOnly"
        case .fullAccess, .authorized: return "authorized"
        @unknown default: return "unknown"
        }
    }

    private static func hexColor(_ calendar: EKCalendar) -> String? {
        guard let cgColor = calendar.cgColor,
              let sRGB = CGColorSpace(name: CGColorSpace.sRGB),
              let converted = cgColor.converted(to: sRGB, intent: .defaultIntent, options: nil),
              let components = converted.components,
              components.count >= 3
        else {
            return nil
        }

        let red = Int((components[0] * 255).rounded())
        let green = Int((components[1] * 255).rounded())
        let blue = Int((components[2] * 255).rounded())

        return String(format: "#%02x%02x%02x", red, green, blue)
    }

    private static func parseDate(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        if let date = fractional.date(from: raw) {
            return date
        }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]

        return plain.date(from: raw)
    }
}
