"""Semantic API routes for Node.js Brain integration.

Provides /v1/semantic/* endpoints that wrap the core Embedder,
SearchEngine, and VectorStore for use by the Node.js Brain (port 5221).
"""

import logging
import math
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.core.embedder import Embedder
from src.core.search import SearchEngine
from src.core.store import VectorStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/semantic", tags=["semantic"])

# Module-level references set by main.py
_embedder: Optional[Embedder] = None
_store: Optional[VectorStore] = None
_search_engine: Optional[SearchEngine] = None


def set_dependencies(
    embedder: Optional[Embedder],
    store: Optional[VectorStore],
    search_engine: Optional[SearchEngine],
) -> None:
    """Set module-level dependencies from main.py lifespan."""
    global _embedder, _store, _search_engine
    _embedder = embedder
    _store = store
    _search_engine = search_engine


# --- Request/Response models ---

class EmbedRequest(BaseModel):
    text: str
    model: Optional[str] = None


class EmbedResponse(BaseModel):
    embedding: List[float]
    model: str
    dimensions: int


class SemanticSearchRequest(BaseModel):
    query: str
    top_k: int = Field(default=10, gt=0, le=100)
    filters: Optional[Dict[str, Any]] = None


class ResultMetadata(BaseModel):
    file_path: str
    line_range: List[int]
    project: str
    modified_at: Optional[str] = None


class SearchResultItem(BaseModel):
    chunk_id: str
    text: str
    similarity: float
    metadata: ResultMetadata


class SemanticSearchResponse(BaseModel):
    results: List[SearchResultItem]
    total: int
    query_time_ms: float


class RerankInputItem(BaseModel):
    id: str
    text: str
    score: float


class RerankRequest(BaseModel):
    query: str
    results: List[RerankInputItem]
    top_k: Optional[int] = Field(default=None, gt=0, le=100)


class RerankOutputItem(BaseModel):
    id: str
    text: str
    score: float
    original_score: float


class RerankResponse(BaseModel):
    results: List[RerankOutputItem]
    query_time_ms: float


class EmbedderStatus(BaseModel):
    model: str
    dimensions: int


class StoreStatus(BaseModel):
    indexed_chunks: int
    status: str


class SemanticHealthResponse(BaseModel):
    status: str
    embedder: Optional[EmbedderStatus] = None
    store: Optional[StoreStatus] = None


# --- Endpoints ---

@router.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest):
    """Generate embedding for text."""
    if _embedder is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    embedding = _embedder.embed(request.text)

    return EmbedResponse(
        embedding=embedding,
        model=_embedder.model,
        dimensions=_embedder.dimensions,
    )


@router.post("/search", response_model=SemanticSearchResponse)
async def search(request: SemanticSearchRequest):
    """Semantic search over indexed documents."""
    if _search_engine is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    response = _search_engine.search(
        query=request.query,
        top_k=request.top_k,
        filters=request.filters,
    )

    results = [
        SearchResultItem(
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

    return SemanticSearchResponse(
        results=results,
        total=response.total,
        query_time_ms=response.query_time_ms,
    )


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors using stdlib only."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


@router.post("/rerank", response_model=RerankResponse)
async def rerank(request: RerankRequest):
    """Rerank search results by computing cosine similarity with query."""
    if _embedder is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    if not request.results:
        return RerankResponse(results=[], query_time_ms=0.0)

    start_time = time.time()

    texts = [request.query] + [r.text for r in request.results]
    embeddings = _embedder.embed_batch(texts)
    query_embedding = embeddings[0]
    result_embeddings = embeddings[1:]

    scored = []
    for item, emb in zip(request.results, result_embeddings):
        sim = _cosine_similarity(query_embedding, emb)
        scored.append(RerankOutputItem(
            id=item.id,
            text=item.text,
            score=round(sim, 6),
            original_score=item.score,
        ))

    scored.sort(key=lambda x: x.score, reverse=True)

    top_k = request.top_k or len(scored)
    query_time_ms = round((time.time() - start_time) * 1000, 2)

    return RerankResponse(
        results=scored[:top_k],
        query_time_ms=query_time_ms,
    )


@router.get("/health", response_model=SemanticHealthResponse)
async def health():
    """Semantic layer health check."""
    status = "healthy"
    embedder_status = None
    store_status = None

    if _embedder is not None:
        embedder_status = EmbedderStatus(
            model=_embedder.model,
            dimensions=_embedder.dimensions,
        )
    else:
        status = "degraded"

    if _store is not None:
        try:
            stats = _store.get_stats()
            store_status = StoreStatus(
                indexed_chunks=stats["total_chunks"],
                status="connected",
            )
        except Exception as e:
            logger.warning(f"Store health check failed: {e}")
            store_status = StoreStatus(indexed_chunks=0, status=f"error: {e}")
            status = "degraded"
    else:
        status = "degraded"

    return SemanticHealthResponse(
        status=status,
        embedder=embedder_status,
        store=store_status,
    )
