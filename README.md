# Cafes of Stockholm

A test map of Stockholm's cafés. The main feature is a time slider: it starts at the current time, and you can pick another day and time to see which cafés are open then.

## Scope

Every place OpenStreetMap tags as `amenity=cafe`, `shop=coffee` or `shop=bakery` inside six municipalities: Stockholm, Solna, Sundbyberg, Nacka, Lidingö and Danderyd. The borders come from OSM. Cafés are drawn as a cup and bakeries as a croissant. Open places steam, closed ones are hollow and places without hours are grey; specialty coffee places are drawn a quarter larger.

Live: https://lukasposolda-qwertz.github.io/cafes-of-stockholm/

## How it works

- `tools/build_data.py` downloads cafés, coffee shops and bakeries from OpenStreetMap's Overpass API, parses their opening hours and writes `data/cafes.json`. It needs only the Python standard library. Run it from the repo root.
- `index.html`, `style.css` and `app.js` are a static MapLibre site with no build step and no backend. The map keeps its text to a minimum; `about.html` explains specialty coffee, the icons, the filters, the data and the credits.

The data is a snapshot, with its date shown on the page. A GitHub Action (`.github/workflows/rebuild-data.yml`) rebuilds it every Monday at 03:00 UTC and commits the new file, and GitHub Pages then republishes the site. To pick up OSM edits straight away, open the Actions tab, choose "Rebuild café data" and press "Run workflow". If Overpass is down or returns a suspiciously small result, the job fails and the old data stays.

## Known limits

- Hours describe a normal week. Seasonal and public-holiday rules are skipped.
- Cafés with no hours, or hours too irregular to parse, appear as grey cups.
- Specialty coffee comes straight from the OSM tag `drink:coffee=specialty`, which few places have yet. It is the main switch and on by default.
- Filters come in two groups. "Show" picks the kinds of place (cafés, bakeries) and each tick adds places. "Only" narrows the map (outdoor seating, independents, with opening hours), so places without hours are on the map unless you ask for only those with hours.
- The steam is an animation of about eight frames a second. It stops when the system asks for reduced motion or the tab is hidden.
- Chains are places with an OSM brand tag, plus places sharing a name with one, so not every chain is caught.

## Data and credits

Café data © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright). `data/cafes.json` is derived from it and is available under the same licence.

Map tiles: [OpenFreeMap](https://openfreemap.org), © OpenMapTiles, data from OpenStreetMap. Map library: [MapLibre GL JS](https://maplibre.org).

© 2026 Lukas Posolda
