# Learnings

## [2026-02-01] Architecture Unification: Delete Autumnrice, Keep Node Brain

### Decision: Unified Cecelia Organ-Based Architecture
- **Problem**: Dual orchestration systems (autumnrice vs Node Brain) causing confusion and redundancy
- **Analysis**: Comprehensive comparison showed Node Brain is superior (8/10 vs 4/10 production readiness)
  - Node Brain: 11,273 LOC, 55 API endpoints, self-healing, circuit breaker, orphan cleanup
  - autumnrice: 3,122 LOC, 23 API endpoints, cleaner but incomplete
- **Solution**: Delete entire autumnrice system, unify under Node Brain as single decision center
- **Impact**: High - architectural simplification, eliminates data race risks

### What was deleted:
- `src/autumnrice/` - entire directory (7 Python files, 3,122 LOC)
- `skills/autumnrice/` - skill directory
- `tests/test_orchestrator_*.py` - 5 test files
- All autumnrice imports from `src/api/main.py`

### Architectural changes:
- **Old model**: Cecelia → Autumnrice (秋米) → Caramel (焦糖) / Nobel (诺贝)
- **New model**: Cecelia = unified organ system
  - Brain (Node 5221) - single decision center
  - Intelligence Service (Python 5220) - supporting capabilities
  - Hands (Claude Code + /dev) - execution layer
  - Memory, Mouth, Monitor, Communication - functional organs

### Benefits:
- ✅ Single orchestrator (Node Brain) - no data races
- ✅ Clear LLM vs non-LLM separation
- ✅ Unified brand identity (all "Cecelia")
- ✅ Simpler mental model (organs vs agents)
- ✅ Better production readiness (circuit breaker, self-healing)

### Process:
- Used Explore agents to compare both systems comprehensively
- Analyzed functional completeness, usage patterns, code quality, performance
- Clear verdict: Node Brain superior in every dimension
- Executed clean deletion + documentation update

## [2026-01-29] Cecelia Realtime Voice + Orchestrator Tool

### Bug: Import of non-existent module broke CI
- **Problem**: `src/api/main.py` had an import `from src.orchestrator.routes import router as orchestrator_v2_router` that referenced a module from another branch/feature that was never committed
- **Solution**: Removed the orphan import, kept only the working `orchestrator_routes.py` which contains all realtime features
- **Impact**: Medium - caused CI failure on first PR push

### Optimization: Database dependency injection for tools
- **What**: Tools in `orchestrator_routes.py` need database access. Used module-level `set_database()` function called from `main.py` lifespan
- **Why better**: Avoids circular imports and keeps tool functions pure
- **Pattern**: Same pattern used by `patrol_routes.py`, `agent_routes.py`, `orchestrator_routes.py`

### Learning: OpenAI Realtime API WebSocket proxy
- **Architecture**: FastAPI WebSocket endpoint acts as proxy between browser and OpenAI Realtime API
- **Key insight**: Must handle binary frames for audio data, JSON frames for messages
- **Tools approach**: Define tools in config, execute via `/realtime/tool` endpoint when Cecelia calls them

### Impact Assessment
- **Severity**: Low - smooth implementation once import issue was fixed
- **Process**: /dev workflow worked correctly, caught issue at CI stage
### [2026-01-30] Add /ping health check endpoint
- **Bug**: None
- **优化点**: The workflow executed smoothly. Adding a simple GET endpoint with no dependencies was straightforward. Test coverage was adequate.
- **影响程度**: Low - Simple feature implementation
