import WidgetKit
import SwiftUI

// MARK: - Datenmodell

struct ServerConfig: Codable {
  let baseUrl: String
  let username: String
  let password: String
}

struct NoteItem: Codable, Identifiable {
  let id: Int
  let heading: String
  let updated: String?
}

struct NotesResponse: Codable {
  struct RawNote: Codable {
    let id: Int
    let heading: String
    let updated: String?
  }
  let notes: [RawNote]?
}

struct NoteEntry: TimelineEntry {
  let date: Date
  let notes: [NoteItem]
  let total: Int
  let error: String?
}

// MARK: - Server-Zugriff (identische Auth wie die App: Basic + X-User-ID)

enum NoteFetcher {
  static func loadConfig() -> ServerConfig? {
    guard
      let raw = UserDefaults(suiteName: "group.de.inthielligent.pozume")?.string(forKey: "pozume.server"),
      let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(ServerConfig.self, from: data)
  }

  static func fetchNotes(config: ServerConfig, limit: Int = 5, completion: @escaping ([NoteItem], Int, String?) -> Void) {
    guard let url = URL(string: "\(config.baseUrl)/api/v1/notes?limit=\(limit)") else {
      completion([], 0, "Ungültige Server-Adresse")
      return
    }
    var request = URLRequest(url: url, timeoutInterval: 12)
    let raw = "\(config.username):\(config.password)".data(using: .utf8)?.base64EncodedString() ?? ""
    request.setValue("Basic \(raw)", forHTTPHeaderField: "Authorization")
    request.setValue("1", forHTTPHeaderField: "X-User-ID")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
        completion([], 0, error.localizedDescription)
        return
      }
      guard let data = data, let decoded = try? JSONDecoder().decode(NotesResponse.self, from: data) else {
        completion([], 0, "Antwort nicht lesbar")
        return
      }
      let notes = (decoded.notes ?? []).map { NoteItem(id: $0.id, heading: $0.heading, updated: $0.updated) }
      completion(notes, decoded.notes?.count ?? notes.count, nil)
    }.resume()
  }
}

// MARK: - Timeline

struct NoteProvider: TimelineProvider {
  func placeholder(in context: Context) -> NoteEntry {
    NoteEntry(date: .now, notes: [], total: 0, error: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (NoteEntry) -> Void) {
    load { completion($0) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<NoteEntry>) -> Void) {
    load { entry in
      // Stündlich aktualisieren; WidgetKit darf das selbst strecken
      completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(3600))))
    }
  }

  private func load(completion: @escaping (NoteEntry) -> Void) {
    guard let config = NoteFetcher.loadConfig() else {
      completion(NoteEntry(date: .now, notes: [], total: 0, error: "In der Pozume-App anmelden"))
      return
    }
    NoteFetcher.fetchNotes(config: config) { notes, total, error in
      completion(NoteEntry(date: .now, notes: notes, total: total, error: error))
    }
  }
}

// MARK: - Ansicht

struct PozumeWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: NoteEntry

  var body: some View {
    content
      .widgetURL(URL(string: "pozume://home"))
  }

  @ViewBuilder
  private var content: some View {
    if let error = entry.error {
      VStack(alignment: .leading, spacing: 6) {
        Text("🪶 Pozume").font(.headline)
        Text(error).font(.caption).foregroundStyle(.secondary)
        Spacer()
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .padding(12)
    } else if entry.notes.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        Text("🪶 Pozume").font(.headline)
        Text("Keine Notizen").font(.caption).foregroundStyle(.secondary)
        Spacer()
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .padding(12)
    } else {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("🪶 Pozume").font(.headline)
          Spacer()
          Text("\(entry.total)").font(.caption).foregroundStyle(.secondary)
        }
        ForEach(entry.notes.prefix(family == .systemSmall ? 3 : 5)) { note in
          HStack(spacing: 6) {
            Circle().fill(Color.accentColor).frame(width: 5, height: 5)
            Text(note.heading)
              .font(.caption)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .padding(12)
    }
  }
}

struct PozumeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "PozumeWidget", provider: NoteProvider()) { entry in
      PozumeWidgetView(entry: entry)
    }
    .configurationDisplayName("Pozume")
    .description("Deine neuesten Notizen auf einen Blick.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

@main
struct PozumeWidgetBundle: WidgetBundle {
  var body: some Widget {
    PozumeWidget()
  }
}
