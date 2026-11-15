import WidgetKit
import SwiftUI
import Security

/**
 * Home-Screen-Widget für Pozume.
 *
 * Zeigt die neuesten Notizen des PozNote-Servers an (Small: 3, Medium: 5)
 * plus die Gesamtzahl der Notizen. Die Zugangsdaten stammen aus der App Group
 * (group.de.inthielligent.pozume, von der Haupt-App beim Login geschrieben):
 * baseUrl + Benutzername aus dem UserDefaults der Gruppe, das Passwort aus
 * der verschlüsselten gemeinsamen Keychain. Das Widget redet also direkt
 * mit dem Server, ohne die App öffnen zu müssen.
 *
 * Auth: identisch zur App (Basic Auth + X-User-ID-Header).
 */

// MARK: - Datenmodell

/** Server-Adresse und Benutzername aus der App Group (unkritisch, JSON). */
struct ServerConfig: Codable {
  let baseUrl: String
  let username: String
}

/**
 * Zugriff auf das Server-Passwort in der gemeinsamen Keychain.
 * Die Access-Group ("TEAMID.de.inthielligent.pozume") hat die Haupt-App
 * aufgelöst und in der App Group hinterlegt (Schlüssel "pozume.keychainGroup");
 * im Simulator fallback ohne Team-Präfix.
 */
enum KeychainStore {
  private static let keychainService = "pozume.server"
  private static let keychainAccount = "password"
  private static let fallbackGroup = "de.inthielligent.pozume"

  /** Von der Haupt-App aufgelöste Access-Group aus der App Group lesen. */
  private static var accessGroup: String {
    UserDefaults(suiteName: "group.de.inthielligent.pozume")?.string(forKey: "pozume.keychainGroup") ?? fallbackGroup
  }

  /** Liest das Passwort aus der Keychain; nil, wenn keins gespeichert ist. */
  static func readPassword() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data,
          let password = String(data: data, encoding: .utf8) else {
      return nil
    }
    return password
  }
}

/** Eine Notiz für die Anzeige im Widget (nur die Felder, die das Widget braucht). */
struct NoteItem: Codable, Identifiable {
  let id: Int
  let heading: String
  let updated: String?
}

/** Roh-Antwort von GET /api/v1/notes — Notizen liegen unter dem Schlüssel "notes". */
struct NotesResponse: Codable {
  struct RawNote: Codable {
    let id: Int
    let heading: String
    let updated: String?
  }
  let notes: [RawNote]?
}

/** Ein Zeitpunkt der Widget-Timeline: Notizenliste, Gesamtzahl oder Fehlermeldung. */
struct NoteEntry: TimelineEntry {
  let date: Date
  let notes: [NoteItem]
  let total: Int
  let error: String?
}

// MARK: - Server-Zugriff (identische Auth wie die App: Basic + X-User-ID)

/** Lädt Notizen vom PozNote-Server; alle Zugriffe laufen über URLSession. */
enum NoteFetcher {

  /** Server-Adresse + Benutzername aus der App Group lesen; nil, wenn noch nicht angemeldet. */
  static func loadConfig() -> ServerConfig? {
    guard
      let raw = UserDefaults(suiteName: "group.de.inthielligent.pozume")?.string(forKey: "pozume.server"),
      let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(ServerConfig.self, from: data)
  }

  /**
   * Ruft die neuesten Notizen ab (GET /api/v1/notes?limit=N).
   * Das Passwort kommt aus der gemeinsamen Keychain.
   * completion: (Notizen, Gesamtzahl, Fehlermeldung?)
   */
  static func fetchNotes(config: ServerConfig, password: String, limit: Int = 5, completion: @escaping ([NoteItem], Int, String?) -> Void) {
    guard let url = URL(string: "\(config.baseUrl)/api/v1/notes?limit=\(limit)") else {
      completion([], 0, "Ungültige Server-Adresse")
      return
    }
    var request = URLRequest(url: url, timeoutInterval: 12)
    // Basic Auth: Benutzername aus der App Group, Passwort aus der Keychain
    let raw = "\(config.username):\(password)".data(using: .utf8)?.base64EncodedString() ?? ""
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

/** Versorgt WidgetKit mit Einträgen: Snapshot, echte Timeline und Platzhalter. */
struct NoteProvider: TimelineProvider {

  /** Platzhalter, den WidgetKit während des Ladevorgangs zeigt. */
  func placeholder(in context: Context) -> NoteEntry {
    NoteEntry(date: .now, notes: [], total: 0, error: nil)
  }

  /** Sofortiger Snapshot für die Widget-Galerie/Vorschau. */
  func getSnapshot(in context: Context, completion: @escaping (NoteEntry) -> Void) {
    load { completion($0) }
  }

  /** Timeline: ein Eintrag jetzt, nächste Aktualisierung in einer Stunde. */
  func getTimeline(in context: Context, completion: @escaping (Timeline<NoteEntry>) -> Void) {
    load { entry in
      // Stündlich aktualisieren; WidgetKit darf das selbst strecken
      completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(3600))))
    }
  }

  /** Gemeinsames Laden: Config + Passwort prüfen, dann Notizen holen. */
  private func load(completion: @escaping (NoteEntry) -> Void) {
    guard let config = NoteFetcher.loadConfig(),
          let password = KeychainStore.readPassword() else {
      completion(NoteEntry(date: .now, notes: [], total: 0, error: "In der Pozume-App anmelden"))
      return
    }
    NoteFetcher.fetchNotes(config: config, password: password) { notes, total, error in
      completion(NoteEntry(date: .now, notes: notes, total: total, error: error))
    }
  }
}

// MARK: - Ansicht

/** Die Widget-Oberfläche: Kopfzeile, Notizenliste oder Fehler-/Leerzustand. */
struct PozumeWidgetView: View {
  /** Widget-Größe (small/medium) — steuert, wie viele Notizen angezeigt werden. */
  @Environment(\.widgetFamily) private var family
  let entry: NoteEntry

  var body: some View {
    content
      // Tap auf das Widget öffnet die App (Deep-Link aus Info.plist der App)
      .widgetURL(URL(string: "pozume://home"))
  }

  /** Drei Zustände: Fehler (z.B. nicht angemeldet), keine Notizen, Notizliste. */
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
        // Kopfzeile: App-Name links, Gesamtzahl der Notizen rechts
        HStack {
          Text("🪶 Pozume").font(.headline)
          Spacer()
          Text("\(entry.total)").font(.caption).foregroundStyle(.secondary)
        }
        // Notizen: Small zeigt 3, Medium zeigt 5 Einträge
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

/** Widget-Registrierung: Typ, Provider, Anzeigename und unterstützte Größen. */
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

/** Einstiegspunkt der Widget-Extension — hier registriert sich das Widget bei WidgetKit. */
@main
struct PozumeWidgetBundle: WidgetBundle {
  var body: some Widget {
    PozumeWidget()
  }
}
