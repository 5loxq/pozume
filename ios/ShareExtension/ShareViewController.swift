import UIKit
import UniformTypeIdentifiers

/**
 * Share-Extension: empfängt eine URL oder Text aus dem Teilen-Menü
 * (z.B. Safari) und legt ihn in der App Group als "ausstehenden Share" ab.
 * Die Haupt-App übernimmt ihn beim nächsten Start und öffnet den Editor mit
 * Vorbelegung — Zielordner und Tags werden dort vor dem Speichern gewählt
 * (P1-12). Die Extension selbst braucht dafür keine Zugangsdaten mehr.
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

    saveButton.setTitle("In Pozume übernehmen", for: .normal)
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
   * Speichern-Button: baut aus Titel/URL/Text die Markdown-Vorbelegung
   * (Überschrift = Seitentitel oder URL, Inhalt = Link + Text) und legt sie
   * als "ausstehenden Share" in der App Group ab. Die Haupt-App übernimmt den
   * Eintrag beim nächsten Start, zeigt den Editor mit Vorbelegung und lässt
   * Zielordner und Tags vor dem Speichern wählen. Der Eintrag wird von der
   * App sofort beim Übernehmen entnommen — der Inhalt landet genau einmal.
   */
  @objc private func saveTapped() {
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
      statusLabel.text = "Nichts zu übernehmen."
      return
    }

    let payload: [String: String] = ["heading": heading, "content": content]
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let raw = String(data: data, encoding: .utf8),
          let group = UserDefaults(suiteName: "group.de.inthielligent.pozume") else {
      statusLabel.text = "Speichern nicht möglich."
      return
    }
    group.set(raw, forKey: "pozume.pendingShare")

    statusLabel.text = "✓ Übernommen — in der Pozume-App fertigstellen"
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
      self.extensionContext?.completeRequest(returningItems: nil)
    }
  }
}
