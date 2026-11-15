import ExpoModulesCore
import Foundation

/**
 * App-Group-Speicher (group.de.inthielligent.pozume) für Widget und Share-Extension.
 * Die Haupt-App schreibt die Server-Konfiguration hierher.
 */
public class PozumeAppGroupModule: Module {
  private static let suiteName = "group.de.inthielligent.pozume"

  private var defaults: UserDefaults? {
    UserDefaults(suiteName: PozumeAppGroupModule.suiteName)
  }

  public func definition() -> ModuleDefinition {
    Name("PozumeAppGroup")

    Function("saveValue") { (key: String, value: String) -> Bool in
      guard let defaults = self.defaults else { return false }
      defaults.set(value, forKey: key)
      return defaults.synchronize()
    }

    Function("readValue") { (key: String) -> String? in
      self.defaults?.string(forKey: key)
    }

    Function("removeValue") { (key: String) -> Bool in
      guard let defaults = self.defaults else { return false }
      defaults.removeObject(forKey: key)
      return defaults.synchronize()
    }
  }
}
