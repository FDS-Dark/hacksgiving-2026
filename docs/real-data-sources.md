# Real Data Sources and Ingestion Plan

Status: Verified November 21, 2026

ComForce should use official, attributable data and fail visibly when a source is unavailable. It must never replace missing external data with synthetic records. The strongest immediate stack is Milwaukee NIBRS for reviewed incidents, MPD calls for recent unverified signals, official geographic boundaries for privacy-safe aggregation, and MCTS data for real resource accessibility.

## Immediate decisions

1. Replace the broken MPD Monthly ArcGIS dependency with the City of Milwaukee CKAN NIBRS API.
2. Remove every fabricated fallback point from the public-safety map.
3. Move MPD calls ingestion behind the ComForce API instead of fetching exact addresses on every phone.
4. Keep reviewed incidents, dispatch signals, ComForce cases, and community observations as distinct data types.
5. Generalize external locations during ingestion and display source, freshness, and verification state everywhere.
6. Use official resource listings only. A directory listing must never be presented as real-time shelter or service availability.

## Source priority

| Priority | Source | Freshness | Intended use | Access status |
|---|---|---|---|---|
| P0 | Milwaukee NIBRS CKAN API | Daily | Reviewed incident history and pattern analysis | Public, unauthenticated, CC BY |
| P0 | MPD dispatched calls | Every five minutes; delayed 30 to 90 minutes | Recent unverified operational signals | Public page; production reuse permission should be confirmed |
| P0 | Official district and tract polygons | Periodic | Privacy-safe aggregation and filtering | Public City and Census APIs |
| P1 | MFD dispatched calls | Current calls delayed 15 to 105 minutes | Fire, EMS, rescue, and access context | Public page; production reuse permission should be confirmed |
| P1 | MCTS GTFS and GTFS-Realtime | Schedule plus live feeds | Resource transit access, arrivals, and service alerts | Public under MCTS developer terms |
| P1 | National Weather Service alerts | Live | Weather and resource-access interruptions | Public-domain federal API |
| P1 | CDC PLACES | Annual | Community-needs and coverage context | Public-domain Socrata API |
| P1 | FBI Crime Data Explorer | Monthly and annual | Historical Milwaukee and Wisconsin comparisons | Public API; cache and validate completeness |
| P2 | 211 Wisconsin and IMPACT 211 | Continually curated | Full social-service directory | Permissioned API; do not scrape |
| P2 | Hunger Task Force emergency-food map | Reportedly updated daily | Food locations and published schedules | Public map; request written reuse permission |

## Milwaukee NIBRS

### Current records

Official dataset:

<https://data.milwaukee.gov/dataset/wibr>

CKAN resource ID:

```text
87843297-a6fa-46d4-ba5d-cb342fb2d3bb
```

Basic API request:

```text
https://data.milwaukee.gov/api/3/action/datastore_search?resource_id=87843297-a6fa-46d4-ba5d-cb342fb2d3bb&limit=1000&offset=0
```

The source is updated daily, is licensed CC BY, requires no authentication, and currently contains records covering 2024 through 2026. Useful fields are:

```text
Case_Number
Incident_Date
Incident_Last_Edited
Offense_Last_Edited
Police_District
Offense_All
Location_All
Address_Longitude
Address_Latitude
Weapon_Used_All
```

Violence-oriented query:

```sql
SELECT
  "Case_Number",
  "Incident_Date",
  "Police_District",
  "Offense_All",
  "Address_Longitude",
  "Address_Latitude",
  "Weapon_Used_All"
FROM "87843297-a6fa-46d4-ba5d-cb342fb2d3bb"
WHERE (
  "Offense_All" LIKE '%09A%' OR
  "Offense_All" LIKE '%13A%' OR
  "Offense_All" LIKE '%120%' OR
  "Offense_All" LIKE '%520%'
)
ORDER BY "Incident_Date" DESC
LIMIT 5000
```

Submit encoded SQL through:

```text
https://data.milwaukee.gov/api/3/action/datastore_search_sql?sql=<URL-ENCODED-SQL>
```

Relevant NIBRS codes include:

- `09A`: murder and non-negligent manslaughter
- `120`: robbery
- `13A`: aggravated assault
- `520`: weapons-law violation

`Offense_All` may contain several semicolon-separated codes. A weapons-law record does not prove that a shooting occurred.

### Historical records

Official dataset:

<https://data.milwaukee.gov/dataset/wibrarchive>

Resource ID:

```text
395db729-a30a-4e53-ab66-faeb5e1899c8
```

The historical resource covers 1991 through 2023 and uses the same general schema.

### Ingestion rules

