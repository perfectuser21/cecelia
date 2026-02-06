---
id: kr22-tasks-plan
version: 1.0.0
created: 2026-02-06
updated: 2026-02-06
changelog:
  - 1.0.0: Initial task plan for KR2.2 implementation
---

# KR2.2 Implementation Tasks Plan

> **Note**: These tasks should be created in Cecelia Tasks system once the API is available.
> **Goal**: KR2.2 - Unified Publish Engine (≥95% success rate)

## Task Creation Script

Once Cecelia Tasks API is operational, use this script to create tasks:

```bash
#!/bin/bash

BASE_URL="http://localhost:5221/api/tasks"

# First, create or get the KR2.2 Goal
GOAL_ID=$(curl -s -X POST "$BASE_URL/goals" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "KR2.2: Unified Publish Engine",
    "description": "Build unified publishing engine with ≥95% API success rate",
    "priority": "P0",
    "target_date": "2026-05-01",
    "status": "in_progress",
    "progress": 10
  }' | jq -r '.id')

echo "Goal ID: $GOAL_ID"

# Phase 1 Tasks
curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 1.1: Database Schema Review",
    "description": "Review and finalize database schema design for publish engine",
    "priority": "P0",
    "task_type": "dev",
    "estimated_hours": 16,
    "owner": "Caramel",
    "depends_on": []
  }'

curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 1.2: Create Migration Scripts",
    "description": "Write SQL migration scripts for publish_jobs, publish_records, platform_credentials",
    "priority": "P0",
    "task_type": "dev",
    "estimated_hours": 24,
    "owner": "Caramel",
    "depends_on": ["Phase 1.1"]
  }'

curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 1.3: Execute Migration on Dev",
    "description": "Run migration scripts on dev environment and verify",
    "priority": "P0",
    "task_type": "dev",
    "estimated_hours": 16,
    "owner": "Caramel",
    "depends_on": ["Phase 1.2"]
  }'

# Phase 2 Tasks
curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 2.1: Platform Adapter Interface",
    "description": "Define IPlatformAdapter interface and related types",
    "priority": "P0",
    "task_type": "dev",
    "estimated_hours": 24,
    "owner": "Caramel",
    "depends_on": ["Phase 1.3"]
  }'

curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 2.2: Retry Engine Implementation",
    "description": "Implement retry logic with exponential backoff and jitter",
    "priority": "P0",
    "task_type": "dev",
    "estimated_hours": 32,
    "owner": "Caramel",
    "depends_on": ["Phase 2.1"]
  }'

curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 2.3: Douyin Adapter",
    "description": "Implement DouyinAdapter as proof-of-concept",
    "priority": "P0",
    "task_type": "dev",
    "estimated_hours": 40,
    "owner": "Caramel",
    "depends_on": ["Phase 2.1", "Phase 2.2"]
  }'

# Phase 3 Tasks
curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 3.1: State Management API",
    "description": "Build REST API for job submission and status queries",
    "priority": "P0",
    "task_type": "dev",
    "estimated_hours": 32,
    "owner": "Caramel",
    "depends_on": ["Phase 2.3"]
  }'

curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 3.2: BullMQ Integration",
    "description": "Integrate task queue and worker for async processing",
    "priority": "P0",
    "task_type": "dev",
    "estimated_hours": 40,
    "owner": "Caramel",
    "depends_on": ["Phase 3.1"]
  }'

# Phase 4 Tasks
curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 4.1: Comprehensive Testing",
    "description": "Write unit and integration tests, achieve 80%+ coverage",
    "priority": "P1",
    "task_type": "dev",
    "estimated_hours": 40,
    "owner": "QA (小检)",
    "depends_on": ["Phase 3.2"]
  }'

curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 4.2: Monitoring & Alerting",
    "description": "Set up Prometheus, Grafana dashboards, and alert rules",
    "priority": "P1",
    "task_type": "dev",
    "estimated_hours": 40,
    "owner": "Caramel + DevOps",
    "depends_on": ["Phase 3.2"]
  }'

# Phase 5 Tasks
curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 5.1: More Platform Adapters",
    "description": "Implement Xiaohongshu and Weibo adapters",
    "priority": "P1",
    "task_type": "dev",
    "estimated_hours": 48,
    "owner": "Caramel",
    "depends_on": ["Phase 4.1", "Phase 4.2"]
  }'

curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 5.2: Circuit Breaker",
    "description": "Implement circuit breaker pattern for fault tolerance",
    "priority": "P1",
    "task_type": "dev",
    "estimated_hours": 32,
    "owner": "Caramel",
    "depends_on": ["Phase 5.1"]
  }'

curl -X POST "$BASE_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_id": "'$GOAL_ID'",
    "title": "Phase 5.3: E2E & Stress Testing",
    "description": "Conduct full E2E tests and stress testing, validate 95% success rate",
    "priority": "P1",
    "task_type": "dev",
    "estimated_hours": 40,
    "owner": "QA (小检)",
    "depends_on": ["Phase 5.2"]
  }'

echo "All tasks created successfully!"
```

