"""Text chunking utilities for Cecelia Semantic Brain."""

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import List

from langchain_text_splitters import RecursiveCharacterTextSplitter


@dataclass
class Chunk:
    """A text chunk with metadata."""
    chunk_id: str
    text: str
    file_path: str
    project: str
    file_type: str
    line_start: int
    line_end: int
    chunk_index: int
    total_chunks: int


class Chunker:
    """Text chunking engine using LangChain's RecursiveCharacterTextSplitter."""

    CHARS_PER_TOKEN = 4

    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        """Initialize the chunker."""
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size * self.CHARS_PER_TOKEN,
            chunk_overlap=chunk_overlap * self.CHARS_PER_TOKEN,
            length_function=len,
            separators=["\n\n", "\n", ". ", ", ", " ", ""],
        )

    def _generate_chunk_id(self, file_path: str, chunk_index: int, text: str) -> str:
        """Generate a unique ID for a chunk."""
        content = f"{file_path}:{chunk_index}:{text[:100]}"
        return hashlib.sha256(content.encode()).hexdigest()[:12]

    def _detect_project(self, file_path: str, dev_root: str = "/home/xx/dev") -> str:
        """Detect project name from file path."""
        try:
            path = Path(file_path)
            root = Path(dev_root)
            relative = path.relative_to(root)
            return relative.parts[0] if relative.parts else "unknown"
        except ValueError:
            return "unknown"

    def _estimate_line_range(
        self,
        full_text: str,
        chunk_text: str,
        chunk_index: int
    ) -> tuple[int, int]:
        """Estimate the line range for a chunk."""
        start_pos = full_text.find(chunk_text)
        if start_pos == -1:
            lines_per_chunk = max(1, full_text.count('\n') // max(1, chunk_index + 1))
            start_line = chunk_index * lines_per_chunk + 1
            end_line = start_line + lines_per_chunk
            return start_line, end_line

        start_line = full_text[:start_pos].count('\n') + 1
        end_line = start_line + chunk_text.count('\n')
        return start_line, end_line

    def chunk_text(
        self,
        text: str,
        file_path: str,
        dev_root: str = "/home/xx/dev"
    ) -> List[Chunk]:
        """Split text into chunks with metadata."""
        if not text.strip():
            return []

        chunk_texts = self.splitter.split_text(text)
        total_chunks = len(chunk_texts)
        project = self._detect_project(file_path, dev_root)
        file_type = Path(file_path).suffix or ".txt"

        chunks = []
        for i, chunk_text in enumerate(chunk_texts):
            line_start, line_end = self._estimate_line_range(text, chunk_text, i)

            chunk = Chunk(
                chunk_id=self._generate_chunk_id(file_path, i, chunk_text),
                text=chunk_text,
                file_path=file_path,
                project=project,
                file_type=file_type,
                line_start=line_start,
                line_end=line_end,
                chunk_index=i,
                total_chunks=total_chunks,
            )
            chunks.append(chunk)

        return chunks

    def chunk_file(
        self,
        file_path: str | Path,
        dev_root: str = "/home/xx/dev"
    ) -> List[Chunk]:
        """Read a file and split it into chunks."""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="latin-1")

        return self.chunk_text(text, str(path), dev_root)
