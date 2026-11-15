import UIKit
import UniformTypeIdentifiers

/**
 * Share-Extension: empfängt eine URL oder Text aus dem Teilen-Menü
 * (z.B. Safari) und legt sie als neue Notiz auf dem PozNote-Server ab.
 * Die Zugangsdaten kommen aus der App Group (von der Haupt-App geschrieben).
 */
class ShareViewController: UIViewController {

  // UI-Elemente
  private let statusLabel = UILabel()      // Rückmeldung: speichert / Fehler / Erfolg
  private let previewLabel = UILabel()    // Vorschau des geteilten Inhalts
  private let saveButton = UIButton(type: .system)

  // Geteilte Inhalte (aus dem Extension-Context extrahiert)
  private var sharedText: String = ""
  private var sharedUrl: String = ""
  private var sharedTitle: String = ""

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    loadSharedItem()
    buildUi()
  }

  // MARK: - Geteilte Inhalte extrahieren

  /**
   * Liest die geteilten Elemente aus dem Extension-Context.
   * Safari liefert URLs teils als UTType.url, teils als Property-List
   * (mit Titel), Text-Apps als PlainText — alle drei Varianten werden
   * der Reihe nach probiert.
   */
  private func loadSharedItem() {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    for item in items {
      guard let providers = item.attachments else { continue }
      for provider in providers {
        // Variante 1: direkte URL (z.B. aus Fotos, Bookmark-Apps)
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
            if let url = data as? URL {
              self.sharedUrl = url.absoluteString
              self.sharedTitle = item.attributedTitle?.string ?? ""
              DispatchQueue.main.async { self.updatePreview() }
            }
          }
        }
        // Variante 2: einfacher Text (z.B. aus Notiz-Apps, Copy-Paste)
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
            if let text = data as? String {
              self.sharedText = text
              if self.sharedTitle.isEmpty { self.sharedTitle = item.attributedTitle?.string ?? "" }
              DispatchQueue.main.async { self.updatePreview() }
            }
          }
        }
        // Variante 3: Safari liefert die URL als Property-List (kompakter Titel + URL)
        if provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) {
          provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier, options: nil) { data, _ in
            if let dict = data as? [String: Any],
               let url = (dict[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any])?["URL"] as? String {
              self.sharedUrl = url
              if let title = (dict[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any])?["title"] as? String {
                self.sharedTitle = title
              }
              DispatchQueue.main.async { self.updatePreview() }
            }
          }
        }
      }
    }
  }

  /** Vorschau-Label mit Titel, URL und Text des geteilten Inhalts aktualisieren. */
  private func updatePreview() {
    let heading = sharedTitle.isEmpty ? "Geteilt" : sharedTitle
    previewLabel.text = [heading, sharedUrl, sharedText].filter { !$0.isEmpty }.joined(separator: "\n")
  }

  // MARK: - UI

  /** Baut die Oberfläche auf: Titel, Vorschau, Statuszeile, Speichern- und Abbrechen-Button. */
  private func buildUi() {
    let title = UILabel()
    title.text = "🪶 An Pozume senden"
    title.font = .boldSystemFont(ofSize: 17)
    title.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(title)

    previewLabel.numberOfLines = 6
    previewLabel.font = .systemFont(ofSize: 13)
    previewLabel.textColor = .secondaryLabel
    previewLabel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(previewLabel)

    statusLabel.text = " "
    statusLabel.font = .systemFont(ofSize: 13)
    statusLabel.textColor = .secondaryLabel
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(statusLabel)

    saveButton.setTitle("Als Notiz speichern", for: .normal)
    saveButton.titleLabel?.font = .boldSystemFont(ofSize: 16)
    saveButton.backgroundColor = .systemBlue
    saveButton.setTitleColor(.white, for: .normal)
    saveButton.layer.cornerRadius = 12
    saveButton.addTarget(self, action: #selector(saveTapped), for: .touchUpInside)
    saveButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(saveButton)

    let cancel = UIButton(type: .system)
    cancel.setTitle("Abbrechen", for: .normal)
    cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
    cancel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(cancel)

    NSLayoutConstraint.activate([
      title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
      title.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      previewLabel.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 12),
      previewLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      previewLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      statusLabel.topAnchor.constraint(equalTo: previewLabel.bottomAnchor, constant: 12),
      statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      saveButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 16),
      saveButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      saveButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      saveButton.heightAnchor.constraint(equalToConstant: 48),
      cancel.topAnchor.constraint(equalTo: saveButton.bottomAnchor, constant: 12),
      cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
    ])
  }

  /** Abbrechen: Extension ohne Speichern schließen. */
  @objc private func cancelTapped() {
    extensionContext?.completeRequest(returningItems: nil)
  }

  // MARK: - Speichern

  /**
   * Speichern-Button: baut aus Titel/URL/Text eine Markdown-Notiz
   * (Überschrift = Seitentitel oder URL, Inhalt = Link + Text)
   * und legt sie per POST auf dem Server ab.
   */
  @objc private func saveTapped() {
    saveButton.isEnabled = false
    statusLabel.text = "Speichert…"

    // Ohne Anmeldung in der Haupt-App kann die Extension nichts speichern
    guard let config = loadConfig() else {
      statusLabel.text = "Keine Anmeldung — bitte zuerst in der Pozume-App einloggen."
      saveButton.isEnabled = true
      return
    }

    // Überschrift: Seitentitel, sonst URL-Anfang, sonst Fallback
    let heading = sharedTitle.isEmpty ? (sharedUrl.isEmpty ? "Geteilte Notiz" : String(sharedUrl.prefix(60))) : sharedTitle
    // Inhalt: URL als Markdown-Link, darunter der geteilte Text
    var content = ""
    if !sharedUrl.isEmpty {
      content += "[\(sharedUrl)](\(sharedUrl))\n\n"
    }
    if !sharedText.isEmpty {
      content += sharedText
    }
    if content.isEmpty {
      statusLabel.text = "Nichts zu speichern."
      saveButton.isEnabled = true
      return
    }

    createNote(config: config, heading: heading, content: content) { [weak self] success, message in
      DispatchQueue.main.async {
        guard let self else { return }
        if success {
          // Nach Erfolg kurz Bestätigung zeigen, dann Extension schließen
          self.statusLabel.text = "✓ Gespeichert"
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            self.extensionContext?.completeRequest(returningItems: nil)
          }
        } else {
          self.statusLabel.text = message
          self.saveButton.isEnabled = true
        }
      }
    }
  }

  /** Server-Konfiguration aus der App Group lesen; nil, wenn noch nicht angemeldet. */
  private func loadConfig() -> ServerConfig? {
    guard
      let raw = UserDefaults(suiteName: "group.de.inthielligent.pozume")?.string(forKey: "pozume.server"),
      let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(ServerConfig.self, from: data)
  }

  /**
   * Legt die Notiz an (POST /api/v1/notes, Markdown-Typ).
   * Auth identisch zur App: Basic Auth + X-User-ID-Header.
   * completion: (Erfolg, Fehlermeldung)
   */
  private func createNote(config: ServerConfig, heading: String, content: String, completion: @escaping (Bool, String) -> Void) {
    guard let url = URL(string: "\(config.baseUrl)/api/v1/notes") else {
      completion(false, "Ungültige Server-Adresse")
      return
    }
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.httpMethod = "POST"
    let raw = "\(config.username):\(config.password)".data(using: .utf8)?.base64EncodedString() ?? ""
    request.setValue("Basic \(raw)", forHTTPHeaderField: "Authorization")
    request.setValue("1", forHTTPHeaderField: "X-User-ID")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let body: [String: Any] = [
      "heading": heading,
      "content": content,
      "type": "markdown",
    ]
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)

    URLSession.shared.dataTask(with: request) { _, response, error in
      if let error = error {
        completion(false, "Netzwerkfehler: \(error.localizedDescription)")
        return
      }
      guard let http = response as? HTTPURLResponse else {
        completion(false, "Unerwartete Antwort")
        return
      }
      if (200...299).contains(http.statusCode) {
        completion(true, "")
      } else {
        completion(false, "Serverfehler (HTTP \(http.statusCode))")
      }
    }.resume()
  }
}

/** Server-Zugangsdaten, von der Haupt-App als JSON in die App Group geschrieben. */
struct ServerConfig: Codable {
  let baseUrl: String
  let username: String
  let password: String
}
