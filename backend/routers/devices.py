from fastapi import APIRouter
from backend.audio import list_loopback_devices

router = APIRouter()


@router.get("/api/devices")
def get_devices():
    """List available audio loopback devices for the UI device picker."""
    return {"devices": list_loopback_devices()}
