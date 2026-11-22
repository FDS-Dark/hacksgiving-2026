# Public data used by NearMKE

The app reads normalized public data from the NearMKE API. The data loader owns upstream requests, sanitization, deduplication, freshness records, and source-specific schedules; the phone does not scrape city pages directly.

## Neighborhood awareness

The loader reads Milwaukee Police Department monthly public crime layers from the City of Milwaukee ArcGIS service:

- Service: `https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/MPD/MPD_Monthly/MapServer`
- Layers used: all ten official monthly layers: homicide, arson, sex offense, criminal damage, robbery, burglary, theft, vehicle theft, locked-vehicle entry, and assault (0–9)
- Window: the app offers 7-day, 30-day, and one-year views over the records retained by the API
- Fields requested: `DAYSPASSED`, `REPORTEDDATETIME`, `WEAPONUSED`, and point geometry. Incident numbers, narrative text, and exact displayed addresses are excluded.

The map is our own Leaflet visualization over OpenStreetMap tiles; it does not copy or embed MilwaukeeCrime.com's map or dataset. The heat surface is generated from official points, while colored pins show reports from the most recent seven days. Police and fire/EMS dispatch calls are optional, separately labeled layers and are never counted in the heat intensity. For a production build, bundle or self-host the pinned Leaflet assets and follow OpenStreetMap's tile-usage policy rather than relying on a public CDN indefinitely.

## Privacy decisions

- The query requests `geometryPrecision=2`, which generalizes coordinates before the app receives them. The app aggregates those points again before rendering the density surface.
- Incident numbers, exact addresses, victim details, names, and narrative fields are not requested or displayed.
- The map describes historical patterns. It does not score neighborhoods or predict people who may commit violence.
- “Domestic violence” is not inferred from other fields because the public service does not expose a reliable category for it.
- MVP community reports select a broad neighborhood centroid and remain in local app state. They are clearly labeled as unverified observations.

## Recent calls and nearby alerts

The loader reads the official MPD and MFD dispatched-call pages. The Awareness screen retrieves their sanitized results from `/v1/public-data/calls`.

- MPD says the page refreshes every five minutes and shows calls 30–90 minutes after dispatch.
- Calls for service are not confirmed crimes. The app keeps them visually and statistically separate from the 30-day incident heatmap.
- Calls without embedded coordinates can appear in the citywide Alerts list, but only coordinate-bearing calls can be plotted or compared with the phone's location.
- Crime-related dispatch categories include shootings, weapons, assault, sexual assault, robbery, burglary, theft, stolen vehicles, arson, criminal damage, drug dealing, and reckless driving. Generic 911 calls and administrative calls are omitted.
- Coordinates from the calls page are rounded before display. The phone's foreground location is used only in memory to calculate distance and is not uploaded or saved.
- The server-side loader monitors source health, deduplicates calls, generalizes locations, and publishes a stable sanitized API. Production deployment should still confirm automated-access expectations with MPD and MFD.
- When MPD does not publish coordinates, the loader geocodes only the start of the block, never a house number, and retains a rounded point of roughly 110 meters. Sensitive calls and highway segments remain unplotted.
- The 911 summary offers 2-, 6-, and 24-hour windows, totals, calls per hour, and breakdowns by category and district. Selecting a category filters the map.
- The phone refreshes from our API every 30 seconds; the loader remains within the upstream five-minute schedule and published rate limit.

## Trends, source health, and transit

- Staff Insights compares two complete 12-month periods of MPD totals supplied by the FBI Crime Data Explorer. It shows no percentage when the feed cannot support a fair comparison.
- Staff Insights exposes each loader source's last successful update instead of implying stale data is current.
- Resource details query nearby MCTS stops, routes, arrivals, and service alerts when the resource has coordinates. Live and scheduled arrivals are labeled separately, with MCTS attribution shown in the UI.

## Production follow-up

Before public deployment, confirm reuse terms and automated-access expectations with the City of Milwaukee, add moderation and expiration for community reports, complete accessibility testing, and have ComForce MKE review all public resource listings. True push notifications require a backend job and a development build; the MVP intentionally provides in-app alerts while it is open.
