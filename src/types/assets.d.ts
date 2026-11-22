/** Metro-Assets per require() einbinden — liefert die Asset-Modul-ID (Zahl). */
declare module '*.mjs' {
  const assetModuleId: number;
  export default assetModuleId;
}
