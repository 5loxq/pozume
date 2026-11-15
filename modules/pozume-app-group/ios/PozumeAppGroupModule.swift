import ExpoModulesCore
import Foundation

/**
 * App-Group-Speicher (group.de.inthielligent.pozume) für Widget und Share-Extension.
 * Die Haupt-App schreibt die Server-Konfiguration hierher; die Extensions
 * lesen sie direkt per UserDefaults. Exponiert einfache Key-Value-Funktionen
 * an JavaScript (saveValue/readValue/removeValue).
 */
public class PozumeAppGroupModule: Module {

  /// Muss identisch zu den Entitlements aller Targets sein.
  private static let suiteName = "group.de.inthielligent.pozume"

  /// UserDefaults der App Group; nil, falls die Gruppe nicht aktiviert ist.
  private var defaults: UserDefaults? {
    UserDefaults(suiteName: PozumeAppGroupModule.suiteName)
  }

  public func definition() -> ModuleDefinition {
    // Name, unter dem JS das Modul per requireNativeModule() findet
    Name("PozumeAppGroup")

    /// Schreibt einen String-Wert; synchronize() macht ihn sofort für Extensions sichtbar.
    Function("saveValue") { (key: String, value: String) -> Bool in
      guard let defaults = self.defaults else { return false }
      defaults.set(value, forKey: key)
      return defaults.synchronize()
    }

    /// Liest einen String-Wert; nil, wenn der Schlüssel nicht existiert.
    Function("readValue") { (key: String) -> String? in
      self.defaults?.string(forKey: key)
    }

    /// Löscht einen Wert; synchronize() macht das sofort für Extensions sichtbar.
    Function("removeValue") { (key: String) -> Bool in
      guard let defaults = self.defaults else { return false }
      defaults.removeObject(forKey: key)
      return defaults.synchronize()
    }
  }
}
