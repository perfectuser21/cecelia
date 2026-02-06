---
id: kr22-implementation-workflow
version: 1.0.0
created: 2026-02-06
updated: 2026-02-06
changelog:
  - 1.0.0: Initial implementation workflow for KR2.2 Unified Publish Engine
---

# KR2.2 Unified Publish Engine - Implementation Workflow

> **Goal**: Build a unified publishing engine with ≥95% API success rate
> **Timeline**: 10 weeks (2.5 months)
> **Start Date**: TBD
> **End Date**: TBD

## Executive Summary

This document defines the implementation workflow for KR2.2: Unified Publish Engine. Based on the [technical design document](../research/KR22-UNIFIED-PUBLISH-ENGINE.md), this workflow breaks down the implementation into 5 phases with 15 concrete tasks.

## Phase Overview

| Phase | Duration | Key Deliverables | Owner | Dependencies |
|-------|----------|------------------|-------|--------------|
| Phase 1: Database Foundation | 2 weeks | Database schema, migrations | Caramel (焦糖) | None |
| Phase 2: Platform Adapters | 3 weeks | IPlatformAdapter, DouyinAdapter, RetryEngine | Caramel (焦糖) | Phase 1 |
| Phase 3: API Layer | 2 weeks | REST API, BullMQ integration | Caramel (焦糖) | Phase 2 |
| Phase 4: Testing & Monitoring | 2 weeks | Tests, Prometheus, Grafana | QA (小检) | Phase 3 |
| Phase 5: Expansion & Optimization | 3 weeks | More adapters, circuit breaker, E2E tests | Caramel + QA | Phase 4 |

**Total**: 12 weeks (with 20% buffer from original 10 weeks)

---

## Phase 1: Database Foundation (2 weeks)

### Goals

- Establish database schema for publish engine
- Create migration scripts
- Verify schema correctness

### Tasks

#### Task 1.1: Database Schema Design Review

**Owner**: Caramel (焦糖)
**Duration**: 2 days
**Priority**: P0

**Inputs**:
- Technical design doc: `docs/research/KR22-UNIFIED-PUBLISH-ENGINE.md` Section 3.1.2
- Existing zenithjoy-autopilot database schema

**Outputs**:
- Reviewed SQL schema with any necessary adjustments
- Schema review document (if changes needed)

**Acceptance Criteria**:
- [ ] Schema covers all 3 tables: `publish_jobs`, `publish_records`, `platform_credentials`
- [ ] Indexes are optimized for query patterns
- [ ] Foreign keys and constraints are correct
- [ ] UUID vs. serial ID decision is documented

**Commands**:
```bash
# Read existing schema
psql -U postgres -d zenithjoy -c "\dt"
psql -U postgres -d zenithjoy -c "\d <existing_table>"
```

---

#### Task 1.2: Create Migration Scripts

**Owner**: Caramel (焦糖)
**Duration**: 3 days
**Priority**: P0
**Depends On**: Task 1.1

**Inputs**:
- Finalized schema design
- Migration framework (node-pg-migrate, Flyway, or raw SQL)

**Outputs**:
- `zenithjoy-autopilot/database/migrations/20260206_create_publish_engine_tables.sql`
- Rollback script: `20260206_drop_publish_engine_tables.sql`

**Acceptance Criteria**:
- [ ] Migration script can be executed without errors
- [ ] Rollback script successfully removes all created objects
- [ ] Migration is idempotent (can be run multiple times safely)
- [ ] Indexes are created after tables for performance

**SQL Structure**:
```sql
-- Forward migration
BEGIN;

CREATE TABLE IF NOT EXISTS publish_jobs (...);
CREATE TABLE IF NOT EXISTS publish_records (...);
CREATE TABLE IF NOT EXISTS platform_credentials (...);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_status ON publish_jobs(status);
-- ... more indexes

COMMIT;
```

**Test Commands**:
```bash
# Test on local PostgreSQL
psql -U postgres -d test_db -f migrations/20260206_create_publish_engine_tables.sql

# Verify tables created
psql -U postgres -d test_db -c "\dt publish_*"

# Test rollback
psql -U postgres -d test_db -f migrations/20260206_drop_publish_engine_tables.sql
```

