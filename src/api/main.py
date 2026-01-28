"""FastAPI application for Cecelia Semantic Brain."""

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from src.core.config import load_app_config, load_sor_config
from src.core.embedder import Embedder
from src.core.search import SearchEngine
from src.core.store import VectorStore
from src.intelligence.parser.parser_service import ParserService
from src.intelligence.scheduler.scheduler_service import SchedulerService

load_dotenv()

logger = logging.getLogger(__name__)

# Global instances
embedder: Optional[Embedder] = None
store: Optional[VectorStore] = None
search_engine: Optional[SearchEngine] = None
parser_service: Optional[ParserService] = None
scheduler_service: Optional[SchedulerService] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global embedder, store, search_engine, parser_service, scheduler_service

    app_config = load_app_config()
    sor_config = load_sor_config()

    logging.basicConfig(
        level=getattr(logging, app_config.log_level.upper()),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info("Initializing Semantic Brain...")

    embedder = Embedder(
        api_key=app_config.openai_api_key,
        model=sor_config.embedding_model,
        dimensions=sor_config.embedding_dimensions,
    )

    store = VectorStore(app_config.chroma_db_path)
    search_engine = SearchEngine(embedder, store)

    # Initialize Intelligence Layer
    parser_service = ParserService(semantic_client=None)  # TODO: Add semantic client
    scheduler_service = SchedulerService(max_concurrent=3)
    logger.info("Intelligence Layer initialized")

    logger.info("Semantic Brain initialized")

    yield

    logger.info("Shutting down Semantic Brain...")


app = FastAPI(
    title="Cecelia Semantic Brain",
    description="Private knowledge retrieval API",
    version="1.0.0",
    lifespan=lifespan,
)


# Request/Response models
class FusionRequest(BaseModel):
    """Request for fusion (search) endpoint."""
    query: str
    top_k: int = 10
    filters: Optional[Dict[str, Any]] = None


class ResultMetadata(BaseModel):
    """Metadata for a search result."""
    file_path: str
    line_range: List[int]
    project: str
    modified_at: Optional[str] = None


class FusionResult(BaseModel):
    """A single search result."""
    chunk_id: str
    text: str
    similarity: float
    metadata: ResultMetadata


class FusionResponse(BaseModel):
    """Response from fusion endpoint."""
    results: List[FusionResult]
    total: int
    query_time_ms: float


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    indexed_chunks: int


class StatsResponse(BaseModel):
    """Statistics response."""
    total_chunks: int
    total_files: int
    projects: List[str]
    last_updated: str
    db_size_mb: float


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    if store is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    stats = store.get_stats()
    return HealthResponse(
        status="healthy",
        indexed_chunks=stats["total_chunks"],
    )


@app.get("/stats", response_model=StatsResponse)
async def stats():
    """Get index statistics."""
    if store is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    stats_data = store.get_stats()

    # Estimate DB size
    import os
    db_path = stats_data["db_path"]
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(db_path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            total_size += os.path.getsize(fp)

    return StatsResponse(
        total_chunks=stats_data["total_chunks"],
        total_files=stats_data["total_files"],
        projects=stats_data["projects"],
        last_updated=datetime.utcnow().isoformat(),
        db_size_mb=round(total_size / (1024 * 1024), 2),
    )


@app.post("/fusion", response_model=FusionResponse)
async def fusion(request: FusionRequest):
    """Semantic search endpoint."""
    if search_engine is None:
        raise HTTPException(status_code=503, detail="Service not initialized")

    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    response = search_engine.search(
        query=request.query,
        top_k=request.top_k,
        filters=request.filters,
    )

    results = [
        FusionResult(
            chunk_id=r.chunk_id,
            text=r.text,
            similarity=r.similarity,
            metadata=ResultMetadata(
                file_path=r.file_path,
                line_range=list(r.line_range),
                project=r.project,
                modified_at=r.metadata.get("modified_at"),
            ),
        )
        for r in response.results
    ]

    return FusionResponse(
        results=results,
        total=response.total,
        query_time_ms=response.query_time_ms,
    )


# Intelligence Layer - Parse endpoint
class ParseRequest(BaseModel):
    """Request for parse endpoint."""
    intent: str
    context: Optional[Dict[str, Any]] = None
    use_history: bool = True


class TaskResponse(BaseModel):
    """A single task in parse response."""
    id: str
    title: str
    description: str
    priority: str
    estimated_time: str
    dependencies: List[str]
    tags: List[str]


class UnderstandingResponse(BaseModel):
    """Understanding section of parse response."""
    type: str
    scope: str
    description: str
    keywords: List[str]
    estimated_complexity: str


class DependencyGraphResponse(BaseModel):
    """Dependency graph in parse response."""
    graph: Dict[str, List[str]]
    execution_order: List[str]
    parallel_groups: List[List[str]]


class HistoricalContextResponse(BaseModel):
    """Historical context item."""
    file: str
    summary: str
    similarity: float = 0.0


class ParseResponse(BaseModel):
    """Response from parse endpoint."""
    understanding: UnderstandingResponse
    tasks: List[TaskResponse]
    dependency_graph: DependencyGraphResponse
    historical_context: List[HistoricalContextResponse]
    parse_time_ms: float


@app.post("/parse", response_model=ParseResponse)
async def parse(request: ParseRequest):
    """Parse user intent into executable tasks.

    This endpoint analyzes a natural language description and breaks it down
    into a structured list of tasks with dependencies.
    """
    if parser_service is None:
        raise HTTPException(status_code=503, detail="Parser service not initialized")

    if not request.intent.strip():
        raise HTTPException(status_code=400, detail="Intent cannot be empty")

    result = await parser_service.parse(
        intent=request.intent,
        context=request.context,
        use_history=request.use_history,
    )

    return ParseResponse(
        understanding=UnderstandingResponse(**result.understanding),
        tasks=[TaskResponse(**t) for t in result.tasks],
        dependency_graph=DependencyGraphResponse(**result.dependency_graph),
        historical_context=[
            HistoricalContextResponse(**h) for h in result.historical_context
        ],
        parse_time_ms=result.parse_time_ms,
    )


# Intelligence Layer - Schedule endpoint
class ScheduleTaskInput(BaseModel):
    """A task input for scheduling."""
    id: str
    priority: str = "P1"
    dependencies: List[str] = []
    title: str = ""
    estimated_time: str = "30min"


class ScheduleConstraints(BaseModel):
    """Constraints for scheduling."""
    max_concurrent: int = 3
    must_finish_first: List[str] = []


class ScheduleRequest(BaseModel):
    """Request for schedule endpoint."""
    tasks: List[ScheduleTaskInput]
    constraints: Optional[ScheduleConstraints] = None


class ExecutionPhaseResponse(BaseModel):
    """A phase in the execution plan."""
    phase: int
    tasks: List[str]
    concurrent: bool
    reason: str


class ExecutionPlanResponse(BaseModel):
    """The execution plan."""
    phases: List[ExecutionPhaseResponse]
    estimated_total_time: str
    critical_path: List[str]


class ScheduleResponse(BaseModel):
    """Response from schedule endpoint."""
    execution_plan: ExecutionPlanResponse
    visualization: str
    schedule_time_ms: float
    has_cycle: bool
    cycle_tasks: List[str]


@app.post("/schedule", response_model=ScheduleResponse)
async def schedule(request: ScheduleRequest):
    """Schedule tasks and generate execution plan.

    This endpoint takes a list of tasks with dependencies and generates
    an optimal execution plan with parallel phases.
    """
    if scheduler_service is None:
        raise HTTPException(status_code=503, detail="Scheduler service not initialized")

    if not request.tasks:
        raise HTTPException(status_code=400, detail="Tasks list cannot be empty")

    # Convert Pydantic models to dicts
    tasks = [t.model_dump() for t in request.tasks]
    constraints = request.constraints.model_dump() if request.constraints else None

    result = scheduler_service.schedule(tasks=tasks, constraints=constraints)

    return ScheduleResponse(
        execution_plan=ExecutionPlanResponse(
            phases=[
                ExecutionPhaseResponse(**p)
                for p in result.execution_plan.get("phases", [])
            ],
            estimated_total_time=result.execution_plan.get("estimated_total_time", "N/A"),
            critical_path=result.execution_plan.get("critical_path", []),
        ),
        visualization=result.visualization,
        schedule_time_ms=result.schedule_time_ms,
        has_cycle=result.has_cycle,
        cycle_tasks=result.cycle_tasks,
    )
