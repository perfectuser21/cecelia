"""Search functionality for Cecelia Semantic Brain."""

import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .embedder import Embedder
from .store import VectorStore

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """A single search result."""
    chunk_id: str
    text: str
    similarity: float
    file_path: str
    project: str
    line_range: tuple[int, int]
    metadata: Dict[str, Any]


@dataclass
class SearchResponse:
    """Response from a search query."""
    results: List[SearchResult]
    total: int
    query_time_ms: float


class SearchEngine:
    """Search engine for semantic queries."""

    def __init__(self, embedder: Embedder, store: VectorStore):
        """Initialize the search engine."""
        self.embedder = embedder
        self.store = store

    def search(
        self,
        query: str,
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None,
    ) -> SearchResponse:
        """Execute a semantic search."""
        start_time = time.time()

        query_embedding = self.embedder.embed(query)

        raw_results = self.store.search(
            query_embedding=query_embedding,
            top_k=top_k,
            filters=filters,
        )

        results = []
        for r in raw_results:
            meta = r.get("metadata", {})
            result = SearchResult(
                chunk_id=r["chunk_id"],
                text=r["text"],
                similarity=r["similarity"],
                file_path=meta.get("file_path", ""),
                project=meta.get("project", ""),
                line_range=(meta.get("line_start", 0), meta.get("line_end", 0)),
                metadata=meta,
            )
            results.append(result)

        query_time = (time.time() - start_time) * 1000

        return SearchResponse(
            results=results,
            total=len(results),
            query_time_ms=round(query_time, 2),
        )
