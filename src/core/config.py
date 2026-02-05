"""Configuration management for Cecelia Semantic Brain."""

import os
from pathlib import Path
from typing import List

import yaml
from pydantic import BaseModel


class SourceConfig(BaseModel):
    """Configuration for a single data source."""
    name: str
    path: str
    include: List[str]
    exclude: List[str] = []
    priority: str = "medium"


class SoRConfig(BaseModel):
    """Source of Record configuration."""
    sources: List[SourceConfig]
    chunk_size: int = 500
    chunk_overlap: int = 50
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536


class AppConfig(BaseModel):
    """Application configuration."""
    openai_api_key: str
    chroma_db_path: str
    sor_config_path: str
    dev_root: str = "/home/xx/dev"
    host: str = "0.0.0.0"
    port: int = 5220
    log_level: str = "INFO"


def load_sor_config(config_path: str | None = None) -> SoRConfig:
    """Load SoR configuration from YAML file."""
    if config_path is None:
        config_path = os.getenv("SOR_CONFIG_PATH", "sor/config.yaml")

    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"SoR config not found: {config_path}")

    with open(path, "r") as f:
        data = yaml.safe_load(f)

    return SoRConfig(**data)


def load_app_config() -> AppConfig:
    """Load application configuration from environment variables."""
    return AppConfig(
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        chroma_db_path=os.getenv("CHROMA_DB_PATH", "./data/chroma"),
        sor_config_path=os.getenv("SOR_CONFIG_PATH", "sor/config.yaml"),
        dev_root=os.getenv("DEV_ROOT", "/home/xx/dev"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "5220")),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
    )
