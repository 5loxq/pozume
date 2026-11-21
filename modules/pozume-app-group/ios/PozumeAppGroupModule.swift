import ExpoModulesCore
import Foundation
import Security
import WidgetKit

/**
 * App-Group- und Keychain-Speicher für Widget und Share-Extension.
 *
 * Aufteilung der Zugangsdaten:
 * - App Group (UserDefaults): baseUrl + Benutzername — unkritisch, von allen
 *   Targets direkt lesbar.
 * - Gemeinsame Keychain (Access Group "<TeamID>.de.inthielligent.pozume"):
 *   das Server-Passwort — verschlüsselt, hardware-geschützt, erscheint nicht
 *   in Klartext-Backups.
 *
 * Die Keychain-Access-Group wird zur Laufzeit aus der application-identifier-
 * Entitlement abgeleitet, damit App, Widget und Share-Extension (eigene
 * Bundle-IDs) dieselbe Gruppe ansprechen.
 */
public class PozumeAppGroupModule: Module {

  /// Muss identisch zu den Entitlements aller Targets sein.
  private static let suiteName = "group.de.inthielligent.pozume"

  /// Keychain-Identifikatoren für das Server-Passwort.
  private static let keychainService = "pozume.server"
  private static let keychainAccount = "password"

  /// Bundle-ID der Haupt-App — Suffix der application-identifier.
  private static let bundleId = "de.inthielligent.pozume"

  /// Schlüssel, unter dem die aufgelöste Keychain-Group in der App Group liegt.
  private static let groupKey = "pozume.keychainGroup"

  /// Validiert einen Dateinamen als einfachen Namen (keine '/', keine '..', nicht leer).
  private static func isValidFileName(_ fileName: String) -> Bool {
    !fileName.isEmpty && !fileName.contains("/") && !fileName.contains("..")
  }

  /// UserDefaults der App Group; nil, falls die Gruppe nicht aktiviert ist.
  private var defaults: UserDefaults? {
    UserDefaults(suiteName: PozumeAppGroupModule.suiteName)
  }

  /**
   * Löst die gemeinsame Keychain-Access-Group auf und cachet sie in der App
   * Group, damit Widget und Share-Extension sie nur lesen müssen:
   * 1. bereits aufgelöste Group aus der App Group (von einem früheren Lauf),
   * 2. auf dem Gerät: Team-ID aus dem eingebetteten Provisioning-Profil
   *    → "TEAMID.de.inthielligent.pozume",
   * 3. im Simulator (kein Profil): Group ohne Team-Präfix — wird dort
   *    nicht strikt geprüft.
   */
  private func resolveAccessGroup() -> String? {
    guard let defaults = self.defaults else { return nil }
    if let cached = defaults.string(forKey: PozumeAppGroupModule.groupKey), !cached.isEmpty {
      return cached
    }
    let group: String
    if let teamId = PozumeAppGroupModule.teamIdFromProvisioningProfile(), !teamId.isEmpty {
      group = "\(teamId).\(PozumeAppGroupModule.bundleId)"
    } else {
      group = PozumeAppGroupModule.bundleId
    }
    defaults.set(group, forKey: PozumeAppGroupModule.groupKey)
    return group
  }

  /**
   * Extrahiert die Team-ID aus dem eingebetteten Provisioning-Profil
   * (nur auf dem Gerät vorhanden; das Profil ist eine signierte plist,
   * deren XML-Teil per Textsuche gelesen wird).
   */
  private static func teamIdFromProvisioningProfile() -> String? {
    guard let profilePath = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
          let profileData = try? Data(contentsOf: URL(fileURLWithPath: profilePath)),
          let text = String(data: profileData, encoding: .isoLatin1),
          let keyRange = text.range(of: "<key>application-identifier</key>"),
          let stringRange = text[keyRange.upperBound...].range(of: "<string>"),
          let endRange = text[stringRange.upperBound...].range(of: "</string>") else {
      return nil
    }
    // "TEAMID.de.inthielligent.pozume" oder "TEAMID.*" → Team-ID vor dem ersten Punkt
    let appId = String(text[stringRange.upperBound..<endRange.lowerBound])
    guard let teamId = appId.split(separator: ".").first, !teamId.isEmpty else { return nil }
    return String(teamId)
  }

