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

## Production follow-up

Before public deployment, confirm reuse terms and refresh behavior with the City of Milwaukee, add moderation and expiration for community reports, complete accessibility testing, and have ComForce MKE review all public resource listings.
