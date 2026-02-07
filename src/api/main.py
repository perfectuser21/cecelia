"""Cecelia Support Service - Patrol, Agent Monitoring, Orchestration.

Note: Brain API (/api/brain/*) runs on Node.js Brain (port 5221).
Note: Intelligence layer (parser, scheduler, detector, semantic search) removed — superseded by Node.js Brain.
This service provides supporting operational capabilities only.
"""

import logging
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI

from src.db.pool import Database, init_database, close_database
from src.api.patrol_routes import router as patrol_router, set_database as set_patrol_database
from src.api.agent_routes import router as agent_router, set_database as set_agent_database
from src.api.orchestrator_routes import router as orchestrator_router, set_database as set_orchestrator_database
from src.api.cecelia_routes import router as cecelia_router, set_database as set_cecelia_database
from src.state.patrol import ensure_patrol_table
from src.state.agent_monitor import ensure_agent_tables

load_dotenv()

logger = logging.getLogger(__name__)

database: Optional[Database] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global database

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info("Initializing Cecelia Support Service...")

    # Initialize Database (State Layer)
    try:
        database = await init_database()
        set_patrol_database(database)
        set_agent_database(database)
        set_orchestrator_database(database)
        set_cecelia_database(database)
        await ensure_patrol_table(database)
        await ensure_agent_tables(database)
        logger.info("Database connection initialized")
    except Exception as e:
        logger.warning(f"Database connection failed (State Layer disabled): {e}")
        database = None

    logger.info("Cecelia Support Service initialized")

    yield

    # Cleanup
    if database is not None:
        await close_database()
        logger.info("Database connection closed")

    logger.info("Shutting down Cecelia Support Service...")


app = FastAPI(
    title="Cecelia Support Service",
    description="Patrol, Agent Monitoring, and Orchestration APIs",
    version="2.1.0",
    lifespan=lifespan,
)

# Include patrol routes (Patrol Agent API)
app.include_router(patrol_router)

# Include agent monitor routes (Real-time Agent Monitoring)
app.include_router(agent_router)

# Include orchestrator routes (Voice/Chat/Realtime API)
app.include_router(orchestrator_router)

# Include Cecelia task execution routes (/cecelia/* for CeceliaRuns and RunDetail)
app.include_router(cecelia_router)


@app.get("/")
async def root():
    """Service information."""
    return {
        "service": "Cecelia Support Service",
        "version": "2.1.0",
        "description": "Patrol, Agent Monitoring, and Orchestration APIs",
        "brain_api": {
            "status": "migrated",
            "message": "Brain API runs on Node.js Brain (port 5221)",
            "url": "http://localhost:5221/api/brain"
        },
        "active_apis": [
            "/api/patrol/* - Code Patrol & Monitoring",
            "/api/agents/* - Agent Activity Monitoring",
            "/api/orchestrator/* - Voice/Chat/Realtime API",
            "/cecelia/* - Task Execution Logs"
        ],
        "docs": "/docs"
    }


@app.get("/ping")
async def ping():
    """Lightweight health check endpoint."""
    return {"message": "pong"}