---

#### Task 1.3: Execute Migration on Dev Environment

**Owner**: Caramel (焦糖)
**Duration**: 2 days
**Priority**: P0
**Depends On**: Task 1.2

**Inputs**:
- Tested migration scripts
- Access to zenithjoy-autopilot dev database

**Outputs**:
- Migration executed on dev DB
- Schema verification report

**Acceptance Criteria**:
- [ ] Migration runs successfully on dev environment
- [ ] All tables and indexes are created
- [ ] No data loss or conflicts with existing schema
- [ ] Database backup taken before migration

**Commands**:
```bash
# Backup dev database first
pg_dump -U postgres -d zenithjoy_dev > backup_pre_kr22_$(date +%Y%m%d).sql

# Run migration
psql -U postgres -d zenithjoy_dev -f migrations/20260206_create_publish_engine_tables.sql

# Verify
psql -U postgres -d zenithjoy_dev -c "SELECT * FROM publish_jobs LIMIT 0"
```

---

### Phase 1 Exit Criteria

- [ ] All 3 tasks (1.1, 1.2, 1.3) completed
- [ ] Database schema exists in dev environment
- [ ] Migration scripts are committed to git
- [ ] Rollback scripts tested and work correctly

---

## Phase 2: Platform Adapters (3 weeks)

### Goals

- Define platform adapter interface
- Implement first adapter (Douyin) as proof-of-concept
- Implement retry engine with intelligent backoff

### Tasks

#### Task 2.1: Platform Adapter Interface Definition

**Owner**: Caramel (焦糖)
**Duration**: 3 days
**Priority**: P0
**Depends On**: Phase 1

**Inputs**:
- Technical design doc Section 3.2.1
- Industry best practices (Buffer, Hootsuite)

**Outputs**:
- `zenithjoy-autopilot/core/publish-engine/interfaces/platform-adapter.interface.ts`
- `zenithjoy-autopilot/core/publish-engine/interfaces/publish-content.interface.ts`
- `zenithjoy-autopilot/core/publish-engine/interfaces/publish-result.interface.ts`

**Acceptance Criteria**:
- [ ] `IPlatformAdapter` interface defined with all required methods
- [ ] `PublishContent`, `PublishResult`, `PublishError` types defined
- [ ] JSDoc comments for all public interfaces
- [ ] TypeScript strict mode passes

**Code Structure**:
```typescript
interface IPlatformAdapter {
  readonly name: string;
  publish(content: PublishContent, credentials: Credentials): Promise<PublishResult>;
  validateCredentials(credentials: Credentials): Promise<boolean>;
  refreshCredentials(credentials: Credentials): Promise<Credentials>;
  getPublishStatus(postId: string): Promise<PublishStatus>;
  getRateLimits(): RateLimitConfig;
}
```

---

#### Task 2.2: Retry Engine Implementation

**Owner**: Caramel (焦糖)
**Duration**: 4 days
**Priority**: P0
**Depends On**: Task 2.1

**Inputs**:
- Technical design doc Section 3.2.2 (Retry Strategy)
- Error classification logic

**Outputs**:
- `zenithjoy-autopilot/core/publish-engine/retry/retry-engine.ts`
- `zenithjoy-autopilot/core/publish-engine/retry/retry-policy.ts`
- `zenithjoy-autopilot/core/publish-engine/retry/error-classifier.ts`
- Unit tests: `tests/publish-engine/retry-engine.test.ts`

**Acceptance Criteria**:
- [ ] Exponential backoff with jitter implemented
- [ ] Error classification (retryable vs. non-retryable)
- [ ] Max retries configurable
- [ ] Platform-suggested `retryAfter` honored
- [ ] Unit test coverage ≥ 80%

**Test Cases**:
- Retry succeeds on 2nd attempt after network timeout
- Non-retryable error (content rejected) fails immediately
- Jitter prevents thundering herd (test delay variance)
- Max retries limit respected

---

#### Task 2.3: Douyin Adapter Implementation

