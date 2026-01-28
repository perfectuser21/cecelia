"""Pytest configuration and fixtures."""

import os
import tempfile
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest

# Set test environment
os.environ["OPENAI_API_KEY"] = "test-key"
os.environ["CHROMA_DB_PATH"] = "/tmp/test-chroma"
os.environ["SOR_CONFIG_PATH"] = "sor/config.yaml"


@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def sample_text() -> str:
    """Sample text for testing."""
    return """# Sample Document

This is a sample document for testing the chunker.
It contains multiple paragraphs.

## Section 1

This is the first section with some content.
We need enough text to create multiple chunks.

## Section 2

This is the second section.
More content here to ensure we have enough material.

## Conclusion

Final thoughts and summary.
"""


@pytest.fixture
def mock_openai():
    """Mock OpenAI client for testing."""
    with patch("src.core.embedder.OpenAI") as mock:
        mock_client = MagicMock()
        mock.return_value = mock_client

        # Mock embedding response
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1] * 1536)]
        mock_client.embeddings.create.return_value = mock_response

        yield mock_client


@pytest.fixture
def test_chroma_path(temp_dir: Path) -> str:
    """Create a test ChromaDB path."""
    chroma_path = temp_dir / "chroma"
    chroma_path.mkdir()
    return str(chroma_path)
