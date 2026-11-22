"""Federal public data (docs/real-data-sources.md):

* National Weather Service active alerts for Milwaukee County's zones
* CDC PLACES health-related social needs by census tract
* FBI Crime Data Explorer monthly totals for the Milwaukee Police Department

All public; the FBI's API takes an api.data.gov key when one is set and
answers without one too. Parsing is separate from fetching.
"""

from collections.abc import Iterable, Iterator, Mapping
from datetime import UTC, date, datetime
from typing import Any

import httpx

from client.dates import parse_datetime
from model.public_data import ImportedCommunityMeasure, ImportedCrimeTrend, ImportedWeatherAlert

USER_AGENT = "hacksgiving-data-loader/1.0"
NWS_SOURCE = "nws_alerts"
CDC_SOURCE = "cdc_places"
FBI_SOURCE = "fbi_cde"

NWS_URL = "https://api.weather.gov/alerts/active"
CDC_URL = "https://data.cdc.gov/resource/cwsq-ngmh.json"
FBI_URL = "https://cde.ucr.cjis.gov/LATEST/summarized/agency/{ori}/{offense}"
MILWAUKEE_ORI = "WIMPD0000"
FBI_OFFENSES = ("violent-crime", "homicide", "aggravated-assault", "robbery")


class FederalDataError(RuntimeError):
    """A failed request, without the response body."""


def client(timeout: float, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT}, transport=transport,
                             follow_redirects=True)


async def _json(http: httpx.AsyncClient, url: str, params: Mapping[str, Any], **headers: str) -> Any:
    try:
        response = await http.get(url, params=params, headers=headers or None)
    except httpx.HTTPError as exc:
        raise FederalDataError(f"Request to {httpx.URL(url).host} failed: {type(exc).__name__}") from None
    if response.status_code != 200:
        raise FederalDataError(f"{httpx.URL(url).host} answered {response.status_code}")
    return response.json()


# --- NWS ------------------------------------------------------------------------------


async def fetch_weather_alerts(http: httpx.AsyncClient, *, zones: Iterable[str]) -> list[ImportedWeatherAlert]:
    found: dict[str, ImportedWeatherAlert] = {}
    for zone in zones:
        body = await _json(http, NWS_URL, {"zone": zone}, Accept="application/geo+json")
        for alert in parse_weather_alerts(body):
            found.setdefault(alert.external_id, alert)
    return list(found.values())


def parse_weather_alerts(body: Mapping[str, Any]) -> Iterator[ImportedWeatherAlert]:
    for feature in body.get("features") or []:
        p = feature.get("properties") or {}
        if not p.get("id") or not p.get("event"):
            continue
        yield ImportedWeatherAlert(
            external_id=str(p["id"]),
            event=p["event"],
            headline=p.get("headline"),
            severity=p.get("severity"),
            urgency=p.get("urgency"),
            certainty=p.get("certainty"),
            area=p.get("areaDesc"),
            description=p.get("description") or "",
            instruction=p.get("instruction"),
            url=p.get("@id") or feature.get("id"),
            effective_at=parse_datetime(p.get("effective") or p.get("onset")),
            expires_at=parse_datetime(p.get("ends") or p.get("expires")),
        )


# --- CDC PLACES -------------------------------------------------------------------------


async def fetch_community_measures(http: httpx.AsyncClient, *, county_fips: str) -> list[ImportedCommunityMeasure]:
    params = {
        "$select": "locationname,measure,measureid,data_value,low_confidence_limit,high_confidence_limit,"
                   "totalpopulation,year",
        "$where": f"countyfips='{county_fips}' AND category='Health-Related Social Needs'",
        "$limit": "50000",
    }
    return list(parse_community_measures(await _json(http, CDC_URL, params)))


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_community_measures(rows: list[Mapping[str, Any]]) -> Iterator[ImportedCommunityMeasure]:
    for r in rows:
        tract, measure_id, year = r.get("locationname"), r.get("measureid"), r.get("year")
        if not tract or not measure_id or not str(year or "").isdigit():
            continue
        population = _number(r.get("totalpopulation"))
        yield ImportedCommunityMeasure(
            external_id=f"{tract}|{measure_id}|{year}",
            tract_geoid=str(tract), measure_id=str(measure_id), measure=str(r.get("measure") or measure_id),
            year=int(str(year)), value=_number(r.get("data_value")), low=_number(r.get("low_confidence_limit")),
            high=_number(r.get("high_confidence_limit")),
            population=int(population) if population is not None else None,
        )


# --- FBI Crime Data Explorer ----------------------------------------------------------


async def fetch_crime_trends(
    http: httpx.AsyncClient, *, api_key: str, months: int, today: date | None = None
) -> list[ImportedCrimeTrend]:
    """The last `months` months of MPD totals and rates per offense, next to
    Wisconsin's and the country's rates."""
    end = (today or datetime.now(UTC).date()).replace(day=1)
    start_month = end.month - months
    start = date(end.year + (start_month - 1) // 12, (start_month - 1) % 12 + 1, 1)
    found: list[ImportedCrimeTrend] = []
    for offense in FBI_OFFENSES:
        body = await _json(http, FBI_URL.format(ori=MILWAUKEE_ORI, offense=offense), {
            "from": start.strftime("%m-%Y"), "to": end.strftime("%m-%Y"), "type": "totals", "API_KEY": api_key,
        })
        found.extend(parse_crime_trends(body, offense))
    return found


def parse_crime_trends(body: Mapping[str, Any], offense: str) -> Iterator[ImportedCrimeTrend]:
    refreshed = (((body.get("cde_properties") or {}).get("last_refresh_date") or {}).get("UCR"))
    refreshed_at = None
    if refreshed:
        try:
            refreshed_at = datetime.strptime(refreshed, "%m/%d/%Y").replace(tzinfo=UTC)
        except ValueError:
            refreshed_at = None
    offenses = body.get("offenses") or {}
    for measure, block in (("actual", offenses.get("actuals") or {}), ("rate", offenses.get("rates") or {})):
        for series, values in block.items():
            for month_key, value in (values or {}).items():
                try:
                    month = datetime.strptime(month_key, "%m-%Y").date()
                except ValueError:
                    continue
                yield ImportedCrimeTrend(
                    external_id=f"{offense}|{measure}|{series}|{month:%Y-%m}",
                    offense=offense, measure=measure, series=series, month=month, value=_number(value),
                    source_refreshed_at=refreshed_at,
                )
