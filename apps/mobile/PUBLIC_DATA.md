# Public safety data used by NearMKE

The external mobile MVP reads Milwaukee Police Department monthly public crime layers from the City of Milwaukee ArcGIS service:

- Service: `https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/MPD/MPD_Monthly/MapServer`
- Layers used: all ten official monthly layers: homicide, arson, sex offense, criminal damage, robbery, burglary, theft, vehicle theft, locked-vehicle entry, and assault (0–9)
- Window: records whose `DAYSPASSED` value is 30 or less (the service itself is a monthly view)
- Fields requested: `DAYSPASSED`, `REPORTEDDATETIME`, `WEAPONUSED`, and point geometry. Incident numbers, narrative text, and exact displayed addresses are excluded.

The map is our own Leaflet visualization over OpenStreetMap tiles; it does not copy or embed MilwaukeeCrime.com's map or dataset. The heat surface is generated from the official points above, while colored pins show reports from the most recent seven days. For a production build, bundle or self-host the pinned Leaflet assets and follow OpenStreetMap's tile-usage policy rather than relying on a public CDN indefinitely.

## Privacy decisions

- The query requests `geometryPrecision=2`, which generalizes coordinates before the app receives them. The app aggregates those points again before rendering the density surface.
- Incident numbers, exact addresses, victim details, names, and narrative fields are not requested or displayed.
- The map describes historical patterns. It does not score neighborhoods or predict people who may commit violence.
- “Domestic violence” is not inferred from other fields because the public service does not expose a reliable category for it.
- MVP community reports select a broad neighborhood centroid and remain in local app state. They are clearly labeled as unverified observations.

## Recent calls and nearby alerts

The safety map and the Alerts tab show the official MPD calls-for-service page at `https://itmdapps.milwaukee.gov/MPDCallData/`, ingested server-side. The app never scrapes the city page itself.

- **Pipeline:** the API ingests the page itself in the background (`api/services/mpd_scheduler.py`), at startup and then every five minutes (`APP__MPD_INGEST__INTERVAL_SECONDS`). Nothing else has to run. With several API processes, a database lease (migration 0012) lets exactly one scrape per interval. The page allows **10 requests per 30 minutes per IP address**; past that it returns a "too many requests" row, which is logged as a rate-limited run. That limit is why the interval is five minutes and can't be set below three, and why staging polls every ten. Ingestion parses the page's one table, deduplicates by call number (a call's outcome replaces "Service in Progress"), places each call on the map, and upserts it into `app.mpd_calls` (migration 0011). Each run is logged in `app.mpd_ingest_runs`. A page that parses to zero calls counts as a failed run (layout change), not as an empty city. Calls older than 30 days are pruned.
- **Placing calls:** about one row in five carries MPD's own `LL(...)` estimate. The rest are an address or an intersection, geocoded with MPD's CAD locator (`MPDTritech/TriTechLocator` on milwaukeemaps.milwaukee.gov), the only city locator that resolves intersections. Answers and misses are cached in `app.mpd_geocodes`, so each address is looked up once. Highway segments (`INT 43 S`) stay unplotted.
- **API:** `GET /v1/safety/calls?hours=2|6|24` (signed in) returns the calls plus counts by category, call type, district and hour, and a `stale` flag when the last good read is more than 15 minutes old.
- MPD says the page refreshes every five minutes and shows calls 30–90 minutes after dispatch.
- Calls for service are not confirmed crimes. The app keeps them visually and statistically separate from the 30-day incident heatmap.
- **Privacy:** the published street text is stored only to geocode it and is never returned. The API returns the block ("2800 block of S GREELEY ST") or intersection, and coordinates rounded to three decimals (~110 m) before storage. Place notes and unit numbers ("@UNIT 6") are dropped. The phone's foreground location is used only in memory to calculate distance and is not uploaded or saved.
- The Alerts tab lists only the weapons, violence and property categories, plus reckless driving, drug dealing and arson. The safety map and its summary show every call type.
- Before public launch, confirm automated-access expectations with the City of Milwaukee. The scraper identifies itself in its User-Agent, polls every five minutes (the page's own refresh rate), and asks the geocoder only about addresses it hasn't seen.

## Production follow-up

Before public deployment, confirm reuse terms and automated-access expectations with the City of Milwaukee, add moderation and expiration for community reports, complete accessibility testing, and have ComForce MKE review all public resource listings. True push notifications require a backend job and a development build; the MVP intentionally provides in-app alerts while it is open.
