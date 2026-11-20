from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Liveness only: no database round-trip and no deployment metadata."""
    return {"status": "healthy"}
