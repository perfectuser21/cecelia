# Learnings

## [2026-01-29] Cecelia Realtime Voice + Orchestrator Tool

### Bug: Import of non-existent module broke CI
- **Problem**: `src/api/main.py` had an import `from src.orchestrator.routes import router as orchestrator_v2_router` that referenced a module from another branch/feature that was never committed
- **Solution**: Removed the orphan import, kept only the working `orchestrator_routes.py` which contains all realtime features
- **Impact**: Medium - caused CI failure on first PR push

### Optimization: Database dependency injection for tools
- **What**: Tools in `orchestrator_routes.py` need database access. Used module-level `set_database()` function called from `main.py` lifespan
- **Why better**: Avoids circular imports and keeps tool functions pure
- **Pattern**: Same pattern used by `state_routes.py`, `patrol_routes.py`, `agent_routes.py`

### Learning: OpenAI Realtime API WebSocket proxy
- **Architecture**: FastAPI WebSocket endpoint acts as proxy between browser and OpenAI Realtime API
- **Key insight**: Must handle binary frames for audio data, JSON frames for messages
- **Tools approach**: Define tools in config, execute via `/realtime/tool` endpoint when Cecelia calls them

### Impact Assessment
- **Severity**: Low - smooth implementation once import issue was fixed
- **Process**: /dev workflow worked correctly, caught issue at CI stage
