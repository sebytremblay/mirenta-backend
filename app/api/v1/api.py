"""API v1 router configuration.

This module sets up the main API router and includes all sub-routers for the
product domain (organizations, knowledge, contacts, conversations, appointments).
"""

from fastapi import APIRouter

from app.api.v1.appointments import router as appointments_router
from app.api.v1.contacts import router as contacts_router
from app.api.v1.conversations import router as conversations_router
from app.api.v1.knowledge import router as knowledge_router
from app.api.v1.organizations import router as organizations_router
from app.core.logging import logger

api_router = APIRouter()

# Include routers
api_router.include_router(organizations_router, tags=["Organizations"])
api_router.include_router(knowledge_router, tags=["Knowledge"])
api_router.include_router(contacts_router, tags=["Contacts"])
api_router.include_router(conversations_router, tags=["Conversations"])
api_router.include_router(appointments_router, tags=["Appointments"])

@api_router.get("/health")
async def health_check():
    """Health check endpoint.

    Returns:
        dict: Health status information.
    """
    logger.info("health_check_called")
    return {"status": "healthy", "version": "1.0.0"}
