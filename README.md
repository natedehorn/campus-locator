# Campus Locator

A daily geography game. You're shown the name of a college or university and
click the map where you think its campus is. The closer you guess, the more
points you get.

## Running it

No build step. Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8000

Leaflet and OpenStreetMap tiles load from the internet.

## Rules

- **5 schools per day, per mode.** Each mode has its own set of five schools
  for the day, drawn from that mode's pool.
- **Same schools for everyone.** The daily set is seeded from the date and mode,
  so every player gets the same five schools on the same day.
- **Score per guess:** `points = 5000 × e^(−km / scale)`, rounded. A perfect
  guess is 5,000. The day's total is out of 25,000.
- **Modes and scales:**

| Mode          | Pool                 | Scale (km) |
|---------------|----------------------|-----------:|
| Global        | All schools          | 3000 |
| United States | US schools           | 800 |
| North America | US, Canada, Mexico   | 1500 |
| Europe        | Europe (incl. Moscow)| 1000 |
| Asia          | Asia (incl. Istanbul)| 1500 |
| Africa        | Africa               | 2000 |
| South America | South America        | 1500 |
| Oceania       | Australia, NZ        | 1500 |

Smaller scales are harsher. A 300 km miss scores about 3,400 in the US
mode and about 4,600 in Global.

## Files

- `index.html`: page layout
- `styles.css`: light and dark theme
- `data.js`: school list as `[name, country, region, lat, lng]`
- `app.js`: game logic, scoring, daily sets, storage, and map

## Adding schools

Append a row to `SCHOOL_DATA` in `data.js`. Use `"US"`/`"CA"`/... for the
country and `na`/`sa`/`eu`/`as`/`af`/`oc` for the region. Coordinates are
approximate campus centers.

## Notes

- Progress is saved in `localStorage`, so it's per browser and per device.
  There is no account or sync.
- Clearing site data resets your history.
