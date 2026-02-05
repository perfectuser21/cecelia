"""Tests for the CLI module."""

import os
import sys
from io import StringIO
from unittest.mock import MagicMock, patch

import pytest


class TestCLI:
    """Tests for the CLI commands."""

    @pytest.fixture
    def mock_env(self, test_chroma_path):
        """Set up mock environment."""
        os.environ["OPENAI_API_KEY"] = "test-key"
        os.environ["CHROMA_DB_PATH"] = test_chroma_path
        os.environ["SOR_CONFIG_PATH"] = "sor/config.yaml"
        os.environ["DEV_ROOT"] = "/home/xx/dev"
        yield

    def test_stats_command(self, mock_env, test_chroma_path):
        """Test stats command output."""
        with patch("src.cli.main.load_app_config") as mock_config:
            mock_config.return_value = MagicMock(
                chroma_db_path=test_chroma_path,
            )

            from src.cli.main import cmd_stats

            # Capture stdout
            old_stdout = sys.stdout
            sys.stdout = StringIO()

            args = MagicMock()
            cmd_stats(args)

            output = sys.stdout.getvalue()
            sys.stdout = old_stdout

            assert "Database Statistics" in output
            assert "Total chunks" in output

    def test_index_command_basic(self, mock_env, test_chroma_path, temp_dir):
        """Test index command with mocked dependencies."""
        with patch("src.cli.main.load_app_config") as mock_app_config, \
             patch("src.cli.main.load_sor_config") as mock_sor_config, \
             patch("src.cli.main.Embedder") as mock_embedder:

            mock_app_config.return_value = MagicMock(
                openai_api_key="test-key",
                chroma_db_path=test_chroma_path,
                dev_root=str(temp_dir),
                log_level="WARNING",
            )

            mock_sor_config.return_value = MagicMock(
                sources=[],
                chunk_size=500,
                chunk_overlap=50,
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
            )

            mock_emb = MagicMock()
            mock_embedder.return_value = mock_emb

            from src.cli.main import cmd_index

            old_stdout = sys.stdout
            sys.stdout = StringIO()

            args = MagicMock()
            args.config = None
            args.clear = False

            cmd_index(args)

            output = sys.stdout.getvalue()
            sys.stdout = old_stdout

            assert "Indexing complete" in output

    def test_search_command(self, mock_env, test_chroma_path):
        """Test search command."""
        with patch("src.cli.main.load_app_config") as mock_app_config, \
             patch("src.cli.main.load_sor_config") as mock_sor_config, \
             patch("src.cli.main.Embedder") as mock_embedder:

            mock_app_config.return_value = MagicMock(
                openai_api_key="test-key",
                chroma_db_path=test_chroma_path,
            )

            mock_sor_config.return_value = MagicMock(
                embedding_model="text-embedding-3-small",
                embedding_dimensions=1536,
            )

            mock_emb = MagicMock()
            mock_emb.embed.return_value = [0.1] * 1536
            mock_embedder.return_value = mock_emb

            from src.cli.main import cmd_search

            old_stdout = sys.stdout
            sys.stdout = StringIO()

            args = MagicMock()
            args.query = "test query"
            args.top_k = 5
            args.project = None
            args.file_type = None

            cmd_search(args)

            output = sys.stdout.getvalue()
            sys.stdout = old_stdout

            assert "Found" in output
            assert "results" in output
