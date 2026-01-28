"""Tests for the search module."""

from unittest.mock import MagicMock

import pytest

from src.core.search import SearchEngine, SearchResponse, SearchResult


class TestSearchEngine:
    """Tests for the SearchEngine class."""

    @pytest.fixture
    def mock_embedder(self):
        """Create mock embedder."""
        mock = MagicMock()
        mock.embed.return_value = [0.1] * 1536
        return mock

    @pytest.fixture
    def mock_store(self):
        """Create mock store."""
        mock = MagicMock()
        mock.search.return_value = [
            {
                "chunk_id": "chunk1",
                "text": "Test content about Python programming",
                "similarity": 0.95,
                "metadata": {
                    "file_path": "/test/python.md",
                    "project": "test-project",
                    "line_start": 10,
                    "line_end": 20,
                    "modified_at": "2026-01-01T00:00:00Z",
                },
            },
            {
                "chunk_id": "chunk2",
                "text": "More content about coding",
                "similarity": 0.85,
                "metadata": {
                    "file_path": "/test/code.md",
                    "project": "test-project",
                    "line_start": 1,
                    "line_end": 5,
                },
            },
        ]
        return mock

    def test_search_returns_results(self, mock_embedder, mock_store):
        """Test that search returns formatted results."""
        engine = SearchEngine(mock_embedder, mock_store)

        response = engine.search("Python programming", top_k=5)

        assert isinstance(response, SearchResponse)
        assert len(response.results) == 2
        assert response.total == 2
        assert response.query_time_ms >= 0

    def test_search_result_structure(self, mock_embedder, mock_store):
        """Test that search results have correct structure."""
        engine = SearchEngine(mock_embedder, mock_store)

        response = engine.search("test query")

        result = response.results[0]
        assert isinstance(result, SearchResult)
        assert result.chunk_id == "chunk1"
        assert result.text == "Test content about Python programming"
        assert result.similarity == 0.95
        assert result.file_path == "/test/python.md"
        assert result.project == "test-project"
        assert result.line_range == (10, 20)

    def test_search_calls_embedder(self, mock_embedder, mock_store):
        """Test that search calls embedder with query."""
        engine = SearchEngine(mock_embedder, mock_store)

        engine.search("my search query")

        mock_embedder.embed.assert_called_once_with("my search query")

    def test_search_calls_store_with_embedding(self, mock_embedder, mock_store):
        """Test that search calls store with embedding."""
        engine = SearchEngine(mock_embedder, mock_store)

        engine.search("test", top_k=10)

        mock_store.search.assert_called_once()
        call_args = mock_store.search.call_args
        assert call_args.kwargs["query_embedding"] == [0.1] * 1536
        assert call_args.kwargs["top_k"] == 10

    def test_search_with_filters(self, mock_embedder, mock_store):
        """Test that filters are passed to store."""
        engine = SearchEngine(mock_embedder, mock_store)

        filters = {"project": "test-project", "file_type": ".md"}
        engine.search("test", filters=filters)

        call_args = mock_store.search.call_args
        assert call_args.kwargs["filters"] == filters

    def test_search_empty_results(self, mock_embedder, mock_store):
        """Test handling of empty results."""
        mock_store.search.return_value = []
        engine = SearchEngine(mock_embedder, mock_store)

        response = engine.search("nonexistent query")

        assert response.results == []
        assert response.total == 0

    def test_search_response_time_measured(self, mock_embedder, mock_store):
        """Test that query time is measured."""
        engine = SearchEngine(mock_embedder, mock_store)

        response = engine.search("test")

        assert isinstance(response.query_time_ms, float)
        assert response.query_time_ms >= 0
