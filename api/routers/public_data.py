"""Public data from official sources, kept current by the data loader
(docs/data-loader.md). No sign-in: it's public, and the safety map shows it
before anyone has an account. Every response is already generalized."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import get_public_data_service
from models.public_data import (
    CommunityMeasure,
    CrimeTrendPoint,
    DispatchCall,
    IncidentPoint,
    SourceHealth,
    TractCount,
    TransitNearby,
    WeatherAlert,
)
from services.public_data import PublicDataService

router = APIRouter(prefix="/public-data", tags=["public data"])

Service = Annotated[PublicDataService, Depends(get_public_data_service)]


@router.get("/incidents", response_model=list[IncidentPoint])
async def incidents(
    service: Service,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
    limit: Annotated[int, Query(ge=1, le=20000)] = 5000,
) -> list[IncidentPoint]:
    """MPD-reviewed incidents (NIBRS, updated daily, may lag weeks), newest
    first, each at about 1 km and with the app's map category."""
    return await service.incidents(days, limit)


@router.get("/incidents/by-tract", response_model=list[TractCount])
async def incidents_by_tract(
    service: Service,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
    offense_code: Annotated[str | None, Query(max_length=4, description="A NIBRS code, e.g. 13A.")] = None,
) -> list[TractCount]:
    """Incident counts per census tract; tracts with fewer than 5 are left out."""
    return await service.tract_counts(days, offense_code)


@router.get("/calls", response_model=list[DispatchCall])
async def calls(
    service: Service,
    source: Annotated[str | None, Query(pattern="^(mpd|mfd)_calls$")] = None,
    hours: Annotated[int, Query(ge=1, le=48)] = 6,
    limit: Annotated[int, Query(ge=1, le=1000)] = 300,
) -> list[DispatchCall]:
    """Delayed dispatch calls (MPD 30-90 minutes, MFD 15-105): not confirmed
    incidents. Sensitive call types are never listed."""
    return await service.calls(source, hours, limit)


@router.get("/transit/nearby", response_model=TransitNearby)
async def transit_nearby(
    service: Service,
    latitude: Annotated[float, Query(ge=42.5, le=43.5)],
    longitude: Annotated[float, Query(ge=-88.5, le=-87.5)],
    radius_m: Annotated[float, Query(ge=50, le=2000)] = 500,
    limit: Annotated[int, Query(ge=1, le=10)] = 3,
) -> TransitNearby:
    """The nearest MCTS stops, their next arrivals and any service alerts."""
    return await service.transit_near(latitude, longitude, radius_m, limit)


@router.get("/weather-alerts", response_model=list[WeatherAlert])
async def weather_alerts(service: Service) -> list[WeatherAlert]:
    """National Weather Service alerts in effect for Milwaukee County."""
    return await service.weather_alerts()


@router.get("/community-needs", response_model=list[CommunityMeasure])
async def community_needs(
    service: Service,
    tract_geoid: Annotated[str | None, Query(pattern=r"^\d{11}$")] = None,
    measure_id: Annotated[str | None, Query(max_length=20)] = None,
) -> list[CommunityMeasure]:
    """CDC PLACES modeled estimates of health-related social needs by tract
    (yearly). Context only: never for prioritizing people."""
    return await service.community_measures(tract_geoid, measure_id)


@router.get("/crime-trends", response_model=list[CrimeTrendPoint])
async def crime_trends(
    service: Service,
    offense: Annotated[str | None, Query(max_length=40)] = None,
) -> list[CrimeTrendPoint]:
    """FBI monthly totals and rates for MPD, Wisconsin and the US."""
    return await service.crime_trends(offense)


@router.get("/sources", response_model=list[SourceHealth])
async def sources(service: Service) -> list[SourceHealth]:
    """Each source's latest loader run and when it last succeeded."""
    return await service.sources()
