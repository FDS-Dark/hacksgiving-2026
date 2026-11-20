# Public safety data used by NearMKE

The external mobile MVP reads Milwaukee Police Department monthly public crime layers from the City of Milwaukee ArcGIS service:

- Service: `https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/MPD/MPD_Monthly/MapServer`
- Layers used: homicide (0), sex offense (2), robbery (4), and assault (9)
- Window: records whose `DAYSPASSED` value is 30 or less (the service itself is a monthly view)
- Fields requested: only `DAYSPASSED` and point geometry

## Privacy decisions

- The query requests `geometryPrecision=2`, which generalizes coordinates before the app receives them.
- Incident numbers, exact addresses, victim details, names, and narrative fields are not requested or displayed.
- The map describes historical patterns. It does not score neighborhoods or predict people who may commit violence.
- “Domestic violence” is not inferred from other fields because the public service does not expose a reliable category for it.
- MVP community reports select a broad neighborhood centroid and remain in local app state. They are clearly labeled as unverified observations.

## Recent calls and nearby alerts

The Alerts tab reads the official MPD dispatched calls page at `https://itmdapps.milwaukee.gov/MPDCallData/`.

- MPD says the page refreshes every five minutes and shows calls 30–90 minutes after dispatch.
- Calls for service are not confirmed crimes. The app keeps them visually and statistically separate from the 30-day incident heatmap.
- Only a narrow set of safety-related call descriptions with embedded coordinates is shown. Generic 911 calls and calls without coordinates are omitted.
- Coordinates from the calls page are rounded before display. The phone's foreground location is used only in memory to calculate distance and is not uploaded or saved.
- The client-side HTML parser is appropriate for a weekend prototype, but a production service should ingest the feed server-side with permission from MPD, monitor schema changes, deduplicate calls, and publish a stable sanitized API.

## Production follow-up

Before public deployment, confirm reuse terms and automated-access expectations with the City of Milwaukee, add moderation and expiration for community reports, complete accessibility testing, and have ComForce MKE review all public resource listings. True push notifications require a backend job and a development build; the MVP intentionally provides in-app alerts while it is open.
