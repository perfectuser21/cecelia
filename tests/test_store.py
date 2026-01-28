"""Tests for the vector store module."""

import pytest

from src.core.chunker import Chunk
from src.core.store import VectorStore


class TestVectorStore:
    """Tests for the VectorStore class."""

    def test_init_creates_directory(self, test_chroma_path: str):
        """Test that store creates persist directory."""
        store = VectorStore(test_chroma_path)
        assert store.persist_path.exists()

    def test_add_chunks_empty(self, test_chroma_path: str):
        """Test adding empty chunks returns 0."""
        store = VectorStore(test_chroma_path)
        result = store.add_chunks([], [])
        assert result == 0

    def test_add_chunks_mismatched_lengths(self, test_chroma_path: str):
        """Test that mismatched chunks and embeddings raises error."""
        store = VectorStore(test_chroma_path)
        chunks = [
            Chunk(
                chunk_id="test1",
                text="test",
                file_path="/test.md",
                project="test",
                file_type=".md",
                line_start=1,
                line_end=1,
                chunk_index=0,
                total_chunks=1,
            )
        ]
        with pytest.raises(ValueError):
            store.add_chunks(chunks, [])

    def test_add_and_search(self, test_chroma_path: str):
        """Test adding chunks and searching."""
        store = VectorStore(test_chroma_path)

        chunks = [
            Chunk(
                chunk_id="chunk1",
                text="Python programming language",
                file_path="/test/python.md",
                project="test",
                file_type=".md",
                line_start=1,
                line_end=5,
                chunk_index=0,
                total_chunks=1,
            ),
            Chunk(
                chunk_id="chunk2",
                text="JavaScript web development",
                file_path="/test/js.md",
                project="test",
                file_type=".md",
                line_start=1,
                line_end=5,
                chunk_index=0,
                total_chunks=1,
            ),
        ]
        embeddings = [[0.1] * 1536, [0.2] * 1536]

        added = store.add_chunks(chunks, embeddings)
        assert added == 2

        # Search for similar
        results = store.search([0.1] * 1536, top_k=2)
        assert len(results) == 2
        assert "chunk_id" in results[0]
        assert "text" in results[0]
        assert "similarity" in results[0]

    def test_search_with_filters(self, test_chroma_path: str):
        """Test searching with metadata filters."""
        store = VectorStore(test_chroma_path)

        chunks = [
            Chunk(
                chunk_id="py1",
                text="Python code",
                file_path="/test/python.py",
                project="project-a",
                file_type=".py",
                line_start=1,
                line_end=5,
                chunk_index=0,
                total_chunks=1,
            ),
            Chunk(
                chunk_id="md1",
                text="Markdown docs",
                file_path="/test/readme.md",
                project="project-b",
                file_type=".md",
                line_start=1,
                line_end=5,
                chunk_index=0,
                total_chunks=1,
            ),
        ]
        embeddings = [[0.1] * 1536, [0.1] * 1536]
        store.add_chunks(chunks, embeddings)

        # Filter by project
        results = store.search([0.1] * 1536, filters={"project": "project-a"})
        assert len(results) == 1
        assert results[0]["metadata"]["project"] == "project-a"

    def test_delete_by_file(self, test_chroma_path: str):
        """Test deleting chunks by file path."""
        store = VectorStore(test_chroma_path)

        chunks = [
            Chunk(
                chunk_id="del1",
                text="To be deleted",
                file_path="/test/delete-me.md",
                project="test",
                file_type=".md",
                line_start=1,
                line_end=5,
                chunk_index=0,
                total_chunks=1,
            ),
        ]
        embeddings = [[0.1] * 1536]
        store.add_chunks(chunks, embeddings)

        # Delete
        deleted = store.delete_by_file("/test/delete-me.md")
        assert deleted == 1

        # Verify deletion
        stats = store.get_stats()
        assert stats["total_chunks"] == 0

    def test_get_stats(self, test_chroma_path: str):
        """Test getting store statistics."""
        store = VectorStore(test_chroma_path)

        chunks = [
            Chunk(
                chunk_id="stat1",
                text="Stats test",
                file_path="/project-a/file.md",
                project="project-a",
                file_type=".md",
                line_start=1,
                line_end=5,
                chunk_index=0,
                total_chunks=1,
            ),
        ]
        embeddings = [[0.1] * 1536]
        store.add_chunks(chunks, embeddings)

        stats = store.get_stats()
        assert stats["total_chunks"] == 1
        assert stats["total_files"] == 1
        assert "project-a" in stats["projects"]

    def test_clear(self, test_chroma_path: str):
        """Test clearing all data."""
        store = VectorStore(test_chroma_path)

        chunks = [
            Chunk(
                chunk_id="clear1",
                text="Clear test",
                file_path="/test.md",
                project="test",
                file_type=".md",
                line_start=1,
                line_end=5,
                chunk_index=0,
                total_chunks=1,
            ),
        ]
        embeddings = [[0.1] * 1536]
        store.add_chunks(chunks, embeddings)

        store.clear()

        stats = store.get_stats()
        assert stats["total_chunks"] == 0
