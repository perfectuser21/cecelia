"""Vector storage using ChromaDB."""

import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import chromadb
from chromadb.config import Settings

from .chunker import Chunk

logger = logging.getLogger(__name__)


class VectorStore:
    """ChromaDB-based vector storage."""

    COLLECTION_NAME = "semantic_brain"

    def __init__(self, persist_path: str):
        """Initialize the vector store."""
        self.persist_path = Path(persist_path)
        self.persist_path.mkdir(parents=True, exist_ok=True)

        self.client = chromadb.PersistentClient(
            path=str(self.persist_path),
            settings=Settings(anonymized_telemetry=False),
        )

        self.collection = self.client.get_or_create_collection(
            name=self.COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

    def add_chunks(
        self,
        chunks: List[Chunk],
        embeddings: List[List[float]],
        modified_at: Optional[datetime] = None,
    ) -> int:
        """Add chunks with their embeddings to the store."""
        if not chunks:
            return 0

        if len(chunks) != len(embeddings):
            raise ValueError("Chunks and embeddings must have same length")

        now = datetime.utcnow().isoformat()
        mod_time = modified_at.isoformat() if modified_at else now

        ids = [c.chunk_id for c in chunks]
        documents = [c.text for c in chunks]
        metadatas = [
            {
                "file_path": c.file_path,
                "project": c.project,
                "file_type": c.file_type,
                "line_start": c.line_start,
                "line_end": c.line_end,
                "chunk_index": c.chunk_index,
                "total_chunks": c.total_chunks,
                "created_at": now,
                "modified_at": mod_time,
            }
            for c in chunks
        ]

        self.collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )

        logger.info(f"Added {len(chunks)} chunks to store")
        return len(chunks)

    def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Search for similar chunks."""
        where = None
        if filters:
            where_clauses = []

            if "project" in filters:
                where_clauses.append({"project": filters["project"]})

            if "file_type" in filters:
                where_clauses.append({"file_type": filters["file_type"]})

            if where_clauses:
                where = {"$and": where_clauses} if len(where_clauses) > 1 else where_clauses[0]

        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where=where,
            include=["documents", "metadatas", "distances"],
        )

        formatted = []
        if results["ids"] and results["ids"][0]:
            for i, chunk_id in enumerate(results["ids"][0]):
                distance = results["distances"][0][i] if results["distances"] else 0
                similarity = 1 - distance

                formatted.append({
                    "chunk_id": chunk_id,
                    "text": results["documents"][0][i] if results["documents"] else "",
                    "similarity": round(similarity, 4),
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                })

        return formatted

    def delete_by_file(self, file_path: str) -> int:
        """Delete all chunks for a file."""
        results = self.collection.get(
            where={"file_path": file_path},
            include=["metadatas"],
        )

        if not results["ids"]:
            return 0

        count = len(results["ids"])
        self.collection.delete(ids=results["ids"])

        logger.info(f"Deleted {count} chunks for {file_path}")
        return count

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the store."""
        count = self.collection.count()
        results = self.collection.get(include=["metadatas"])

        files = set()
        projects = set()

        if results["metadatas"]:
            for meta in results["metadatas"]:
                files.add(meta.get("file_path", ""))
                projects.add(meta.get("project", ""))

        return {
            "total_chunks": count,
            "total_files": len(files),
            "projects": sorted(projects),
            "db_path": str(self.persist_path),
        }

    def clear(self) -> None:
        """Clear all data from the store."""
        self.client.delete_collection(self.COLLECTION_NAME)
        self.collection = self.client.get_or_create_collection(
            name=self.COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info("Cleared all data from store")
