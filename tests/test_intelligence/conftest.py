"""Pytest configuration for intelligence tests.

This conftest mocks VectorStore to avoid ChromaDB initialization issues
during API testing.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

# Set test environment before importing app
os.environ["OPENAI_API_KEY"] = "test-key"
os.environ["CHROMA_DB_PATH"] = "/tmp/test-chroma-intelligence"
os.environ["SOR_CONFIG_PATH"] = "sor/config.yaml"


@pytest.fixture(autouse=True)
def mock_vector_store():
    """Mock VectorStore to avoid ChromaDB initialization."""
    mock_store = MagicMock()
    mock_store.get_stats.return_value = {
        "total_chunks": 0,
        "total_files": 0,
        "projects": [],
        "db_path": "/tmp/test-chroma-intelligence",
    }
    mock_store.search.return_value = []

    with patch("src.api.main.VectorStore", return_value=mock_store):
        with patch("src.api.main.SearchEngine") as mock_search_engine:
            mock_engine = MagicMock()
            mock_engine.search.return_value = MagicMock(
                results=[],
                total=0,
                query_time_ms=0.0,
            )
            mock_search_engine.return_value = mock_engine
            yield mock_store


@pytest.fixture(autouse=True)
def mock_embedder():
    """Mock Embedder to avoid OpenAI API calls."""
    with patch("src.api.main.Embedder") as mock:
        mock_instance = MagicMock()
        mock_instance.embed.return_value = [0.1] * 1536
        mock_instance.embed_batch.return_value = [[0.1] * 1536]
        mock.return_value = mock_instance
        yield mock_instance