**Owner**: Caramel (焦糖)
**Duration**: 5 days
**Priority**: P0
**Depends On**: Task 2.1, 2.2

**Inputs**:
- `IPlatformAdapter` interface
- Douyin API documentation (or mock if unavailable)
- RetryEngine

**Outputs**:
- `zenithjoy-autopilot/core/publish-engine/adapters/base.adapter.ts` (abstract base class)
- `zenithjoy-autopilot/core/publish-engine/adapters/douyin.adapter.ts`
- Unit tests with mocks: `tests/publish-engine/douyin-adapter.test.ts`

**Acceptance Criteria**:
- [ ] DouyinAdapter implements IPlatformAdapter
- [ ] BaseAdapter provides common functionality (retry integration, logging)
- [ ] Authentication handled (cookie, token, or OAuth)
- [ ] Error responses mapped to PublishError types
- [ ] Rate limits defined
- [ ] Unit tests with mocked HTTP calls pass

**Test Strategy**:
- Mock Douyin API responses (success, timeout, rate limit, auth failure)
- Test credential validation
- Test publish success path
- Test error handling paths

---

### Phase 2 Exit Criteria

- [ ] All 3 tasks (2.1, 2.2, 2.3) completed
- [ ] IPlatformAdapter interface finalized
- [ ] RetryEngine passes all unit tests
- [ ] DouyinAdapter can publish (mock test passes)
- [ ] Code review completed

---

## Phase 3: API Layer (2 weeks)

### Goals

- Build REST API for job submission and status queries
- Integrate BullMQ task queue
- Implement state management (CRUD operations)

### Tasks

#### Task 3.1: State Management API

**Owner**: Caramel (焦糖)
**Duration**: 4 days
**Priority**: P0
**Depends On**: Phase 2

**Inputs**:
- Database schema (Phase 1)
- REST API design principles

**Outputs**:
- `zenithjoy-autopilot/core/api/publish/jobs.controller.ts`
- `zenithjoy-autopilot/core/api/publish/jobs.service.ts`
- API routes: POST /api/publish/jobs, GET /api/publish/jobs/:id
- Integration tests

**Acceptance Criteria**:
- [ ] POST /api/publish/jobs creates a new publish job
- [ ] GET /api/publish/jobs/:id returns job status
- [ ] GET /api/publish/jobs/:id/records returns platform-specific records
- [ ] Proper error handling (400, 404, 500)
- [ ] Request validation (Joi or Zod)
- [ ] Integration tests pass

**API Spec**:
```typescript
POST /api/publish/jobs
Body: {
  "content_id": "uuid",
  "platforms": ["douyin", "xiaohongshu"],
  "scheduled_at": "2026-02-10T10:00:00Z" // optional
}
Response: { "job_id": "uuid", "status": "pending" }

GET /api/publish/jobs/:id
Response: {
  "id": "uuid",
  "status": "running",
  "platforms": ["douyin", "xiaohongshu"],
  "records": [
    { "platform": "douyin", "status": "success", "post_id": "123" },
    { "platform": "xiaohongshu", "status": "pending" }
  ]
}
```

---

#### Task 3.2: BullMQ Task Queue Integration

**Owner**: Caramel (焦糖)
**Duration**: 5 days
**Priority**: P0
**Depends On**: Task 3.1

**Inputs**:
- BullMQ documentation
- Redis connection (or pg-boss as alternative)
- Platform adapters (Phase 2)

**Outputs**:
- `zenithjoy-autopilot/core/publish-engine/queue/publish-queue.ts`
- `zenithjoy-autopilot/core/publish-engine/queue/publish-worker.ts`
- Queue configuration
- Worker concurrency settings

**Acceptance Criteria**:
- [ ] Jobs are enqueued to BullMQ when API receives POST request
- [ ] Worker picks up jobs and calls appropriate Platform Adapter
- [ ] Retry logic integrated with BullMQ's built-in retry mechanism
- [ ] Job status updates in database (pending → running → success/failed)
- [ ] Priority queue works (urgent jobs processed first)
- [ ] Scheduled jobs execute at correct time

