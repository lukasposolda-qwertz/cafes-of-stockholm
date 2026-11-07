# Cafes of Stockholm

A test map of Stockholm's cafés. The main feature is a time slider: it starts at the current time, and you can pick another day and time to see which cafés are open then.

## Scope

Every place OpenStreetMap tags as `amenity=cafe`, `shop=coffee` or `shop=bakery` inside six municipalities: Stockholm, Solna, Sundbyberg, Nacka, Lidingö and Danderyd. The borders come from OSM. Bakeries are counted as cafés and drawn as a cinnamon bun.

Live: https://lukasposolda-qwertz.github.io/cafes-of-stockholm/

## How it works

- `tools/build_data.py` downloads cafés, coffee shops and bakeries from OpenStreetMap's Overpass API, parses their opening hours and writes `data/cafes.json`. It needs only the Python standard library. Run it from the repo root.
- `index.html`, `style.css` and `app.js` are a static MapLibre site with no build step and no backend.

The data is a one-time snapshot, with its date shown on the page.

## Known limits

- Hours describe a normal week. Seasonal and public-holiday rules are skipped.
- Cafés with no hours, or hours too irregular to parse, appear as grey cups.
- Specialty comes straight from the OSM tag `drink:coffee=specialty`, which few places have yet. Bakeries count as cafés and have their own filter.
- Chains are places with an OSM brand tag, plus places sharing a name with one, so not every chain is caught.

## Data and credits

Café data © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). `data/cafes.json` is derived from it and is available under the same licence.

Map tiles: [OpenFreeMap](https://openfreemap.org), © OpenMapTiles, data from OpenStreetMap. Map library: [MapLibre GL JS](https://maplibre.org).

© 2026 Lukas Posolda
