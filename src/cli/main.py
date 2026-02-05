"""CLI for Cecelia Semantic Brain."""

import argparse
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.core.config import load_app_config, load_sor_config
from src.core.embedder import Embedder
from src.core.indexer import Indexer
from src.core.search import SearchEngine
from src.core.store import VectorStore


def setup_logging(level: str = "INFO"):
    """Configure logging."""
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )


def cmd_index(args):
    """Index command handler."""
    load_dotenv()
    app_config = load_app_config()
    sor_config = load_sor_config(args.config)

    setup_logging(app_config.log_level)
    logger = logging.getLogger(__name__)

    logger.info("Starting indexing...")

    embedder = Embedder(
        api_key=app_config.openai_api_key,
        model=sor_config.embedding_model,
        dimensions=sor_config.embedding_dimensions,
    )

    store = VectorStore(app_config.chroma_db_path)

    if args.clear:
        logger.info("Clearing existing data...")
        store.clear()

    indexer = Indexer(
        config=sor_config,
        embedder=embedder,
        store=store,
        dev_root=app_config.dev_root,
    )

    indexer.index_all()

    stats = store.get_stats()
    print("\nIndexing complete!")
    print(f"  Total chunks: {stats['total_chunks']}")
    print(f"  Total files: {stats['total_files']}")
    print(f"  Projects: {', '.join(stats['projects'])}")


def cmd_search(args):
    """Search command handler."""
    load_dotenv()
    app_config = load_app_config()
    sor_config = load_sor_config()

    setup_logging("WARNING")

    embedder = Embedder(
        api_key=app_config.openai_api_key,
        model=sor_config.embedding_model,
        dimensions=sor_config.embedding_dimensions,
    )

    store = VectorStore(app_config.chroma_db_path)
    engine = SearchEngine(embedder, store)

    filters = {}
    if args.project:
        filters["project"] = args.project
    if args.file_type:
        filters["file_type"] = args.file_type

    response = engine.search(
        query=args.query,
        top_k=args.top_k,
        filters=filters if filters else None,
    )

    print(f"\nFound {response.total} results in {response.query_time_ms}ms\n")

    for i, result in enumerate(response.results, 1):
        print(f"[{i}] {result.file_path}:{result.line_range[0]}-{result.line_range[1]}")
        print(f"    Project: {result.project} | Similarity: {result.similarity:.4f}")
        print(f"    {result.text[:200]}...")
        print()


def cmd_stats(args):
    """Stats command handler."""
    load_dotenv()
    app_config = load_app_config()

    store = VectorStore(app_config.chroma_db_path)
    stats = store.get_stats()

    print("\nDatabase Statistics:")
    print(f"  Total chunks: {stats['total_chunks']}")
    print(f"  Total files: {stats['total_files']}")
    print(f"  Projects: {', '.join(stats['projects'])}")
    print(f"  DB path: {stats['db_path']}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Cecelia Semantic Brain - Knowledge retrieval system"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Index command
    index_parser = subparsers.add_parser("index", help="Index files")
    index_parser.add_argument(
        "--config", "-c",
        help="Path to SoR config file",
        default=None,
    )
    index_parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear existing data before indexing",
    )
    index_parser.set_defaults(func=cmd_index)

    # Search command
    search_parser = subparsers.add_parser("search", help="Search for content")
    search_parser.add_argument("query", help="Search query")
    search_parser.add_argument(
        "--top-k", "-k",
        type=int,
        default=10,
        help="Number of results to return",
    )
    search_parser.add_argument(
        "--project", "-p",
        help="Filter by project name",
    )
    search_parser.add_argument(
        "--file-type", "-t",
        help="Filter by file type (e.g., .md)",
    )
    search_parser.set_defaults(func=cmd_search)

    # Stats command
    stats_parser = subparsers.add_parser("stats", help="Show database statistics")
    stats_parser.set_defaults(func=cmd_stats)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