**Test Cases**:
- Submit job → Worker processes → Status updates
- Job fails → Retries 3 times → Moves to dead letter queue
- Scheduled job waits until scheduled time

---

### Phase 3 Exit Criteria

- [ ] All 2 tasks (3.1, 3.2) completed
- [ ] API can create and query jobs
- [ ] Worker processes jobs asynchronously
- [ ] Database state reflects job progress
- [ ] Integration tests pass

---

## Phase 4: Testing & Monitoring (2 weeks)

### Goals

- Achieve sufficient test coverage
- Set up Prometheus metrics and Grafana dashboards
- Configure alerting for low success rates

### Tasks

#### Task 4.1: Comprehensive Testing

**Owner**: QA (小检)
**Duration**: 5 days
**Priority**: P1
**Depends On**: Phase 3

**Inputs**:
- All code from Phases 1-3
- Test framework (Jest)

**Outputs**:
- Unit tests for all core modules
- Integration tests for API + Worker flow
- E2E test (minimal, full E2E in Phase 5)
- Test coverage report

**Acceptance Criteria**:
- [ ] Unit test coverage ≥ 80%
- [ ] Integration tests cover happy path and error paths
- [ ] CI pipeline runs tests automatically
- [ ] All tests pass consistently

**Test Plan**:
| Component | Test Type | Coverage Target |
|-----------|-----------|-----------------|
| RetryEngine | Unit | 90% |
| DouyinAdapter | Unit (mocked) | 85% |
| API Controllers | Integration | 80% |
| Worker | Integration | 80% |

---

#### Task 4.2: Monitoring & Alerting Setup

**Owner**: Caramel (焦糖) + DevOps (诺贝)
**Duration**: 5 days
**Priority**: P1
**Depends On**: Phase 3

**Inputs**:
- Prometheus, Grafana, Alertmanager setup guides
- Monitoring requirements (success rate, latency, etc.)

**Outputs**:
- `prometheus.yml` config
- Grafana dashboard JSON
- `alert-rules.yaml`
- Metrics export in code (`prom-client`)

**Acceptance Criteria**:
- [ ] Prometheus scrapes metrics from publish API
- [ ] Grafana dashboard shows:
  - Success rate (overall and per-platform)
  - P50, P95, P99 latency
  - Active workers
  - Queue depth
- [ ] Alert fires when success rate < 95%
- [ ] Alert fires when P95 latency > 10s

**Metrics**:
```typescript
// Example metrics to export
publishCounter.labels({ platform: 'douyin', status: 'success' }).inc();
publishDuration.labels({ platform: 'douyin' }).observe(durationSeconds);
publishSuccessRate.labels({ platform: 'douyin' }).set(0.97);
```

---

### Phase 4 Exit Criteria

- [ ] All 2 tasks (4.1, 4.2) completed
- [ ] Test coverage ≥ 80%
- [ ] Monitoring dashboard operational
- [ ] Alerts configured and tested

---

## Phase 5: Expansion & Optimization (3 weeks)

### Goals

- Add more platform adapters (Xiaohongshu, Weibo)
- Implement circuit breaker for fault tolerance
- Conduct full E2E and stress testing

### Tasks

#### Task 5.1: Xiaohongshu and Weibo Adapters

**Owner**: Caramel (焦糖)
**Duration**: 6 days
**Priority**: P1
**Depends On**: Phase 4

**Inputs**:
- IPlatformAdapter interface
- Xiaohongshu and Weibo API docs
- DouyinAdapter as reference

**Outputs**:
- `zenithjoy-autopilot/core/publish-engine/adapters/xiaohongshu.adapter.ts`
- `zenithjoy-autopilot/core/publish-engine/adapters/weibo.adapter.ts`
- Unit tests for both adapters

**Acceptance Criteria**:
- [ ] XiaohongshuAdapter implements IPlatformAdapter
- [ ] WeiboAdapter implements IPlatformAdapter
- [ ] Both adapters pass unit tests (mocked)
- [ ] Rate limits configured for each platform
- [ ] Error handling tested

---

#### Task 5.2: Circuit Breaker Implementation

