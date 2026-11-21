import UIKit
import UniformTypeIdentifiers

/**
 * Share-Extension: empfängt eine URL, Text, ein Bild oder eine Datei (z.B.
 * PDF) aus dem Teilen-Menü und legt ihn in der App Group als "ausstehenden Share"
 * ab — als Queue (JSON-Array, max. 20 Einträge), damit mehrere Shares hintere-
 *inander nicht verloren gehen. Die Haupt-App übernimmt die Einträge beim
 * nächsten Start und öffnet den Editor mit Vorbelegung — Zielordner und Tags
 * werden dort vor dem Speichern gewählt (P1-12). Die Extension selbst braucht
 * dafür keine Zugangsdaten mehr.
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
  /// Dateiname (ohne Verzeichnis) eines geteilten Bildes in SharedAttachments/.
  private var sharedImagePath: String = ""
  /// Dateiname (ohne Verzeichnis) einer geteilten DATEI (z.B. PDF) in SharedAttachments/.
  private var sharedFilePath: String = ""
  /// Ursprünglicher Anzeigename der geteilten Datei (für Überschrift und Anhang).
  private var sharedFileName: String = ""
  /// Bestmöglich bestimmter MIME-Typ der Datei — für den späteren Anhang-Upload.
  private var sharedMimeType: String = ""

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
   * (mit Titel), Text-Apps als PlainText, Fotos als Image — alle vier
   * Varianten werden der Reihe nach probiert. loadItem kann die Daten
   * je nach Quelle als URL/String, aber auch als NSData liefern — die
   * Completion-Handler haben dafür Fallbacks; Fehler werden geloggt und
   * ignoriert, damit die Extension trotzdem weiterläuft.
   */
  private func loadSharedItem() {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }
    for item in items {
      guard let providers = item.attachments else { continue }
      for provider in providers {
        // Variante 1: direkte URL (z.B. aus Bookmark-Apps)
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, error in
            if let error = error {
              print("[ShareExtension] URL laden fehlgeschlagen: \(error.localizedDescription)")
              return
            }
            // Fallback: manche Quellen liefern die URL als NSData
            let url: URL?
            if let direct = data as? URL {
              url = direct
            } else if let nsData = data as? NSData {
              url = URL(dataRepresentation: nsData as Data, relativeTo: nil)
            } else {
              url = nil
            }
            if let url = url {
              self.sharedUrl = url.absoluteString
              self.sharedTitle = item.attributedTitle?.string ?? ""
              DispatchQueue.main.async { self.updatePreview() }
            }
          }
        }
        // Variante 2: einfacher Text (z.B. aus Notiz-Apps, Copy-Paste)
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, error in
            if let error = error {
              print("[ShareExtension] Text laden fehlgeschlagen: \(error.localizedDescription)")
              return
            }
            // Fallback: Text kann auch als NSData (UTF-8) ankommen
            let text: String?
            if let direct = data as? String {
              text = direct
            } else if let nsData = data as? NSData {
              text = String(data: nsData as Data, encoding: .utf8)
            } else {
              text = nil
            }
            if let text = text {
              self.sharedText = text
              if self.sharedTitle.isEmpty { self.sharedTitle = item.attributedTitle?.string ?? "" }
              DispatchQueue.main.async { self.updatePreview() }
            }
          }
        }
        // Variante 3: Safari liefert die URL als Property-List (kompakter Titel + URL)
        if provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) {
          provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier, options: nil) { data, error in
            if let error = error {
              print("[ShareExtension] Property-List laden fehlgeschlagen: \(error.localizedDescription)")
              return
            }
            // Fallback: Property-List kann auch als NSData ankommen
            let dict: [String: Any]?
            if let direct = data as? [String: Any] {
              dict = direct
            } else if let nsData = data as? NSData,
                      let parsed = try? PropertyListSerialization.propertyList(from: nsData as Data, options: [], format: nil) as? [String: Any] {
              dict = parsed
            } else {
              dict = nil
            }
            if let dict = dict,
               let url = (dict[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any])?["URL"] as? String {
              self.sharedUrl = url
              if let title = (dict[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any])?["title"] as? String {
                self.sharedTitle = title
              }
              DispatchQueue.main.async { self.updatePreview() }
            }
          }
        }
        // Variante 4: Bild (z.B. aus Fotos) — wird als Datei in SharedAttachments/ abgelegt
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
          provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { data, error in
            if let error = error {
              print("[ShareExtension] Bild laden fehlgeschlagen: \(error.localizedDescription)")
              return
            }
            // Bilddaten kommen je nach Quelle als NSData oder als Datei-NSURL
            let imageData: Data?
            if let nsData = data as? NSData {
              imageData = nsData as Data
            } else if let url = data as? URL {
              imageData = try? Data(contentsOf: url)
            } else {
              imageData = nil
            }
            guard let imageData = imageData,
                  let fileName = self.saveImage(imageData, provider: provider) else { return }
            self.sharedImagePath = fileName
            DispatchQueue.main.async { self.updatePreview() }
          }
        }
        // Variante 5: Dateien (z.B. PDF, ZIP) — alles, was weder URL, Text,
        // Property-List noch Bild ist. NSItemProvider liefert Dateien
        // typischerweise als Datei-NSURL; die Datei wird wie das Bild in
        // SharedAttachments/ kopiert. Die Haupt-App übernimmt sie beim nächsten
        // Start als initialen Anhang (Editor) und lädt sie hoch (P1-12).
        let nonFileTypes = [
          UTType.url.identifier,
          UTType.plainText.identifier,
          UTType.image.identifier,
          UTType.propertyList.identifier,
        ]
        // Konformitäts-Check zuerst: ein Bild registriert z.B. "public.jpeg",
        // nicht "public.image" — nur der String-Vergleich würde es fälschlich
        // als Datei behandeln. hasItemConformingToTypeIdentifier löst Untertypen auf.
        if !provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           !provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
           !provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
           !provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier),
           let typeIdentifier = provider.registeredTypeIdentifiers.first(where: { !nonFileTypes.contains($0) }) {
          provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { data, error in
            if let error = error {
              print("[ShareExtension] Datei laden fehlgeschlagen: \(error.localizedDescription)")
              return
            }
            // Nur echte lokale Dateien behandeln — Web-URLs und Text sind
            // bereits über die Varianten 1–4 abgedeckt; NSData-Blobs ohne
            // file-Schema wären sonst Datenmüll.
            let fileUrl: URL?
            if let direct = data as? URL {
              fileUrl = direct
            } else if let nsData = data as? NSData,
                      let fromData = URL(dataRepresentation: nsData as Data, relativeTo: nil),
                      fromData.scheme == "file" {
              fileUrl = fromData
            } else {
              fileUrl = nil
            }
            guard let fileUrl = fileUrl, fileUrl.scheme == "file" else { return }
            guard let saved = self.saveSharedFile(at: fileUrl, provider: provider) else { return }
            self.sharedFilePath = saved.storedName
            self.sharedFileName = saved.displayName
            self.sharedMimeType = Self.mimeType(forExtension: fileUrl.pathExtension, typeIdentifier: typeIdentifier)
            DispatchQueue.main.async { self.updatePreview() }
          }
        }
      }
    }
  }

  // MARK: - Datei in der App Group ablegen

  /**
   * Kopiert die geteilte Datei unter <appgroup-container>/SharedAttachments/
   * mit UUID-Namen und Original-Endung.
   * @returns gespeicherter Name (ohne Verzeichnis) und Original-Name oder nil bei Fehler.
   */
  private func saveSharedFile(at sourceUrl: URL, provider: NSItemProvider) -> (storedName: String, displayName: String)? {
    guard let groupUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.de.inthielligent.pozume") else {
      return nil
    }
    let dir = groupUrl.appendingPathComponent("SharedAttachments", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let ext = sourceUrl.pathExtension.isEmpty ? "" : "." + sourceUrl.pathExtension.lowercased()
      let storedName = UUID().uuidString + ext
      try FileManager.default.copyItem(at: sourceUrl, to: dir.appendingPathComponent(storedName))
      let displayName = provider.suggestedName ?? sourceUrl.lastPathComponent
      return (storedName, displayName)
    } catch {
      print("[ShareExtension] Datei speichern fehlgeschlagen: \(error.localizedDescription)")
      return nil
    }
  }

  /** Besten verfügbaren MIME-Typ bestimmen (Endung, sonst registrierter Typ-Bezeichner). */
  private static func mimeType(forExtension ext: String, typeIdentifier: String) -> String {
    if !ext.isEmpty, let type = UTType(filenameExtension: ext), let mime = type.preferredMIMEType {
      return mime
    }
    if let type = UTType(typeIdentifier), let mime = type.preferredMIMEType {
      return mime
    }
    return "application/octet-stream"
  }

  // MARK: - Bild in der App Group ablegen

  /**
   * Speichert die Bilddaten unter <appgroup-container>/SharedAttachments/
   * mit UUID-Namen und passender Endung; legt das Verzeichnis bei Bedarf an.
   * @returns Dateiname (ohne Verzeichnis) oder nil bei Fehler.
   */
  private func saveImage(_ data: Data, provider: NSItemProvider) -> String? {
    guard let groupUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.de.inthielligent.pozume") else {
      return nil
    }
    let dir = groupUrl.appendingPathComponent("SharedAttachments", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let fileName = UUID().uuidString + "." + Self.imageExtension(for: data, provider: provider)
      try data.write(to: dir.appendingPathComponent(fileName), options: .atomic)
      return fileName
    } catch {
      print("[ShareExtension] Bild speichern fehlgeschlagen: \(error.localizedDescription)")
      return nil
    }
  }

  /** Bild-Endung anhand der registrierten Typen, mit Magic-Bytes-Fallback. */
  private static func imageExtension(for data: Data, provider: NSItemProvider) -> String {
    let registered = provider.registeredTypeIdentifiers
    if registered.contains(UTType.heic.identifier) { return "heic" }
    if registered.contains(UTType.png.identifier) { return "png" }
    if registered.contains(UTType.jpeg.identifier) { return "jpg" }
    // Magic Bytes als Fallback, wenn die Typen nichts aussagen
    if data.count > 12 {
      if data[data.startIndex] == 0xFF, data[data.startIndex + 1] == 0xD8 { return "jpg" }
      if data[data.startIndex] == 0x89, data[data.startIndex + 1] == 0x50 { return "png" }
      if String(data: data.subdata(in: 4..<8), encoding: .ascii) == "ftyp" { return "heic" }
    }
    return "jpg"
  }

  /** Vorschau-Label mit Titel, URL, Text und Bild-/Datei-Hinweis des geteilten Inhalts aktualisieren. */
  private func updatePreview() {
    let heading = sharedTitle.isEmpty ? "Geteilt" : sharedTitle
    var lines = [heading, sharedUrl, sharedText].filter { !$0.isEmpty }
    if !sharedImagePath.isEmpty { lines.append("📷 Bild angehängt") }
    if !sharedFilePath.isEmpty { lines.append("📎 \(sharedFileName)") }
    previewLabel.text = lines.joined(separator: "\n")
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
   * als "ausstehenden Share" in der App Group ab — als Eintrag in einer
   * Queue (JSON-Array unter "pozume.pendingShare", max. 20 Einträge, die
   * ältesten werden verworfen). Die Haupt-App übernimmt die Einträge beim
   * nächsten Start, zeigt den Editor mit Vorbelegung und lässt Zielordner
   * und Tags vor dem Speichern wählen.
   */
  @objc private func saveTapped() {
    // Überschrift: Seitentitel, sonst URL-Anfang, sonst Dateiname, sonst Fallback
    let heading = sharedTitle.isEmpty
      ? (sharedUrl.isEmpty
          ? (sharedImagePath.isEmpty
              ? (sharedFilePath.isEmpty ? "Geteilte Notiz" : sharedFileName)
              : "Geteiltes Bild")
          : String(sharedUrl.prefix(60)))
      : sharedTitle
    // Inhalt: URL als Markdown-Link, darunter der geteilte Text
    var content = ""
    if !sharedUrl.isEmpty {
      // Klammern escapen, damit Titel/URL die Markdown-Link-Syntax nicht vorzeitig schließen
      let escapedUrl = Self.escapeMarkdown(sharedUrl)
      content += "[\(escapedUrl)](\(escapedUrl))\n\n"
    }
    if !sharedText.isEmpty {
      content += sharedText
    }
    if content.isEmpty && sharedImagePath.isEmpty && sharedFilePath.isEmpty {
      statusLabel.text = "Nichts zu übernehmen."
      return
    }

    // Neuer Queue-Eintrag: ts (Unix-Sekunden), heading, content, imagePath nur
    // bei Bild, filePath/fileName/fileType nur bei Datei
    var entry: [String: Any] = [
      "ts": Int(Date().timeIntervalSince1970),
      "heading": heading,
      "content": content,
    ]
    if !sharedImagePath.isEmpty {
      entry["imagePath"] = sharedImagePath
    }
    if !sharedFilePath.isEmpty {
      entry["filePath"] = sharedFilePath
      entry["fileName"] = sharedFileName
      entry["fileType"] = sharedMimeType
    }

    guard let group = UserDefaults(suiteName: "group.de.inthielligent.pozume") else {
      statusLabel.text = "Speichern nicht möglich."
      return
    }
    // Vorhandene Queue lesen (altes Einzel-Format ignorieren), neuen Eintrag anhängen
    var queue: [[String: Any]] = []
    if let raw = group.string(forKey: "pozume.pendingShare"),
       let data = raw.data(using: .utf8),
       let existing = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      queue = existing
    }
    queue.append(entry)
    // Max. 20 Einträge — die ältesten (vorne) verwerfen
    if queue.count > 20 {
      queue.removeFirst(queue.count - 20)
    }
    guard let data = try? JSONSerialization.data(withJSONObject: queue),
          let raw = String(data: data, encoding: .utf8) else {
      statusLabel.text = "Speichern nicht möglich."
      return
    }
    group.set(raw, forKey: "pozume.pendingShare")
    // synchronize() macht den Eintrag sofort für die Haupt-App sichtbar
    // (gleiche Konvention wie PozumeAppGroupModule.saveValue).
    group.synchronize()

    statusLabel.text = "✓ Übernommen — in der Pozume-App fertigstellen"
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
      self.extensionContext?.completeRequest(returningItems: nil)
    }
  }

  /** Escapt Backslash sowie eckige und runde Klammern für die Markdown-Link-Syntax. */
  private static func escapeMarkdown(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "[", with: "\\[")
      .replacingOccurrences(of: "]", with: "\\]")
      .replacingOccurrences(of: "(", with: "\\(")
      .replacingOccurrences(of: ")", with: "\\)")
  }
}