  /// Basis-Query für das Passwort-Item in der gemeinsamen Keychain.
  /// kSecUseDataProtectionKeychain gilt für alle Zugriffe (Add/Update/Read/Delete).
  private func passwordQuery() -> [String: Any]? {
    guard let group = resolveAccessGroup() else { return nil }
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: PozumeAppGroupModule.keychainService,
      kSecAttrAccount as String: PozumeAppGroupModule.keychainAccount,
      kSecAttrAccessGroup as String: group,
      kSecUseDataProtectionKeychain as String: true,
    ]
  }

  /// Legt das Passwort in der Keychain an bzw. aktualisiert es.
  private func savePassword(_ value: String) -> Bool {
    guard var query = passwordQuery() else { return false }
    let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8)]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      query[kSecValueData as String] = Data(value.utf8)
      return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }
    return status == errSecSuccess
  }

  /// Liest das Passwort aus der Keychain; nil, wenn es (noch) nicht existiert.
  private func readPassword() -> String? {
    guard var query = passwordQuery() else { return nil }
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data,
          let password = String(data: data, encoding: .utf8) else {
      return nil
    }
    return password
  }

  /// Löscht das Passwort aus der Keychain; "nicht vorhanden" gilt als Erfolg.
  private func clearPassword() -> Bool {
    guard let query = passwordQuery() else { return false }
    let status = SecItemDelete(query as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
  }

  public func definition() -> ModuleDefinition {
    // Name, unter dem JS das Modul per requireNativeModule() findet
    Name("PozumeAppGroup")

    /// Schreibt einen String-Wert in die App Group. synchronize() ist deprecated und kann
    /// false liefern, obwohl der Wert geschrieben wurde — daher nicht als Erfolg werten.
    Function("saveValue") { (key: String, value: String) -> Bool in
      guard let defaults = self.defaults else { return false }
      defaults.set(value, forKey: key)
      defaults.synchronize()
      return true
    }

    /// Liest einen String-Wert aus der App Group; nil, wenn der Schlüssel nicht existiert.
    Function("readValue") { (key: String) -> String? in
      self.defaults?.string(forKey: key)
    }

    /// Löscht einen Wert aus der App Group (synchronize() nur als Flush, nicht als Erfolg).
    Function("removeValue") { (key: String) -> Bool in
      guard let defaults = self.defaults else { return false }
      defaults.removeObject(forKey: key)
      defaults.synchronize()
      return true
    }

    /// Speichert das Server-Passwort verschlüsselt in der gemeinsamen Keychain.
    Function("savePassword") { (value: String) -> Bool in
      self.savePassword(value)
    }

    /// Liest das Server-Passwort aus der Keychain; nil, wenn keins gespeichert ist.
    Function("readPassword") { () -> String? in
      self.readPassword()
    }

    /// Löscht das Server-Passwort aus der Keychain.
    Function("clearPassword") { () -> Bool in
      self.clearPassword()
    }

    /// Lädt alle Widget-Timelines neu (nach Login/Logout/Save aufrufen).
    Function("reloadWidget") { () -> Bool in
      do {
        WidgetCenter.shared.reloadAllTimelines()
        return true
      } catch {
        return false
      }
    }

    /**
     * Kopiert eine von der Share-Extension abgelegte Datei aus
     * <appgroup-container>/SharedAttachments/ in das Cache-Verzeichnis der
     * Haupt-App, damit JS/Expo (z.B. der Editor) darauf zugreifen kann.
     * @returns absoluter Pfad der Kopie oder nil (ungültiger Name, Datei fehlt, Fehler).
     */
    Function("exportSharedAttachment") { (fileName: String) -> String? in
      guard PozumeAppGroupModule.isValidFileName(fileName),
            let groupUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: PozumeAppGroupModule.suiteName),
            let cachesUrl = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
        return nil
      }
      let sourceUrl = groupUrl.appendingPathComponent("SharedAttachments", isDirectory: true).appendingPathComponent(fileName)
      let destinationUrl = cachesUrl.appendingPathComponent(fileName)
      do {
        // Alte Kopie entfernen, dann frisch kopieren
        if FileManager.default.fileExists(atPath: destinationUrl.path) {
          try FileManager.default.removeItem(at: destinationUrl)
        }
        try FileManager.default.copyItem(at: sourceUrl, to: destinationUrl)
        return destinationUrl.path
      } catch {
        return nil
      }
    }

    /**
     * Löscht eine von der Share-Extension abgelegte Datei aus
     * <appgroup-container>/SharedAttachments/ — nach erfolgreicher Übernahme
     * durch die Haupt-App, damit der App-Group-Container nicht unbegrenzt wächst.
     * @returns true bei Erfolg (auch wenn die Datei nicht existierte).
     */
    Function("deleteSharedAttachment") { (fileName: String) -> Bool in
      guard PozumeAppGroupModule.isValidFileName(fileName),
            let groupUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: PozumeAppGroupModule.suiteName) else {
        return false
      }
      let sourceUrl = groupUrl.appendingPathComponent("SharedAttachments", isDirectory: true).appendingPathComponent(fileName)
      do {
        try FileManager.default.removeItem(at: sourceUrl)
      } catch {
        // Datei nicht (mehr) vorhanden — nichts zu löschen
      }
      return true
    }
  }
}