## Manual Task List (Until API is ready)

| Phase | Task ID | Title | Owner | Priority | Estimated Hours | Depends On |
|-------|---------|-------|-------|----------|-----------------|------------|
| 1 | Task-1.1 | Database Schema Review | Caramel | P0 | 16h | - |
| 1 | Task-1.2 | Create Migration Scripts | Caramel | P0 | 24h | Task-1.1 |
| 1 | Task-1.3 | Execute Migration on Dev | Caramel | P0 | 16h | Task-1.2 |
| 2 | Task-2.1 | Platform Adapter Interface | Caramel | P0 | 24h | Task-1.3 |
| 2 | Task-2.2 | Retry Engine Implementation | Caramel | P0 | 32h | Task-2.1 |
| 2 | Task-2.3 | Douyin Adapter | Caramel | P0 | 40h | Task-2.1, Task-2.2 |
| 3 | Task-3.1 | State Management API | Caramel | P0 | 32h | Task-2.3 |
| 3 | Task-3.2 | BullMQ Integration | Caramel | P0 | 40h | Task-3.1 |
| 4 | Task-4.1 | Comprehensive Testing | QA (小检) | P1 | 40h | Task-3.2 |
| 4 | Task-4.2 | Monitoring & Alerting | Caramel + DevOps | P1 | 40h | Task-3.2 |
| 5 | Task-5.1 | More Platform Adapters | Caramel | P1 | 48h | Task-4.1, Task-4.2 |
| 5 | Task-5.2 | Circuit Breaker | Caramel | P1 | 32h | Task-5.1 |
| 5 | Task-5.3 | E2E & Stress Testing | QA (小检) | P1 | 40h | Task-5.2 |

**Total Estimated Hours**: 464 hours (~12 weeks with 1 person, or 10 weeks with 20% buffer)

## Task Dependencies Graph

```
Task-1.1 (Schema Review)
    ↓
Task-1.2 (Migration Scripts)
    ↓
Task-1.3 (Execute Migration)
    ↓
Task-2.1 (Interface) ──┐
    ↓                  │
Task-2.2 (Retry) ──────┤
    ↓                  │
Task-2.3 (Douyin) ←────┘
    ↓
Task-3.1 (API)
    ↓
Task-3.2 (BullMQ)
    ↓
    ├─→ Task-4.1 (Testing) ──┐
    │                        │
    └─→ Task-4.2 (Monitoring) ┤
                             ↓
                        Task-5.1 (More Adapters)
                             ↓
                        Task-5.2 (Circuit Breaker)
                             ↓
                        Task-5.3 (E2E Testing)
```

## Progress Tracking

**Current Status**: Planning Complete (2026-02-06)

| Phase | Status | Progress | Notes |
|-------|--------|----------|-------|
| Phase 0: Planning | ✅ Completed | 100% | This task (documentation and planning) |
| Phase 1: Database | ⏸️ Pending | 0% | Waiting for project kickoff |
| Phase 2: Adapters | ⏸️ Pending | 0% | Depends on Phase 1 |
| Phase 3: API | ⏸️ Pending | 0% | Depends on Phase 2 |
| Phase 4: Testing | ⏸️ Pending | 0% | Depends on Phase 3 |
| Phase 5: Expansion | ⏸️ Pending | 0% | Depends on Phase 4 |

## Next Actions

1. **Immediate** (This Week):
   - [ ] Present this planning document to stakeholders
   - [ ] Get approval for 10-week timeline
   - [ ] Confirm resource allocation (Caramel + QA)

2. **Week 1** (Project Kickoff):
   - [ ] Create tasks in Cecelia system (once API is ready)
   - [ ] Set up zenithjoy-autopilot dev environment
   - [ ] Begin Phase 1: Database Schema Review

3. **Ongoing**:
   - [ ] Weekly progress sync (Mondays 10 AM)
   - [ ] Update task status in Cecelia
   - [ ] Phase review meetings (end of each phase)

---

**Document Status**: ✅ Final
**Approved By**: Pending
**Last Updated**: 2026-02-06
**Related Documents**:
- `docs/workflows/KR22_IMPLEMENTATION_WORKFLOW.md` - Full workflow
- `docs/database/KR22_PUBLISH_ENGINE_SCHEMA.md` - Database schema
- `docs/AGENT_ROUTING.md` - Integration specs
