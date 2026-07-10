"""API router configuration.

This module sets up the main API router and includes all sub-routers:
health, the dashboard-facing product domain (organizations, contacts), and
signal ingestion (webhooks + manual signals) for the Takeoff Runtime agent
loop — see `docs/architecture.md`.
"""

from fastapi import APIRouter

from app.api.routers.contacts import router as contacts_router
from app.api.routers.health import router as health_router
from app.api.routers.organizations import router as organizations_router
from app.api.routers.signals import router as signals_router

api_router = APIRouter()

# Include routers
api_router.include_router(health_router, tags=["Health"])
api_router.include_router(organizations_router, tags=["Organizations"])
api_router.include_router(contacts_router, tags=["Contacts"])
api_router.include_router(signals_router, tags=["Signals"])