- Upsert by `Case_Number`.
- Increment using `Offense_Last_Edited` with a 7 to 14 day overlap.
- Periodically reconcile the source because edited or removed records may not appear as new events.
- Reject incident dates later than ingestion time plus a small tolerance. The current source contains at least one erroneous future-dated record.
- Validate coordinates against Milwaukee geographic bounds.
- Preserve original offense codes and normalize them into a child table.
- Retain the source case number internally for deduplication, not public display.
- Attribute MPD and the City of Milwaukee under CC BY.
- Label the data `MPD reviewed reported incidents · updated daily · may lag several weeks`.
- Never infer a victim, conviction, or neighborhood danger level from a record.

## MPD dispatched calls

Official source:

<https://itmdapps.milwaukee.gov/MPDCallData/>

The page refreshes every five minutes and displays calls dispatched approximately 30 to 90 minutes earlier. Fields include call number, date and time, location, police district, nature, and status. A call can appear multiple times with different statuses.

Appropriate categories include ShotSpotter, shots fired, subject with a weapon, battery or assault, welfare checks, resource needed, and missing persons. Every row remains a dispatch classification rather than a confirmed incident.

### Handling rules

- Poll the canonical page server-side every five minutes.
- Upsert by call number and retain the set of observed statuses.
- Label each record `Delayed dispatch call · not a confirmed incident`.
- Remove apartment numbers, unit details, and residential landmarks immediately.
- Generalize coordinates before storage.
- Do not retain raw HTML or exact addresses.
- Suppress public display of domestic violence, sexual assault, suicide or self-harm, trafficking, juvenile, welfare-check, and missing-person records.
- Expire records after an agreed short period.
- Do not use this feed for response-time calculations because status-update timestamps are not provided.
- Confirm automated polling, retention, and republication terms with MPD or the Department of Emergency Communications before production use.

