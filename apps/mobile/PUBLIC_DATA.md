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

The safety map, the staff Map tab and the Alerts tab show the official MPD dispatched calls page (`https://itmdapps.milwaukee.gov/MPDCallData/`). The data loader ingests it server-side, and the app reads `GET /public-data/calls?source=mpd_calls` (see `docs/data-loader.md`). The app never scrapes the city page itself.

- MPD says the page refreshes every five minutes and shows calls 30–90 minutes after dispatch. The loader polls every five minutes (the page allows 10 requests per 30 minutes per IP address), and the app asks our API every 30 seconds. Every screen that shows calls says so: "Delayed dispatch calls · not confirmed incidents. MPD publishes calls 30–90 min after dispatch."
- Calls for service are not confirmed crimes. The app keeps them visually and statistically separate from the incident heatmap.
- **Placing calls.** About one row in five carries MPD's own `LL(...)` estimate. For the rest, the loader asks MPD's CAD geocoder (`MPDTritech/TriTechLocator`, which also resolves intersections) about the start of the block ("2800 S GREELEY ST"), never the house number. It keeps only the rounded point (~110 m), cached per block in the loader process. Sensitive calls are never placed, and highway segments (`INT 43 S`) stay unplotted.
- **Safety map.** Call pins are colored by a fixed category (weapons, violence, property, traffic, disorder, assistance, other). Below the map, a 911 calls section has a 2 / 6 / 24 hour window, totals, calls per hour, counts by category and district (tapping a category filters the map), the most common call types and the latest calls. The app computes these counts from the calls the API returns.
- **Alerts tab.** Only crime-related dispatch categories: shootings, weapons, assault, robbery, burglary, theft, stolen vehicles, arson, criminal damage, drug dealing and reckless driving.
- **Privacy.** No address leaves the server, and sensitive call types are never listed (`docs/real-data-sources.md`). The phone's foreground location is used only in memory to calculate distance and is not uploaded or saved.

## Production follow-up

Before public deployment, confirm reuse terms and automated-access expectations with the City of Milwaukee, add moderation and expiration for community reports, complete accessibility testing, and have ComForce MKE review all public resource listings. True push notifications require a backend job and a development build; the MVP intentionally provides in-app alerts while it is open.
