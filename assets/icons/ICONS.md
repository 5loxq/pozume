# Pozume Icon-Quellen 🪶

Alle Icons sind hier **vektorbasiert als SVG** gespeichert — jederzeit neu skalier- und einfärbar.

## Dateien

| Datei | Konzept | Beschreibung |
|---|---|---|
| `svg/icon-D-indigo.svg` | **Aktives App-Icon** | Feder-Emblem im Indigo-Kreis (#4f46e5) — die App-Farbe |
| `svg/icon-D-violett.svg` | Alternative | Identisches Emblem in Veilchen (#5b3fb8), nah an Poznote-Branding |
| `svg/icon-C-P-feder.svg` | Monogramm | Kräftiges „P" mit schräger Feder |
| `svg/icon-B-karte.svg` | Funktional | Notizkarte mit drei Zeilen + Petrol-Feder |

## Aktives Icon ändern

1. Gewünschte SVG bearbeiten (Farben sind als Hex direkt im Markup — z. B. `#4f46e5` gegen eigene Marke tauschen)
2. 1024-px-PNG erzeugen (siehe unten) und als `assets/icon.png` ablegen
3. Abgeleitete Größen neu generieren (Befehl unten)
4. `app.json` zeigt weiterhin auf `./assets/icon.png` — nichts weiter nötig

## PNG-Erzeugung aus SVG

Auf dem Mac (mit Homebrew):

```bash
brew install librsvg
rsvg-convert -w 1024 -h 1024 svg/icon-D-indigo.png > ../icon.png
```

Abgeleitete iOS-Größen (ffmpeg oder sips):

```bash
for size in 180 120 80 60; do
  ffmpeg -y -i ../icon.png -vf "scale=${size}:${size}" ../icon-${size}.png
done
# oder macOS-bordmittel:
for size in 180 120 80 60; do sips -z $size $size ../icon.png --out ../icon-${size}.png; done
```

## Design-Tokens

- Primär (Indigo): `#4f46e5` · Dunkel: `#4338ca`
- Veilchen-Alternative: `#5b3fb8`
- Elfenbein (Fläche): `#f6f2e8`
- Petrol (Konzept B-Akzent): `#0f6b6b`
- Feder-Geometrie: asymmetrisch — breiter Bart links (4 Ader-Paare), schmale Fahne rechts, Kiel durchlaufend
