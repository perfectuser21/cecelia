"""Tests for the indexer module."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.core.config import SoRConfig, SourceConfig
from src.core.indexer import Indexer


class TestIndexer:
    """Tests for the Indexer class."""

    @pytest.fixture
    def mock_embedder(self):
        """Create mock embedder."""
        mock = MagicMock()
        mock.embed_batch.return_value = [[0.1] * 1536]
        return mock

    @pytest.fixture
    def mock_store(self):
        """Create mock store."""
        mock = MagicMock()
        mock.add_chunks.return_value = 1
        mock.delete_by_file.return_value = 1
        return mock

    @pytest.fixture
    def test_config(self, temp_dir):
        """Create test SoR config."""
        # Create test directory structure
        source_dir = temp_dir / "test-project"
        source_dir.mkdir()
        (source_dir / "doc.md").write_text("# Test\n\nContent here.")
        (source_dir / "code.ts").write_text("const x = 1;")
        (source_dir / "node_modules").mkdir()
        (source_dir / "node_modules" / "pkg.md").write_text("excluded")

        return SoRConfig(
            sources=[
                SourceConfig(
                    name="test-project",
                    path=str(source_dir),
                    include=["**/*.md", "**/*.ts"],
                    exclude=["**/node_modules/**"],
                )
            ],
            chunk_size=100,
            chunk_overlap=10,
        )

    def test_find_files(self, test_config, mock_embedder, mock_store, temp_dir):
        """Test file discovery respects include/exclude patterns."""
        indexer = Indexer(
            config=test_config,
            embedder=mock_embedder,
            store=mock_store,
            dev_root=str(temp_dir),
        )

        files = indexer._find_files(test_config.sources[0])

        # Should find doc.md and code.ts, but not node_modules/pkg.md
        filenames = [f.name for f in files]
        assert "doc.md" in filenames
        assert "code.ts" in filenames
        assert "pkg.md" not in filenames

    def test_index_file(self, test_config, mock_embedder, mock_store, temp_dir):
        """Test indexing a single file."""
        indexer = Indexer(
            config=test_config,
            embedder=mock_embedder,
            store=mock_store,
            dev_root=str(temp_dir),
        )

        source_dir = Path(test_config.sources[0].path)
        indexer.index_file(source_dir / "doc.md")

        assert mock_embedder.embed_batch.called
        assert mock_store.add_chunks.called

    def test_index_source(self, test_config, mock_embedder, mock_store, temp_dir):
        """Test indexing all files from a source."""
        mock_embedder.embed_batch.return_value = [[0.1] * 1536, [0.2] * 1536]
        mock_store.add_chunks.return_value = 2

        indexer = Indexer(
            config=test_config,
            embedder=mock_embedder,
            store=mock_store,
            dev_root=str(temp_dir),
        )

        total = indexer.index_source(test_config.sources[0])

        assert total > 0
        assert mock_store.add_chunks.called

    def test_index_all(self, test_config, mock_embedder, mock_store, temp_dir):
        """Test indexing all configured sources."""
        indexer = Indexer(
            config=test_config,
            embedder=mock_embedder,
            store=mock_store,
            dev_root=str(temp_dir),
        )

        indexer.index_all()
        assert mock_store.add_chunks.called

    def test_reindex_file(self, test_config, mock_embedder, mock_store, temp_dir):
        """Test re-indexing deletes old chunks first."""
        indexer = Indexer(
            config=test_config,
            embedder=mock_embedder,
            store=mock_store,
            dev_root=str(temp_dir),
        )

        source_dir = Path(test_config.sources[0].path)
        indexer.reindex_file(source_dir / "doc.md")

        assert mock_store.delete_by_file.called
        assert mock_store.add_chunks.called

    def test_delete_file(self, test_config, mock_embedder, mock_store, temp_dir):
        """Test deleting file chunks."""
        indexer = Indexer(
            config=test_config,
            embedder=mock_embedder,
            store=mock_store,
            dev_root=str(temp_dir),
        )

        indexer.delete_file(Path("/test/file.md"))

        mock_store.delete_by_file.assert_called_once_with("/test/file.md")

    def test_should_index_include_pattern(self, test_config, mock_embedder, mock_store, temp_dir):
        """Test include pattern matching."""
        indexer = Indexer(
            config=test_config,
            embedder=mock_embedder,
            store=mock_store,
            dev_root=str(temp_dir),
        )

        source = test_config.sources[0]
        source_path = Path(source.path)

        # Should include .md files
        assert indexer._should_index(source_path / "test.md", source)

        # Should exclude node_modules
        assert not indexer._should_index(source_path / "node_modules" / "test.md", source)
