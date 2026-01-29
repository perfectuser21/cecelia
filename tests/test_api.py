"""Tests for the API module."""

import os
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


class TestAPI:
    """Tests for the API endpoints."""

    @pytest.fixture
    def mock_dependencies(self, test_chroma_path):
        """Mock all external dependencies."""
        os.environ["CHROMA_DB_PATH"] = test_chroma_path

        with patch("src.api.main.Embedder") as mock_embedder, \
             patch("src.api.main.load_app_config") as mock_app_config, \
             patch("src.api.main.load_sor_config") as mock_sor_config:

            # Mock app config
            mock_app_config.return_value = MagicMock(
                openai_api_key="test-key",
                chroma_db_path=test_chroma_path,
                log_level="WARNING",
            )

            # Mock SoR config
            mock_sor_config.return_value = MagicMock(
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
            )

            # Mock embedder
            mock_emb = MagicMock()
            mock_emb.embed.return_value = [0.1] * 1536
            mock_embedder.return_value = mock_emb

            yield {
                "embedder": mock_emb,
                "app_config": mock_app_config,
                "sor_config": mock_sor_config,
            }

    @pytest.fixture
    def client(self, mock_dependencies):
        """Create test client."""
        from src.api.main import app
        with TestClient(app) as client:
            yield client

    def test_ping_endpoint(self, client):
        """Test ping endpoint."""
        response = client.get("/ping")
        assert response.status_code == 200

        data = response.json()
        assert data["message"] == "pong"

    def test_health_endpoint(self, client):
        """Test health check endpoint."""
        response = client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "healthy"
        assert "indexed_chunks" in data

    def test_stats_endpoint(self, client):
        """Test stats endpoint."""
        response = client.get("/stats")
        assert response.status_code == 200

        data = response.json()
        assert "total_chunks" in data
        assert "total_files" in data
        assert "projects" in data
        assert "db_size_mb" in data

    def test_fusion_endpoint_success(self, client, mock_dependencies):
        """Test fusion (search) endpoint."""
        response = client.post(
            "/fusion",
            json={"query": "test query", "top_k": 5}
        )
        assert response.status_code == 200

        data = response.json()
        assert "results" in data
        assert "total" in data
        assert "query_time_ms" in data
        assert isinstance(data["results"], list)

    def test_fusion_endpoint_empty_query(self, client):
        """Test fusion endpoint with empty query."""
        response = client.post(
            "/fusion",
            json={"query": "", "top_k": 5}
        )
        assert response.status_code == 400

    def test_fusion_endpoint_with_filters(self, client, mock_dependencies):
        """Test fusion endpoint with filters."""
        response = client.post(
            "/fusion",
            json={
                "query": "test",
                "top_k": 10,
                "filters": {"project": "test-project"}
            }
        )
        assert response.status_code == 200
