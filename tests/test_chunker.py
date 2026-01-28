"""Tests for the chunker module."""

import tempfile
from pathlib import Path

import pytest

from src.core.chunker import Chunk, Chunker


class TestChunker:
    """Tests for the Chunker class."""

    def test_init_default_values(self):
        """Test chunker initialization with default values."""
        chunker = Chunker()
        assert chunker.chunk_size == 500
        assert chunker.chunk_overlap == 50

    def test_init_custom_values(self):
        """Test chunker initialization with custom values."""
        chunker = Chunker(chunk_size=100, chunk_overlap=10)
        assert chunker.chunk_size == 100
        assert chunker.chunk_overlap == 10

    def test_chunk_text_empty(self):
        """Test chunking empty text returns empty list."""
        chunker = Chunker()
        result = chunker.chunk_text("", "/test/file.md")
        assert result == []

    def test_chunk_text_whitespace(self):
        """Test chunking whitespace-only text returns empty list."""
        chunker = Chunker()
        result = chunker.chunk_text("   \n\n  ", "/test/file.md")
        assert result == []

    def test_chunk_text_single_chunk(self):
        """Test chunking short text creates single chunk."""
        chunker = Chunker(chunk_size=100)
        text = "This is a short text."
        result = chunker.chunk_text(text, "/home/xx/dev/project/file.md")

        assert len(result) == 1
        assert result[0].text == text
        assert result[0].file_path == "/home/xx/dev/project/file.md"
        assert result[0].project == "project"
        assert result[0].file_type == ".md"

    def test_chunk_text_multiple_chunks(self):
        """Test chunking long text creates multiple chunks."""
        chunker = Chunker(chunk_size=50, chunk_overlap=10)
        text = "First paragraph.\n\n" + "Second paragraph with more content.\n\n" * 20

        result = chunker.chunk_text(text, "/home/xx/dev/test/doc.md")

        assert len(result) > 1
        for chunk in result:
            assert isinstance(chunk, Chunk)
            assert chunk.chunk_id
            assert chunk.text
            assert chunk.total_chunks == len(result)

    def test_chunk_text_preserves_metadata(self):
        """Test that chunk metadata is correctly set."""
        chunker = Chunker()
        text = "Some content here."
        result = chunker.chunk_text(text, "/home/xx/dev/myproject/src/test.ts")

        assert result[0].project == "myproject"
        assert result[0].file_type == ".ts"
        assert result[0].chunk_index == 0

    def test_detect_project_valid_path(self):
        """Test project detection from valid path."""
        chunker = Chunker()
        project = chunker._detect_project(
            "/home/xx/dev/cecelia-workspace/src/file.ts",
            "/home/xx/dev"
        )
        assert project == "cecelia-workspace"

    def test_detect_project_invalid_path(self):
        """Test project detection from invalid path."""
        chunker = Chunker()
        project = chunker._detect_project("/other/path/file.ts", "/home/xx/dev")
        assert project == "unknown"

    def test_generate_chunk_id_unique(self):
        """Test that chunk IDs are unique."""
        chunker = Chunker()
        id1 = chunker._generate_chunk_id("/path/file.md", 0, "text1")
        id2 = chunker._generate_chunk_id("/path/file.md", 0, "text2")
        id3 = chunker._generate_chunk_id("/path/file.md", 1, "text1")

        assert id1 != id2
        assert id1 != id3
        assert id2 != id3

    def test_chunk_file_not_found(self):
        """Test chunking non-existent file raises error."""
        chunker = Chunker()
        with pytest.raises(FileNotFoundError):
            chunker.chunk_file("/nonexistent/file.md")

    def test_chunk_file_success(self, sample_text: str):
        """Test chunking a real file."""
        chunker = Chunker(chunk_size=100)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(sample_text)
            temp_path = f.name

        try:
            result = chunker.chunk_file(temp_path)
            assert len(result) > 0
            assert all(isinstance(c, Chunk) for c in result)
        finally:
            Path(temp_path).unlink()
