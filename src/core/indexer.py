"""File indexer for Cecelia Semantic Brain."""

import fnmatch
import logging
from datetime import datetime
from pathlib import Path
from typing import List

from .chunker import Chunker
from .config import SoRConfig, SourceConfig
from .embedder import Embedder
from .store import VectorStore

logger = logging.getLogger(__name__)


class Indexer:
    """Index files from configured sources into the vector store."""

    def __init__(
        self,
        config: SoRConfig,
        embedder: Embedder,
        store: VectorStore,
        dev_root: str = "/home/xx/dev",
    ):
        """Initialize the indexer."""
        self.config = config
        self.embedder = embedder
        self.store = store
        self.dev_root = dev_root
        self.chunker = Chunker(
            chunk_size=config.chunk_size,
            chunk_overlap=config.chunk_overlap,
        )

    def _matches_patterns(self, path: Path, patterns: List[str]) -> bool:
        """Check if a path matches any of the glob patterns."""
        path_str = str(path)
        for pattern in patterns:
            if fnmatch.fnmatch(path_str, pattern) or fnmatch.fnmatch(path.name, pattern):
                return True
        return False

    def _should_index(self, path: Path, source: SourceConfig) -> bool:
        """Check if a file should be indexed based on include/exclude patterns."""
        rel_path = path.relative_to(source.path)
        rel_str = str(rel_path)

        # Check exclude patterns first
        for pattern in source.exclude:
            # Handle ** patterns by checking if any part matches
            if "**" in pattern:
                # Convert **/node_modules/** to check if "node_modules" is in path
                core_pattern = pattern.replace("**/", "").replace("/**", "")
                if core_pattern in rel_str:
                    return False
            elif fnmatch.fnmatch(rel_str, pattern):
                return False

        # Check include patterns
        for pattern in source.include:
            if "**" in pattern:
                # For **/*.md, match any .md file
                ext_pattern = pattern.split("/")[-1]
                if fnmatch.fnmatch(path.name, ext_pattern):
                    return True
            elif fnmatch.fnmatch(rel_str, pattern) or fnmatch.fnmatch(path.name, pattern):
                return True

        return False

    def _find_files(self, source: SourceConfig) -> List[Path]:
        """Find all files to index from a source."""
        source_path = Path(source.path)
        if not source_path.exists():
            logger.warning(f"Source path does not exist: {source.path}")
            return []

        files = []
        for path in source_path.rglob("*"):
            if path.is_file() and self._should_index(path, source):
                files.append(path)

        return files

    def index_file(self, file_path: Path) -> int:
        """Index a single file."""
        try:
            chunks = self.chunker.chunk_file(file_path, self.dev_root)
            if not chunks:
                return 0

            texts = [c.text for c in chunks]
            embeddings = self.embedder.embed_batch(texts)

            modified_at = datetime.fromtimestamp(file_path.stat().st_mtime)
            return self.store.add_chunks(chunks, embeddings, modified_at)

        except Exception as e:
            logger.error(f"Error indexing {file_path}: {e}")
            return 0

    def index_source(self, source: SourceConfig) -> int:
        """Index all files from a source."""
        files = self._find_files(source)
        logger.info(f"Found {len(files)} files in {source.name}")

        total_chunks = 0
        for file_path in files:
            chunks = self.index_file(file_path)
            total_chunks += chunks
            if chunks > 0:
                logger.info(f"  Indexed {file_path.name}: {chunks} chunks")

        return total_chunks

    def index_all(self) -> int:
        """Index all configured sources."""
        total_chunks = 0

        for source in self.config.sources:
            logger.info(f"Indexing source: {source.name}")
            chunks = self.index_source(source)
            total_chunks += chunks
            logger.info(f"  Total: {chunks} chunks from {source.name}")

        logger.info(f"Indexing complete: {total_chunks} total chunks")
        return total_chunks

    def reindex_file(self, file_path: Path) -> int:
        """Re-index a single file (delete old chunks first)."""
        self.store.delete_by_file(str(file_path))
        return self.index_file(file_path)

    def delete_file(self, file_path: Path) -> int:
        """Delete all chunks for a file."""
        return self.store.delete_by_file(str(file_path))