**Owner**: Caramel (焦糖)
**Duration**: 4 days
**Priority**: P1
**Depends On**: Task 5.1

**Inputs**:
- Circuit breaker pattern (Martin Fowler)
- Existing retry engine

**Outputs**:
- `zenithjoy-autopilot/core/publish-engine/fault-tolerance/circuit-breaker.ts`
- Integration with Platform Adapters
- Unit tests

**Acceptance Criteria**:
- [ ] Circuit opens after N consecutive failures (e.g., 5)
- [ ] Circuit half-opens after timeout to test recovery
- [ ] Circuit closes when platform recovers
- [ ] Metrics track circuit breaker state (closed/open/half-open)
- [ ] Unit tests verify state transitions

**Test Cases**:
- Platform fails 5 times → Circuit opens → Requests fail fast
- After timeout → Half-open → Test request succeeds → Circuit closes

---

#### Task 5.3: E2E Testing and Stress Testing

**Owner**: QA (小检)
**Duration**: 5 days
**Priority**: P1
**Depends On**: Task 5.2

**Inputs**:
- Fully integrated publish engine
- Test data (sample content)
- Load testing tool (k6, JMeter)

**Outputs**:
- E2E test suite (real platform publishing if possible, or staging)
- Stress test report
- Performance optimization recommendations

**Acceptance Criteria**:
- [ ] E2E test: Submit job → Publish to 3 platforms → Verify success rate ≥ 95%
- [ ] Stress test: 100 QPS for 10 minutes → Success rate ≥ 90%
- [ ] Identify bottlenecks (database, Redis, API)
- [ ] No memory leaks or crashes under load

**Stress Test Plan**:
| Scenario | QPS | Duration | Expected Success Rate |
|----------|-----|----------|------------------------|
| Normal load | 10 | 1 hour | ≥ 95% |
| Peak load | 100 | 10 min | ≥ 90% |
| Sustained peak | 50 | 30 min | ≥ 93% |

---

### Phase 5 Exit Criteria

- [ ] All 3 tasks (5.1, 5.2, 5.3) completed
- [ ] 3 platform adapters working
- [ ] Circuit breaker prevents cascading failures
- [ ] E2E tests pass with ≥ 95% success rate
- [ ] Stress tests show acceptable performance

---

## Success Metrics

### Key Results (KR2.2 Definition)

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Publish Success Rate** | ≥ 95% | (Successful publishes / Total requests) × 100% |
| **P50 Response Time** | ≤ 5s | Prometheus histogram (publish_duration_seconds P50) |
| **P95 Response Time** | ≤ 10s | Prometheus histogram (publish_duration_seconds P95) |
| **System Uptime** | ≥ 99.9% | (Uptime / Total time) × 100% over 30 days |

### Phase-wise Success Criteria

| Phase | Primary KPI | Target |
|-------|-------------|--------|
| Phase 1 | Database migration success | 100% (no errors) |
| Phase 2 | Unit test coverage | ≥ 80% |
| Phase 3 | API response time (P95) | ≤ 2s (before worker processing) |
| Phase 4 | Test coverage | ≥ 80%, Monitoring operational |
| Phase 5 | E2E success rate | ≥ 95% |

---

## Risk Management

### Top Risks

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| **Platform API changes** | Medium | High | Version detection, maintain old adapters for 1 month |
| **Performance bottlenecks** | Medium | Medium | Stress test early (Phase 4), optimize before Phase 5 |
| **Douyin API docs incomplete** | High | Medium | Start with mock tests, parallel track API exploration |
| **Redis reliability issues** | Low | High | Redis Sentinel for HA, or use pg-boss as fallback |
| **Timeline overrun** | Medium | Medium | 20% buffer already included, weekly progress reviews |

### Escalation Path

1. **Technical blockers**: Caramel → Engineering Lead (焦糖 → 工程负责人)
2. **Platform API issues**: Caramel → ZenithJoy Product Manager
3. **Infrastructure issues**: DevOps (诺贝) → Infrastructure Lead
4. **Timeline risks**: Project Manager → Stakeholders

---

## Communication Plan

### Weekly Sync

