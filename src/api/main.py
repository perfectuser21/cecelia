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
from src.intelligence.detector.detector_service import DetectorService
from src.intelligence.detector.ci_monitor import CIMonitor
from src.intelligence.detector.code_monitor import CodeMonitor
from src.intelligence.detector.security_monitor import SecurityMonitor
from src.intelligence.planner.execution_planner import ExecutionPlanner
from src.db.pool import Database, init_database, close_database
from src.api.state_routes import router as state_router, set_database
from src.api.patrol_routes import router as patrol_router, set_database as set_patrol_database
from src.api.agent_routes import router as agent_router, set_database as set_agent_database
from src.api.orchestrator_routes import router as orchestrator_router, set_database as set_orchestrator_database
from src.autumnrice.routes import router as autumnrice_router, set_database as set_autumnrice_database, ensure_tables as ensure_autumnrice_tables
from src.state.patrol import ensure_patrol_table
from src.state.agent_monitor import ensure_agent_tables

load_dotenv()

logger = logging.getLogger(__name__)

# Global instances
embedder: Optional[Embedder] = None
store: Optional[VectorStore] = None
search_engine: Optional[SearchEngine] = None
parser_service: Optional[ParserService] = None
scheduler_service: Optional[SchedulerService] = None
detector_service: Optional[DetectorService] = None
execution_planner: Optional[ExecutionPlanner] = None
database: Optional[Database] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global embedder, store, search_engine, parser_service, scheduler_service, detector_service, execution_planner, database

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

    # Initialize Detector Service
    ci_monitor = CIMonitor(enabled=True)
    code_monitor = CodeMonitor(enabled=True)
    security_monitor = SecurityMonitor(enabled=True)
    detector_service = DetectorService(
        ci_monitor=ci_monitor,
        code_monitor=code_monitor,
        security_monitor=security_monitor,
        check_interval=300,  # 5 minutes
    )

    # Initialize Execution Planner
    execution_planner = ExecutionPlanner(max_concurrent=3)
    logger.info("Intelligence Layer initialized")

    # Initialize Database (State Layer)
    try:
        database = await init_database()
        set_database(database)
        set_patrol_database(database)
        set_agent_database(database)
        set_orchestrator_database(database)
        set_autumnrice_database(database)
        # Ensure required tables exist
        await ensure_patrol_table(database)
        await ensure_agent_tables(database)
        await ensure_autumnrice_tables(database)
        logger.info("Database connection initialized")
    except Exception as e:
        logger.warning(f"Database connection failed (State Layer disabled): {e}")
        database = None

    logger.info("Semantic Brain initialized")

    yield

    # Cleanup
    if database is not None:
        await close_database()
        logger.info("Database connection closed")

    logger.info("Shutting down Semantic Brain...")


app = FastAPI(
    title="Cecelia Semantic Brain",
    description="Private knowledge retrieval API",
    version="1.1.0",
    lifespan=lifespan,
)

# Include state routes (Brain API)
app.include_router(state_router)

# Include patrol routes (Patrol Agent API)
app.include_router(patrol_router)

# Include agent monitor routes (Real-time Agent Monitoring)
app.include_router(agent_router)

# Include orchestrator routes (Layer 2 state management + Realtime API)
app.include_router(orchestrator_router)

# Include autumnrice routes (秋米 - TRD/Task/Run state machine)
app.include_router(autumnrice_router)


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


# Intelligence Layer - Detector endpoints
class MonitorStatusResponse(BaseModel):
    """Status of a single monitor."""
    name: str
    enabled: bool
    last_check: Optional[str]
    events_detected: int
    processed_ids_count: int


class DetectorStatusResponse(BaseModel):
    """Response from detector status endpoint."""
    running: bool
    monitors: Dict[str, MonitorStatusResponse]
    total_events: int
    last_check: Optional[str]
    check_interval_seconds: int


class EventMetadataResponse(BaseModel):
    """Event metadata."""
    repository: Optional[str] = None
    branch: Optional[str] = None
    workflow: Optional[str] = None
    run_id: Optional[int] = None
    html_url: Optional[str] = None
    error_message: Optional[str] = None
    sha: Optional[str] = None
    author: Optional[str] = None
    package_name: Optional[str] = None
    severity: Optional[str] = None
    cve_id: Optional[str] = None


class EventResponse(BaseModel):
    """A single event."""
    event_id: str
    event_type: str
    severity: str
    title: str
    description: str
    source: str
    timestamp: str
    metadata: Dict[str, Any]


class DetectorEventsResponse(BaseModel):
    """Response from detector events endpoint."""
    events: List[EventResponse]
    total: int


