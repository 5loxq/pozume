export const de = {
  'nav.notes': 'Notizen',
  'nav.folders': 'Ordner',
  'nav.search': 'Suche',
  'nav.settings': 'Einstellungen',
  'common.cancel': 'Abbrechen',
  'common.save': 'Speichern',
  'common.delete': 'Löschen',
  'common.loading': 'Lädt…',
  'login.title': 'Willkommen bei Pozume',
  'login.subtitle': 'Verbinde dich mit deinem eigenen Poznote-Server',
  'login.serverUrl': 'Server-Adresse',
  'login.username': 'Benutzername',
  'login.password': 'Passwort',
  'login.connect': 'Verbinden',
  'login.hint': 'Deine Daten bleiben auf deinem Server — keine Cloud, keine Dritten.',
} as const;
export type TranslationKey = keyof typeof de;
