"""Hunger Task Force's emergency-food map (hungertaskforce.org/get-help/
emergency-food): food pantries, meal sites, WIC sites, formula pantries,
mobile-market stops and Stockbox sites, from the map's public KML, as
meal-program resources. Most sites have only an address, so they're placed
with the Census Bureau's batch geocoder (keyless).

Redistribution rights aren't stated on the map; docs/real-data-sources.md
asks for written permission before a production release.
"""

import csv
import hashlib
import io
import re
import xml.etree.ElementTree as ElementTree
from collections.abc import Iterator

import httpx

from model.enums import CaseCategory
from model.imported import ImportedResource, try_build

SOURCE = "hunger_task_force"
KML_URL = "https://www.google.com/maps/d/kml?mid=1n6nH6nEuSIKBK01RLMJXvWva_WoeKM-X&forcekml=1"
GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
USER_AGENT = "hacksgiving-data-loader/1.0"
_NS = {"k": "http://www.opengis.net/kml/2.2"}
_BREAK = re.compile(r"\s*\n\s*")


class HungerTaskForceError(RuntimeError):
    """A failed request or an unreadable map."""


def client(timeout: float, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, headers={"User-Agent": USER_AGENT}, transport=transport,
                             follow_redirects=True)


async def fetch_sites(http: httpx.AsyncClient) -> list[ImportedResource]:
    try:
        response = await http.get(KML_URL)
    except httpx.HTTPError as exc:
        raise HungerTaskForceError(f"Map request failed: {type(exc).__name__}") from None
    if response.status_code != 200:
        raise HungerTaskForceError(f"The map answered {response.status_code}")
    sites = list(parse_sites(response.content))
    return await geocode(http, sites)


def _data(placemark: ElementTree.Element) -> dict[str, str]:
    values = {}
    for item in placemark.findall("k:ExtendedData/k:Data", _NS):
        value = item.findtext("k:value", default="", namespaces=_NS)
        values[(item.get("name") or "").strip().lower()] = _BREAK.sub("\n", value).strip()
    return values


def parse_sites(content: bytes) -> Iterator[ImportedResource]:
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError:
        raise HungerTaskForceError("The map's KML couldn't be read") from None
    for folder in root.iter(f"{{{_NS['k']}}}Folder"):
        layer = (folder.findtext("k:name", default="", namespaces=_NS) or "").strip()
        for placemark in folder.findall("k:Placemark", _NS):
            name = (placemark.findtext("k:name", default="", namespaces=_NS) or "").strip()
            data = _data(placemark)
            street, zip_code = data.get("address", ""), data.get("zip code", "")
            city = data.get("city") or "Milwaukee"
            if not name or not street:
                continue
            programs = [p for p in data.get("program", "").split("\n") if p]
            about = [", ".join(programs) or layer]
            for key, label in (("who is eligible", "Who can come"), ("type of food", "Food"),
                               ("services offered", "Services"), ("notes", ""), ("note", "")):
                if data.get(key):
                    about.append(f"{label}: {data[key]}" if label else data[key])
            if data.get("zip code service area"):
                about.append(f"Serves ZIP codes {data['zip code service area']}.")
            hours = " · ".join(p for p in (data.get("operation days"), data.get("operation time")) if p) or None
            latitude = longitude = None
            point = placemark.findtext("k:Point/k:coordinates", default="", namespaces=_NS).strip()
            if point:
                try:
                    longitude, latitude = (float(v) for v in point.split(",")[:2])
                except ValueError:
                    latitude = longitude = None
            # The map has no ids: a site is its layer, name and address.
            key = hashlib.sha1(f"{layer}|{name}|{street}|{zip_code}".lower().encode()).hexdigest()[:20]
            item = try_build(
                ImportedResource,
                source=SOURCE,
                external_id=key,
                name=name,
                category=CaseCategory.MEAL_PROGRAMS,
                description=" ".join(f"{a.rstrip('.')}." for a in about if a),
                address=", ".join(p for p in (street, f"{city}, WI {zip_code}".strip()) if p),
                neighborhood=city,
                phone=data.get("phone number"),
                hours=hours,
                latitude=latitude,
                longitude=longitude,
            )
            if item:
                yield item


async def geocode(http: httpx.AsyncClient, sites: list[ImportedResource]) -> list[ImportedResource]:
    """Fills in coordinates for sites without them, in one batch request. A
    geocoder failure leaves them unplaced rather than failing the source."""
    missing = [s for s in sites if s.latitude is None and s.address]
    if not missing:
        return sites
    lines = io.StringIO()
    writer = csv.writer(lines)
    for index, site in enumerate(missing):
        street, _, rest = (site.address or "").partition(", ")
        zip_code = rest.rsplit(" ", 1)[-1] if rest else ""
        writer.writerow([index, street, site.neighborhood or "Milwaukee", "WI", zip_code])
    try:
        response = await http.post(GEOCODER_URL, data={"benchmark": "Public_AR_Current"},
                                   files={"addressFile": ("addresses.csv", lines.getvalue(), "text/csv")},
                                   timeout=120)
    except httpx.HTTPError:
        return sites
    if response.status_code != 200:
        return sites
    placed: dict[int, tuple[float, float]] = {}
    for row in csv.reader(io.StringIO(response.text)):
        if len(row) >= 6 and row[2] == "Match" and row[0].isdigit():
            try:
                longitude, latitude = (float(v) for v in row[5].split(","))
            except ValueError:
                continue
            placed[int(row[0])] = (latitude, longitude)
    located = {id(site): placed[i] for i, site in enumerate(missing) if i in placed}
    return [
        site.model_copy(update={"latitude": located[id(site)][0], "longitude": located[id(site)][1]})
        if id(site) in located else site
        for site in sites
    ]
