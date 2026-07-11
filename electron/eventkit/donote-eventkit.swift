import EventKit
import Foundation

/// Minimal EventKit CLI for the Donote desktop shell.
///
/// Commands (all print JSON to stdout):
///   status                 -> {"status":"notDetermined|authorized|denied|restricted|writeOnly"}
///   request                -> {"granted":true|false}   (blocks on the system prompt)
///   calendars              -> [{id,title,color,source}]
///   events <fromISO> <toISO> -> [{id,seriesId,calendarId,calendarTitle,title,start,end,allDay,location,isRecurring}]

struct CalendarInfo: Codable {
    let id: String
    let title: String
    let color: String?
    let source: String
}

struct EventInfo: Codable {
    let id: String
    let seriesId: String
    let calendarId: String
    let calendarTitle: String
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let location: String?
    let isRecurring: Bool
}

func emit<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]

    guard let data = try? encoder.encode(value),
          let json = String(data: data, encoding: .utf8)
    else {
        FileHandle.standardError.write("encoding failed\n".data(using: .utf8)!)
        exit(1)
    }

    print(json)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

func statusString() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .writeOnly: return "writeOnly"
    case .fullAccess, .authorized: return "authorized"
    @unknown default: return "unknown"
    }
}

func hexColor(_ calendar: EKCalendar) -> String? {
    guard let cgColor = calendar.cgColor,
          let converted = cgColor.converted(
              to: CGColorSpace(name: CGColorSpace.sRGB)!,
              intent: .defaultIntent,
              options: nil
          ),
          let components = converted.components,
          components.count >= 3
    else {
        return nil
    }

    let r = Int((components[0] * 255).rounded())
    let g = Int((components[1] * 255).rounded())
    let b = Int((components[2] * 255).rounded())

    return String(format: "#%02x%02x%02x", r, g, b)
}

func parseDate(_ raw: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    if let date = fractional.date(from: raw) {
        return date
    }

    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]

    return plain.date(from: raw)
}

let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime]

let store = EKEventStore()
let arguments = CommandLine.arguments

guard arguments.count >= 2 else {
    fail("usage: donote-eventkit status|request|calendars|events <from> <to>")
}

switch arguments[1] {
case "status":
    emit(["status": statusString()])

case "request":
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false

    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { ok, _ in
            granted = ok
            semaphore.signal()
        }
    } else {
        store.requestAccess(to: .event) { ok, _ in
            granted = ok
            semaphore.signal()
        }
    }

    semaphore.wait()
    emit(["granted": granted])

case "calendars":
    let calendars = store.calendars(for: .event).map { calendar in
        CalendarInfo(
            id: calendar.calendarIdentifier,
            title: calendar.title,
            color: hexColor(calendar),
            source: calendar.source?.title ?? ""
        )
    }

    emit(calendars.sorted { ($0.source, $0.title) < ($1.source, $1.title) })

case "events":
    guard arguments.count >= 4,
          let from = parseDate(arguments[2]),
          let to = parseDate(arguments[3])
    else {
        fail("usage: donote-eventkit events <fromISO> <toISO>")
    }

    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let events = store.events(matching: predicate).map { event in
        let seriesId = event.eventIdentifier ?? UUID().uuidString

        return EventInfo(
            id: "\(seriesId)@\(Int(event.startDate.timeIntervalSince1970))",
            seriesId: seriesId,
            calendarId: event.calendar?.calendarIdentifier ?? "",
            calendarTitle: event.calendar?.title ?? "",
            title: event.title ?? "(no title)",
            start: iso.string(from: event.startDate),
            end: iso.string(from: event.endDate),
            allDay: event.isAllDay,
            location: event.location?.isEmpty == false ? event.location : nil,
            isRecurring: event.hasRecurrenceRules || event.isDetached
        )
    }

    emit(events.sorted { $0.start < $1.start })

default:
    fail("unknown command: \(arguments[1])")
}
