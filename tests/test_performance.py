"""Performance tests for Cecelia Semantic Brain."""

import time
from unittest.mock import MagicMock

import pytest

from src.core.search import SearchEngine


class TestPerformance:
    """Performance tests."""

    @pytest.fixture
    def mock_embedder(self):
        """Create mock embedder with realistic timing."""
        mock = MagicMock()
        # Simulate small embedding latency
        def embed_with_delay(text):
            time.sleep(0.01)  # 10ms simulated latency
            return [0.1] * 1536
        mock.embed.side_effect = embed_with_delay
        return mock

    @pytest.fixture
    def mock_store(self):
        """Create mock store with realistic timing."""
        mock = MagicMock()
        # Simulate small search latency
        def search_with_delay(**kwargs):
            time.sleep(0.005)  # 5ms simulated latency
            return [
                {
                    "chunk_id": f"chunk{i}",
                    "text": f"Result {i}",
                    "similarity": 0.9 - i * 0.05,
                    "metadata": {
                        "file_path": f"/test/file{i}.md",
                        "project": "test",
                        "line_start": i * 10,
                        "line_end": i * 10 + 5,
                    },
                }
                for i in range(min(kwargs.get("top_k", 10), 10))
            ]
        mock.search.side_effect = search_with_delay
        return mock

    def test_search_response_time_under_100ms(self, mock_embedder, mock_store):
        """Test that search completes in under 100ms (excluding network)."""
        engine = SearchEngine(mock_embedder, mock_store)

        # Run multiple searches
        times = []
        for _ in range(10):
            response = engine.search("test query")
            times.append(response.query_time_ms)

        avg_time = sum(times) / len(times)

        # With mocked delays (10ms embed + 5ms search), should be around 15-20ms
        # Allow up to 100ms for test stability
        assert avg_time < 100, f"Average search time {avg_time}ms exceeds 100ms"

    def test_search_scales_with_top_k(self, mock_embedder, mock_store):
        """Test that search time doesn't scale dramatically with top_k."""
        engine = SearchEngine(mock_embedder, mock_store)

        # Search with different top_k values
        time_k5 = engine.search("test", top_k=5).query_time_ms
        engine.search("test", top_k=10)  # Intermediate value
        time_k20 = engine.search("test", top_k=20).query_time_ms

        # Times should be roughly similar (within 3x)
        # Main bottleneck should be embedding, not retrieval
        assert time_k20 < time_k5 * 3, "Search time scales too much with top_k"

    def test_multiple_searches_consistent(self, mock_embedder, mock_store):
        """Test that multiple searches have consistent timing."""
        engine = SearchEngine(mock_embedder, mock_store)

        times = [engine.search("test").query_time_ms for _ in range(5)]

        # Check variance is reasonable
        avg = sum(times) / len(times)
        variance = sum((t - avg) ** 2 for t in times) / len(times)
        std_dev = variance ** 0.5

        # Standard deviation should be less than average (no wild swings)
        assert std_dev < avg, f"Search times too variable: {times}"
