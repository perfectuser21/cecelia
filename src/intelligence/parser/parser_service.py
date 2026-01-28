"""Parser Service - Orchestrates intent analysis and task decomposition."""

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from src.intelligence.parser.intent_analyzer import IntentAnalyzer
from src.intelligence.parser.task_decomposer import TaskDecomposer
from src.intelligence.parser.dependency_builder import DependencyBuilder


@dataclass
class ParseResult:
    """Result of parsing a user intent."""

    understanding: Dict[str, Any]
    tasks: List[Dict[str, Any]]
    dependency_graph: Dict[str, Any]
    historical_context: List[Dict[str, Any]]
    parse_time_ms: float

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "understanding": self.understanding,
            "tasks": self.tasks,
            "dependency_graph": self.dependency_graph,
            "historical_context": self.historical_context,
            "parse_time_ms": self.parse_time_ms,
        }


class ParserService:
    """Main service for parsing user intents into tasks."""

    def __init__(self, semantic_client: Optional[Any] = None):
        """Initialize the parser service.

        Args:
            semantic_client: Optional client for querying Semantic Brain
        """
        self.intent_analyzer = IntentAnalyzer()
        self.dependency_builder = DependencyBuilder()
        self.semantic_client = semantic_client

    async def parse(
        self,
        intent: str,
        context: Optional[Dict[str, Any]] = None,
        use_history: bool = True,
    ) -> ParseResult:
        """Parse a user intent into executable tasks.

        Args:
            intent: Natural language description of what to do
            context: Optional context (project, branch, etc.)
            use_history: Whether to query Semantic Brain for history

        Returns:
            ParseResult with tasks, dependencies, and context
        """
        start_time = time.time()

        # Step 1: Analyze intent
        analysis = self.intent_analyzer.analyze(intent)

        # Step 2: Query historical context if enabled
        historical_context: List[Dict[str, Any]] = []
        if use_history and self.semantic_client:
            historical_context = await self._query_history(intent, context)

        # Step 3: Decompose into tasks
        decomposer = TaskDecomposer(historical_context=historical_context)
        tasks = decomposer.decompose(analysis)

        # Step 4: Build dependency graph
        dep_graph = self.dependency_builder.build(tasks)

        # Calculate parse time
        parse_time_ms = (time.time() - start_time) * 1000

        return ParseResult(
            understanding={
                "type": analysis.type.value,
                "scope": analysis.scope,
                "description": analysis.description,
                "keywords": analysis.keywords,
                "estimated_complexity": analysis.estimated_complexity,
            },
            tasks=[task.to_dict() for task in tasks],
            dependency_graph=dep_graph.to_dict(),
            historical_context=historical_context,
            parse_time_ms=round(parse_time_ms, 2),
        )

    async def _query_history(
        self,
        intent: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Query Semantic Brain for historical implementations.

        Args:
            intent: The user intent
            context: Optional context with project info

        Returns:
            List of relevant historical context
        """
        if not self.semantic_client:
            return []

        try:
            project = context.get("project", "") if context else ""
            query = f"{intent} implementation"
            if project:
                query = f"{query} in {project}"

            # Call Semantic Brain's fusion endpoint
            results = await self.semantic_client.search(query=query, top_k=5)

            return [
                {
                    "file": r.get("file_path", ""),
                    "summary": r.get("text", "")[:200],
                    "similarity": r.get("similarity", 0),
                }
                for r in results
            ]
        except Exception:
            # If Semantic Brain is not available, continue without history
            return []