**When**: Every Monday 10:00 AM
**Attendees**: Caramel, QA (小检), Project Manager
**Agenda**:
- Last week progress review
- Current week plan
- Blockers and risks
- Demo (if applicable)

### Phase Review

**When**: End of each phase
**Attendees**: Engineering team + Stakeholders
**Agenda**:
- Phase deliverables demo
- Metrics review (test coverage, success rate, etc.)
- Lessons learned
- Next phase kickoff

### Status Reports

**Frequency**: Weekly (Friday EOD)
**Format**: Written update in Notion or email
**Contents**:
- Completed tasks
- In-progress tasks
- Blockers
- Next week plan

---

## Rollout Plan

### Dev Environment

**Timeline**: Phase 1-3 (Weeks 1-7)
**Activities**:
- Database migration on dev DB
- Code deployment to dev server
- Internal testing

### Staging Environment

**Timeline**: Phase 4 (Weeks 8-9)
**Activities**:
- Deploy to staging
- Full E2E testing
- Performance tuning

### Production Rollout

**Timeline**: End of Phase 5 (Week 12)
**Strategy**: Gradual rollout (10% → 50% → 100% of traffic)
**Steps**:
1. Deploy to prod, route 10% of publish requests to new engine
2. Monitor success rate for 24 hours
3. If success rate ≥ 95%, increase to 50%
4. Monitor for 48 hours
5. If still ≥ 95%, route 100%

**Rollback Plan**:
- Keep old publishing code active
- Feature flag to switch between old/new engines
- If success rate drops < 90%, immediate rollback

---

## Post-Implementation

### Maintenance

**Owner**: Caramel (焦糖) → On-call rotation
**Activities**:
- Monitor alerts
- Fix bugs
- Update adapters when platform APIs change

### Future Enhancements

1. Add B站 (Bilibili) adapter (Week 15-16)
2. Add YouTube adapter (Week 17-18)
3. Implement content pre-screening for rule compliance (Week 19-20)
4. Add webhook callbacks for publish status updates (Week 21)

---

## Appendix A: Task Dependencies Graph

```
Phase 1
  Task 1.1 (Schema Review)
    ↓
  Task 1.2 (Migration Scripts)
    ↓
  Task 1.3 (Execute Migration)
    ↓
Phase 2
  Task 2.1 (Interface Definition) ──┐
    ↓                                │
  Task 2.2 (Retry Engine)            │
    ↓                                │
  Task 2.3 (Douyin Adapter) ←───────┘
    ↓
Phase 3
  Task 3.1 (State Management API)
    ↓
  Task 3.2 (BullMQ Integration)
    ↓
Phase 4
  Task 4.1 (Testing) ←───────┐
    ↓                        │
  Task 4.2 (Monitoring) ─────┘
    ↓
Phase 5
  Task 5.1 (More Adapters)
    ↓
  Task 5.2 (Circuit Breaker)
    ↓
  Task 5.3 (E2E & Stress Test)
```

---

## Appendix B: Technology Stack Summary

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Language | TypeScript | Type safety, Node.js ecosystem |
| Framework | Express or Fastify | REST API |
| Database | PostgreSQL | Existing infrastructure |
| Task Queue | BullMQ (Redis) | Performance, priority support |
| HTTP Client | axios | Mature, widely used |
| Monitoring | Prometheus + Grafana | Open-source, industry standard |
| Testing | Jest | Mature, widely adopted |
| Deployment | Docker + Docker Compose | Containerization, easy scaling |

---

## Appendix C: Reference Documents

1. **Technical Design**: `docs/research/KR22-UNIFIED-PUBLISH-ENGINE.md`
2. **Research Learnings**: `docs/LEARNING-KR22-RESEARCH.md`
3. **Audit Report**: `docs/AUDIT-REPORT-KR22-RESEARCH.md`
4. **Project OKR**: `/home/xx/dev/perfect21-platform/zenithjoy/OKR.md` (O1-KR3)

---

**Document Status**: ✅ Final
**Approved By**: Pending
**Last Updated**: 2026-02-06
**Next Review**: 2026-02-13 (1 week after project kickoff)
