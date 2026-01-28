"""Embedding generation using OpenAI API."""

import logging
from typing import List

from openai import OpenAI

logger = logging.getLogger(__name__)


class Embedder:
    """Generate embeddings using OpenAI's text-embedding API."""

    def __init__(
        self,
        api_key: str,
        model: str = "text-embedding-3-small",
        dimensions: int = 1536,
    ):
        """Initialize the embedder."""
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.dimensions = dimensions

    def embed(self, text: str) -> List[float]:
        """Generate embedding for a single text."""
        if not text.strip():
            raise ValueError("Cannot embed empty text")

        response = self.client.embeddings.create(
            input=text,
            model=self.model,
            dimensions=self.dimensions,
        )

        return response.data[0].embedding

    def embed_batch(
        self,
        texts: List[str],
        batch_size: int = 100
    ) -> List[List[float]]:
        """Generate embeddings for multiple texts."""
        if not texts:
            return []

        all_embeddings = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            valid_batch = [t for t in batch if t.strip()]

            if not valid_batch:
                all_embeddings.extend([[0.0] * self.dimensions] * len(batch))
                continue

            logger.info(f"Embedding batch {i // batch_size + 1}, {len(valid_batch)} texts")

            response = self.client.embeddings.create(
                input=valid_batch,
                model=self.model,
                dimensions=self.dimensions,
            )

            batch_embeddings = []
            valid_idx = 0
            for text in batch:
                if text.strip():
                    batch_embeddings.append(response.data[valid_idx].embedding)
                    valid_idx += 1
                else:
                    batch_embeddings.append([0.0] * self.dimensions)

            all_embeddings.extend(batch_embeddings)

        return all_embeddings
