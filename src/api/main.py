"""FastAPI application for Cecelia Semantic Brain."""

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from src.core.config import load_app_config, load_sor_config
from src.core.embedder import Embedder
from src.core.search import SearchEngine
from src.core.store import VectorStore

load_dotenv()

logger = logging.getLogger(__name__)

# Global instances
embedder: Optional[Embedder] = None
store: Optional[VectorStore] = None
search_engine: Optional[SearchEngine] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global embedder, store, search_engine

    app_config = load_app_config()
    sor_config = load_sor_config()

    logging.basicConfig(
        level=getattr(logging, app_config.log_level.upper()),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info("Initializing Semantic Brain...")

    embedder = Embedder(
        api_key=app_config.openai_api_key,
        model=sor_config.embedding_model,
        dimensions=sor_config.embedding_dimensions,
    )

    store = VectorStore(app_config.chroma_db_path)
    search_engine = SearchEngine(embedder, store)

    logger.info("Semantic Brain initialized")

    yield

    logger.info("Shutting down Semantic Brain...")


app = FastAPI(
    title="Cecelia Semantic Brain",
    description="Private knowledge retrieval API",
    version="1.0.0",
    lifespan=lifespan,
)


# Request/Response models
class FusionRequest(BaseModel):
    """Request for fusion (search) endpoint."""
    query: str
    top_k: int = 10
    filters: Optional[Dict[str, Any]] = None


class ResultMetadata(BaseModel):
    """Metadata for a search result."""
    file_path: str
    line_range: List[int]
    project: str
    modified_at: Optional[str] = None


class FusionResult(BaseModel):
    """A single search result."""
    chunk_id: str
    text: str
    similarity: float
    metadata: ResultMetadata


class FusionResponse(BaseModel):
    """Response from fusion endpoint."""
    results: List[FusionResult]
    total: int
    query_time_ms: float


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    indexed_chunks: int


class StatsResponse(BaseModel):
    """Statistics response."""
    total_chunks: int
    total_files: int
    projects: List[str]
    last_updated: str
    db_size_mb: float


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    if store is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    stats = store.get_stats()
    return HealthResponse(
        status="healthy",
        indexed_chunks=stats["total_chunks"],
    )


@app.get("/stats", response_model=StatsResponse)
async def stats():
    """Get index statistics."""
    if store is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    stats_data = store.get_stats()

    # Estimate DB size
    import os
    db_path = stats_data["db_path"]
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(db_path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            total_size += os.path.getsize(fp)

    return StatsResponse(
        total_chunks=stats_data["total_chunks"],
        total_files=stats_data["total_files"],
        projects=stats_data["projects"],
        last_updated=datetime.utcnow().isoformat(),
        db_size_mb=round(total_size / (1024 * 1024), 2),
    )


@app.post("/fusion", response_model=FusionResponse)
async def fusion(request: FusionRequest):
    """Semantic search endpoint."""
    if search_engine is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    response = search_engine.search(
        query=request.query,
        top_k=request.top_k,
        filters=request.filters,
    )

    results = [
        FusionResult(
            chunk_id=r.chunk_id,
            text=r.text,
            similarity=r.similarity,
            metadata=ResultMetadata(
                file_path=r.file_path,
                line_range=list(r.line_range),
                project=r.project,
                modified_at=r.metadata.get("modified_at"),
            ),
        )
        for r in response.results
    ]

    return FusionResponse(
        results=results,
        total=response.total,
        query_time_ms=response.query_time_ms,
    )