@app.get("/detector/status", response_model=DetectorStatusResponse)
async def detector_status():
    """Get detector service status.

    Returns the status of all monitors and overall detector service.
    """
    if detector_service is None:
        raise HTTPException(status_code=503, detail="Detector service not initialized")

    status = detector_service.get_status()

    monitors_response = {}
    for name, monitor_status in status.monitors.items():
        monitors_response[name] = MonitorStatusResponse(
            name=monitor_status["name"],
            enabled=monitor_status["enabled"],
            last_check=monitor_status["last_check"],
            events_detected=monitor_status["events_detected"],
            processed_ids_count=monitor_status["processed_ids_count"],
        )

    return DetectorStatusResponse(
        running=status.running,
        monitors=monitors_response,
        total_events=status.total_events,
        last_check=status.last_check.isoformat() if status.last_check else None,
        check_interval_seconds=status.check_interval_seconds,
    )


@app.get("/detector/events", response_model=DetectorEventsResponse)
async def detector_events(
    limit: int = 50,
    event_type: Optional[str] = None,
    severity: Optional[str] = None,
):
    """Get recent events from detector.

    Args:
        limit: Maximum number of events to return
        event_type: Filter by event type (ci_failure, code_push, security_vulnerability)
        severity: Filter by severity (critical, high, medium, low, info)

    Returns:
        List of recent events
    """
    if detector_service is None:
        raise HTTPException(status_code=503, detail="Detector service not initialized")

    if event_type:
        events = detector_service.get_events_by_type(event_type)
    elif severity:
        events = detector_service.get_events_by_severity(severity)
    else:
        events = detector_service.get_recent_events(limit=limit)

    return DetectorEventsResponse(
        events=[
            EventResponse(
                event_id=e.event_id,
                event_type=e.event_type.value,
                severity=e.severity.value,
                title=e.title,
                description=e.description,
                source=e.source,
                timestamp=e.timestamp.isoformat(),
                metadata=e.metadata,
            )
            for e in events[:limit]
        ],
        total=len(events),
    )


# Intelligence Layer - Planner endpoints
class TaskStatsResponse(BaseModel):
    """Task statistics."""
    total: int
    by_priority: Dict[str, int]
    by_status: Dict[str, int]


class ExecutionPlanStateResponse(BaseModel):
    """Current execution plan state."""
    next_up: List[str]
    in_progress: List[str]
    waiting: List[str]
    blocked: List[str]


class BottleneckResponse(BaseModel):
    """A bottleneck in the plan."""
    task: str
    reason: str
    suggestion: str


class PlanResponse(BaseModel):
    """Response from plan endpoint."""
    current_tasks: TaskStatsResponse
    execution_plan: ExecutionPlanStateResponse
    estimated_completion: str
    bottlenecks: List[BottleneckResponse]
    risks: List[Dict[str, Any]]


class PlanTaskInput(BaseModel):
    """A task input for planning."""
    id: str
    priority: str = "P1"
    status: str = "queued"
    dependencies: List[str] = []
    estimated_time: str = "30min"
    blocked_by: List[str] = []


class PlanRequest(BaseModel):
    """Request for plan endpoint."""
    tasks: List[PlanTaskInput]


@app.post("/plan", response_model=PlanResponse)
async def plan(request: PlanRequest):
    """Generate execution plan for tasks.

    This endpoint takes a list of tasks and generates an execution plan
    with statistics, bottleneck analysis, and time estimation.
    """
    if execution_planner is None:
        raise HTTPException(status_code=503, detail="Execution planner not initialized")

    if not request.tasks:
        raise HTTPException(status_code=400, detail="Tasks list cannot be empty")

    # Convert Pydantic models to dicts
    tasks = [t.model_dump() for t in request.tasks]

    result = execution_planner.plan(tasks)

    return PlanResponse(
        current_tasks=TaskStatsResponse(
            total=result.current_tasks.total,
            by_priority=result.current_tasks.by_priority,
            by_status=result.current_tasks.by_status,
        ),
        execution_plan=ExecutionPlanStateResponse(
            next_up=result.execution_plan.next_up,
            in_progress=result.execution_plan.in_progress,
            waiting=result.execution_plan.waiting,
            blocked=result.execution_plan.blocked,
        ),
        estimated_completion=result.estimated_completion,
        bottlenecks=[
            BottleneckResponse(
                task=b.task_id,
                reason=b.reason,
                suggestion=b.suggestion,
            )
            for b in result.bottlenecks
        ],
        risks=result.risks,
    )


@app.get("/plan/summary")
async def plan_summary():
    """Get a summary of the execution planner capabilities.

    Returns information about the planner and its configuration.
    """
    if execution_planner is None:
        raise HTTPException(status_code=503, detail="Execution planner not initialized")

    return {
        "planner": "ExecutionPlanner",
        "max_concurrent": execution_planner.max_concurrent,
        "capabilities": [
            "task_statistics",
            "execution_planning",
            "bottleneck_detection",
            "time_estimation",
        ],
    }


@app.get("/ping")
async def ping():
    """Lightweight health check endpoint.

    Returns a simple pong response without requiring service initialization.
    """
    return {"message": "pong"}