The official rolling 60-day Tableau dashboard is available through the [MPD Data Tools page](https://mkepdpio.org/data-tools/), but no supported machine-readable export was verified.

## MFD dispatched calls

Official source:

<https://itmdapps.milwaukee.gov/MFDCallData/index.jsp>

The page exposes real fire and EMS calls delayed approximately 15 to 105 minutes. Fields include call ID, date and time, address, city, nature, and disposition.

Use MFD data only as fire, EMS, rescue, hazardous-material, or access context. Do not infer that an EMS call represents violence, overdose, or a particular medical condition. Exact EMS addresses must remain internal or be generalized.

## Geographic boundaries

### MPD districts

Seven official district polygons:

```text
https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/MPD/MPD_geography/MapServer/2/query?where=1%3D1&outFields=POLICE&returnGeometry=true&outSR=4326&f=geojson
```

Use MPD districts for operational grouping and stable joins with calls-for-service data.

### Census tracts

Official City 2020 tract polygons:

```text
https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/census/Census2020/MapServer/0/query?where=1%3D1&outFields=GEOID%2CNAME&returnGeometry=true&outSR=4326&f=geojson
```

Use `GEOID` to join CDC PLACES and other Census-based indicators.

### Neighborhoods

```text
https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/AGO/neighborhoods/MapServer/0/query?where=1%3D1&outFields=NBHD_ID%2CNEIGHBORHD&returnGeometry=true&outSR=4326&f=geojson
```

These boundaries are useful as human-readable labels but are legacy boundaries and are not continuously maintained or authoritative organization boundaries.

### Aldermanic districts

```text
https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/election/election_geography/MapServer/1/query?where=1%3D1&outFields=DISTRICT%2CDISTRICT_LABEL%2CALDERPERSON&returnGeometry=true&outSR=4326&f=geojson
```

Use these for outreach and accountability routing, never risk scoring.

### Public-map rules

- Aggregate external incidents to a tract, neighborhood, district, or 500 to 1,000 meter grid.
- Suppress any public cell with fewer than five records.
- Generalize time to day or week before combining it with small-area geography.
- Never generate demographic or neighborhood risk scores.
- Staff-only exact coordinates still require role-based access and audit logging.

## MCTS transit data

Official feeds:

```text
Static GTFS
https://kamino.mcts.org/gtfs/google_transit.zip

Trip updates
https://realtime.ridemcts.com/gtfsrt/trips

Vehicle positions
https://realtime.ridemcts.com/gtfsrt/vehicles

Service alerts
https://realtime.ridemcts.com/gtfsrt/alerts
```

Developer terms:

<https://www.ridemcts.com/policies/developer-terms>

The verified feed contained 49 routes, 3,694 stops, 18,479 trips, and current realtime updates. MCTS permits reuse subject to its terms, including attribution, displaying the source update date and schedule-validity date, and stating that the product is not sponsored or operated by MTS or MCTS.

### Recommended first feature

Add a Transit Access block to each resource:

```text
0.2 miles from Route 30 · next bus in 8 minutes · service alert active
```

The first implementation should provide nearby stops, routes, next departures, and active alerts. Do not claim complete point-to-point travel time until transfer-aware routing is implemented.

## National Weather Service alerts

Official requests for Milwaukee:

```text
https://api.weather.gov/alerts/active?point=43.0389,-87.9065
https://api.weather.gov/alerts/active?zone=WIC079
https://api.weather.gov/alerts/active?zone=WIZ066
```

Use NWS alerts for heat, cold, severe weather, shelter, and transportation disruption context. Send a descriptive `User-Agent`, use HTTP caching, and poll every one to two minutes rather than treating the API as a sole life-safety channel.

## CDC PLACES

Official dataset:

<https://data.cdc.gov/500-Cities-Places/PLACES-Local-Data-for-Better-Health-Census-Tract-D/cwsq-ngmh>

Milwaukee County social-needs query:

```text
https://data.cdc.gov/resource/cwsq-ngmh.json?$select=locationname,measure,measureid,data_value,data_value_type,low_confidence_limit,high_confidence_limit,totalpopulation,geolocation,year&$where=countyfips='55079' AND category='Health-Related Social Needs'&$limit=5000
```

Useful measures include housing insecurity, food insecurity, unreliable transportation, utility shut-off threats, social isolation, mental distress, and insurance access. These are annual modeled tract estimates. Use them for community context and resource coverage, never for individual prioritization or danger scoring.

## FBI Crime Data Explorer

Milwaukee Police Department ORI:

```text
WIMPD0000
```

Example requests:

```text
https://cde.ucr.cjis.gov/LATEST/summarized/agency/WIMPD0000/violent-crime?from=01-2024&to=12-2025&type=totals&API_KEY=

https://cde.ucr.cjis.gov/LATEST/summarized/agency/WIMPD0000/homicide?from=01-2024&to=12-2025&type=totals&API_KEY=

https://cde.ucr.cjis.gov/LATEST/summarized/agency/WIMPD0000/aggravated-assault?from=01-2024&to=12-2025&type=totals&API_KEY=
```

Use FBI CDE for completed-year trend comparisons, not live incidents or map markers. Display `last_refresh_date`, reject or flag incomplete months, and never interpret missing submissions as a crime decline.

## Social-service resources

### 211 Wisconsin and IMPACT 211

Public directory:

<https://211wisconsin.communityos.org/>

Supported API platform:

<https://apiportal.211.org/>

Local contact:

```text
IMPACT 211 Resource Department
resourcechange@impactinc.org
414-302-6621
```

The full resource directory should be obtained through authorized 211 National Data Platform Search, Query, or Export access. Do not scrape CommunityOS. Request explicit terms for caching, attribution, refresh frequency, public display, AI-assisted routing, and downstream redistribution.

Until access is approved, import a small reviewed collection from official Milwaukee and Wisconsin pages. Preserve source wording and URLs, record `retrieved_at`, and leave `last_verified_at` null unless the publisher actually provides a verification date.

### Shelter availability

No public real-time Milwaukee shelter-bed feed was found. Shelter cards should say:

```text
Coordinated entry required · Call 211 · Availability must be confirmed
```

Directory presence does not indicate open beds. Never publish confidential domestic-violence shelter locations.

### Hunger Task Force

Official emergency-food page:

<https://www.hungertaskforce.org/get-help/emergency-food/>

Current public KML:

```text
https://www.google.com/maps/d/kml?mid=1n6nH6nEuSIKBK01RLMJXvWva_WoeKM-X&forcekml=1
```

The map is reported as updated daily and contains pantries, meal sites, WIC sites, formula pantries, mobile-market stops, and Stockbox locations. Because redistribution rights are not stated, embed or deep-link it and request written permission before persisting and republishing the records.

## CVI outcome benchmarks

Use these sources as dated contextual evidence, not operational feeds or claims about ComForce outcomes:

- [Milwaukee Homicide Review Commission dashboards](https://www.mcw.edu/departments/epidemiology/research/milwaukee-homicide-review-commission/reports/dashboards)
- [414LIFE Phase 2 evaluation](https://www.mcw.edu/-/media/MCW/Departments/Comprehensive-Injury-Center/414LIFE/414LIFE-Phase2-Evaluation.pdf)
- [Milwaukee County DHHS 2025 annual report](https://county.milwaukee.gov/files/county/DHHS/About/DHHS_AR_2025.pdf)

The MHRC dashboard is refreshed at least monthly, but no supported machine-readable export was verified. Request permission and a recurring export from `mhrc@mcw.edu` before building automated ingestion.

## Data model

Every external record should contain:

```text
source_name
source_url
source_record_id
dataset_id
source_updated_at
retrieved_at
license_or_terms_url
terms_snapshot_date
verification_state
original_precision
display_precision
transformation_version
expires_at
last_successful_refresh_at
stale_after
ingestion_error
```

Recommended source-specific tables:

### External incidents

For reviewed, durable records such as NIBRS:

```text
source
external_id
incident_at
source_last_edited_at
district
generalized_area_id
internal_latitude
internal_longitude
offense_codes
weapon_codes
source_url
retrieved_at
```

### External signals

For transient sources such as MPD and MFD calls:

```text
source
external_id
occurred_at
category
status
district
generalized_area_id
public_area
internal_latitude
internal_longitude
observed_at
expires_at
source_url
```

### Resources

Add these fields before importing a large directory:

```text
source_system
source_record_id
source_url
retrieved_at
last_verified_at
verification_status
eligibility
intake_process
documents_required
fees
languages
service_area
taxonomy_codes
raw_source
inactive_at
```

Do not set `last_verified_at` to the ingestion time. Those values represent different facts.

## Twenty-hour ingestion order

1. Remove fabricated fallback points and hide fictional sample resources from normal product views.
2. Add source-health, provenance, stale-state, and explicit unavailable-state UI.
3. Implement NIBRS incremental ingestion and validation.
4. Add district and tract boundary ingestion and spatial joins.
5. Implement server-side MPD calls ingestion with immediate generalization and expiration.
6. Render separate layers for reviewed NIBRS incidents, unverified dispatch signals, ComForce cases, and reviewed resources.
7. Add MCTS nearest-stop, next-departure, and alert information.
8. Add NWS alerts if time remains.
9. Add CDC PLACES only after operational sources are stable.
10. Begin IMPACT 211 authorization in parallel; do not block the demo on receiving access.

## Test gates

- A failed source must display zero records, never fallback data.
- Detect ArcGIS and CKAN error envelopes even when the HTTP status is 200.
- Repeated synchronization must create no duplicates.
- A repeated call must update the existing status history.
- Stored MPD and MFD signals must contain no exact address, apartment, raw HTML, or unrestricted free text.
- Coordinate-generalization tests must cover boundary cases.
- Expired signals must disappear from operational views.
- One failed source must not hide successful independent sources.
- Missing or reordered HTML columns must raise a monitored schema-drift error.
- Future dates and out-of-bounds coordinates must be rejected.
- Source timestamps and freshness states must be visible in the API and UI.

## Real-data demo path

1. A real delayed MPD call appears as an unconfirmed signal.
2. The ingestion process generalizes it into an MPD district and census tract.
3. Daily MPD-reviewed NIBRS records provide historical context for that generalized area.
4. A worker decides whether to associate the signal with a ComForce response; no automatic case creation occurs.
5. ComForce recommends a real reviewed resource.
6. MCTS data shows whether that resource is transit-accessible at the current time.
7. The interface shows the source, retrieval time, precision reduction, and verification state for every external fact.

## Perplexity research questions

1. Find a documented machine-readable API or permitted download for Milwaukee MPD's `CallsforService_17828297832160` Tableau dashboard. Use only official City, MPD, Tableau, or ArcGIS sources. Verify the endpoint and report its fields, update cadence, license, and download restrictions.

2. Find official City of Milwaukee terms governing automated polling, retention, transformation, and republication of `https://itmdapps.milwaukee.gov/MPDCallData/`. Provide primary-source terms or the correct City or MPD data-owner contact.

3. Find primary-source documentation explaining why Milwaukee's current `wibr` CKAN resource includes 2024 through 2026 records and identify any schema or counting changes caused by the February 2024 CAD transition.

4. Find an official machine-readable feed for verified Milwaukee fatal and nonfatal shootings, including outcomes and generalized geography. Exclude Gun Violence Archive and other third-party collections.

5. Confirm whether 211 Wisconsin currently contributes its directory to the 211 National Data Platform V2. Report pricing, approval process, rate limits, caching, attribution, and redistribution rules from primary sources.

6. Find an official machine-readable feed and explicit reuse license for Hunger Task Force's current Milwaukee emergency-food map. Verify its update cadence and whether nonprofit applications may cache its KML.

7. Find official MCTS guidance governing polling rates for the unauthenticated GTFS-Realtime feeds and confirm whether the general developer terms apply to those endpoints.

8. Find a current official CSV, JSON, or supported export behind the Milwaukee Homicide Review Commission homicide and nonfatal-shooting dashboard, including update cadence and reuse terms.
