---
id: kr22-phase5-implementation-plan
version: 1.0.0
created: 2026-02-06
updated: 2026-02-06
changelog:
  - 1.0.0: Initial implementation plan for KR2.2 Phase 5
---

# KR2.2 Phase 5 Implementation Plan

## Executive Summary

This document outlines the detailed implementation plan for KR2.2 Phase 5: Platform Extensions and E2E Testing. This is the final phase of the KR2.2 Unified Publishing Engine project, focusing on:

1. Extending platform support (Xiaohongshu, Weibo)
2. Enhancing system reliability (Dead Letter Queue)
3. Completing end-to-end testing
4. Automating deployment

**Timeline**: 4 weeks (20 working days)
**Priority**: P0 (Critical for KR2.2 completion)
**Implementation Location**: `/home/xx/dev/zenithjoy-autopilot`
**Planning Location**: `/home/xx/dev/cecelia-core` (this document)

## Background

### Context

KR2.2 aims to build a unified publishing engine with >95% success rate across multiple social media platforms. Phase 1-4 have completed:

- ✅ Phase 1: Database foundation (PostgreSQL schema, migrations)
- ✅ Phase 2: Core interfaces (PlatformAdapter base class, DouyinAdapter)
- ✅ Phase 3: API layer (RESTful API, BullMQ integration)
- ✅ Phase 4: Testing and monitoring (Unit tests, Prometheus)

Phase 5 is the final implementation phase before production release.

### Success Metrics

- Platform coverage: 3 platforms (Douyin, Xiaohongshu, Weibo)
- Publishing success rate: >95% for each platform
- E2E test coverage: >80%
- Deployment time: <5 minutes (one-command deployment)

## Phase 5 Task Breakdown

### Task 5.1: Xiaohongshu (小红书) Adapter

**Objective**: Implement XiaohongshuAdapter for content publishing to Xiaohongshu platform

**Duration**: 5 days (Week 1)

#### Technical Design

**Architecture**:
```typescript
class XiaohongshuAdapter extends PlatformAdapter {
  // Inherits from PlatformAdapter base class
  async publish(content: PublishContent): Promise<PublishResult>
  async getStatus(publishId: string): Promise<PublishStatus>
  async delete(publishId: string): Promise<boolean>
}
```

**Authentication Strategy**:
- **Option A**: Xiaohongshu Open Platform API (preferred if available)
  - OAuth 2.0 authentication
  - API token management
  - Rate limiting handling

- **Option B**: Web Automation (fallback)
  - Playwright-based automation
  - Cookie-based session management
  - CAPTCHA handling (manual intervention required)

**Content Publishing**:
- Text + Images (up to 9 images)
- Text + Video (single video, duration limits)
- Hashtag support (#topic)
- Location tagging
- Privacy settings (public/private)

**Error Handling**:
- Network errors → Retry with exponential backoff
- Authentication errors → Re-login and retry
- Content policy violations → Mark as failed, no retry
- Rate limiting → Delay and retry

#### Implementation Steps

**Day 1-2: Research and Setup**
- [ ] Research Xiaohongshu API documentation
- [ ] Determine authentication method (API vs Web Automation)
- [ ] Set up test account and credentials
- [ ] Create adapter skeleton

**Day 3-4: Core Implementation**
- [ ] Implement authentication logic
- [ ] Implement publish() method (text + images)
- [ ] Implement getStatus() method
- [ ] Implement error handling and retry logic

**Day 5: Testing and Documentation**
- [ ] Write unit tests (>80% coverage)
- [ ] Write integration tests
- [ ] Document API usage and limitations
- [ ] Code review and refactoring

#### Acceptance Criteria

- [ ] XiaohongshuAdapter implements all PlatformAdapter methods
- [ ] Supports text + images publishing
- [ ] Supports text + video publishing
- [ ] Authentication works (login + session management)
- [ ] Unit test coverage >80%
- [ ] Integration tests pass
- [ ] Publishing success rate >95% in test environment

#### Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| No official API available | High | High | Prepare web automation fallback |
| Authentication complexity | Medium | Medium | Use cookie-based auth, implement retry |
| Content policy changes | Low | Medium | Implement flexible content validation |
| Rate limiting | Medium | Low | Implement request throttling |

---

### Task 5.2: Weibo (微博) Adapter

**Objective**: Implement WeiboAdapter for content publishing to Weibo platform

**Duration**: 5 days (Week 2)

#### Technical Design

**Architecture**:
```typescript
class WeiboAdapter extends PlatformAdapter {
  async publish(content: PublishContent): Promise<PublishResult>
  async getStatus(publishId: string): Promise<PublishStatus>
  async delete(publishId: string): Promise<boolean>
}
```

**Authentication Strategy**:
- Weibo Open Platform API (official)
  - OAuth 2.0 authentication
  - Access token + refresh token management
  - App key and secret configuration

**Content Publishing**:
- Text (140 characters base, can extend with membership)
- Text + Images (up to 9 images)
- Text + Video (single video)
- @mentions support
- #hashtags support
- Location tagging

**Character Limit Handling**:
- Base limit: 140 characters (Chinese characters)
- Auto-truncation with "..." if exceeded
- Link shortening (Weibo short links)
- Emoji handling (count as 1 character)

#### Implementation Steps

**Day 1-2: Research and Setup**
- [ ] Review Weibo Open Platform documentation
- [ ] Register app and get API credentials
- [ ] Set up OAuth 2.0 authentication flow
- [ ] Create adapter skeleton

**Day 3-4: Core Implementation**
- [ ] Implement OAuth authentication
- [ ] Implement publish() method with character limit handling
- [ ] Implement getStatus() method
- [ ] Implement delete() method
- [ ] Handle image/video upload

**Day 5: Testing and Documentation**
- [ ] Write unit tests (>80% coverage)
- [ ] Write integration tests
- [ ] Test character limit edge cases
- [ ] Document API quirks and limitations

#### Acceptance Criteria

- [ ] WeiboAdapter implements all PlatformAdapter methods
- [ ] Supports text, images, and video publishing
- [ ] Character limit handling works correctly
- [ ] OAuth authentication works (token refresh)
- [ ] Unit test coverage >80%
- [ ] Integration tests pass
- [ ] Publishing success rate >95% in test environment

#### Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| API quota limits | Medium | Medium | Implement rate limiting, request quota monitoring |
| Token expiration handling | Medium | Low | Implement auto-refresh logic |
| Character encoding issues | Low | Medium | Use Unicode-aware character counting |
| Image upload failures | Medium | Medium | Implement retry with exponential backoff |

---

### Task 5.3: Dead Letter Queue (DLQ)

**Objective**: Implement Dead Letter Queue for handling permanently failed tasks

**Duration**: 3 days (Week 2-3)

#### Technical Design

**Architecture**:
```typescript
// BullMQ configuration
const publishQueue = new Queue('publish', {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

// Dead Letter Queue (failed jobs)
const dlq = new Queue('publish-dlq', {
  // Jobs that failed after max retries go here
});
```

**DLQ Rules**:

| Failure Type | Max Retries | Goes to DLQ | Reason |
|-------------|-------------|-------------|--------|
| Network timeout | 3 | Yes | Transient error, retry first |
| Authentication error | 1 | Yes | Need manual intervention |
| Content policy violation | 0 | Yes | No retry (will fail again) |
| Rate limiting | 5 | Yes | Need backoff strategy adjustment |
| Platform unavailable | 10 | Yes | Long-term outage |

**DLQ Monitoring**:
- Prometheus metrics: `publish_dlq_total`, `publish_dlq_by_platform`, `publish_dlq_by_error_type`
- Alert when DLQ size > 10
- Daily DLQ summary report

**Manual Retry Interface**:
```typescript
// API endpoint: POST /api/publish/retry/:jobId
// Move job from DLQ back to main queue
```

#### Implementation Steps

**Day 1: BullMQ DLQ Configuration**
- [ ] Configure BullMQ with DLQ settings
- [ ] Implement retry rules based on error type
- [ ] Implement job failure handler (move to DLQ)

**Day 2: Monitoring and Alerting**
- [ ] Add Prometheus metrics for DLQ
- [ ] Implement DLQ size alert (threshold: 10)
- [ ] Create DLQ dashboard (Grafana)
- [ ] Implement daily DLQ summary email/notification

**Day 3: Manual Retry Interface**
- [ ] Implement retry API endpoint
- [ ] Implement DLQ query API (filter by platform, error type)
- [ ] Write tests for DLQ flow
- [ ] Document DLQ operations

#### Acceptance Criteria

- [ ] BullMQ DLQ configuration complete
- [ ] Failed tasks automatically enter DLQ after max retries
- [ ] DLQ monitoring and alerting functional
- [ ] Manual retry API works
- [ ] DLQ query API works
- [ ] Prometheus metrics available
- [ ] Alert triggers when DLQ size >10
- [ ] All DLQ tests pass

#### Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DLQ grows unbounded | Medium | High | Implement auto-cleanup (remove jobs older than 30 days) |
| Manual retry causes duplicate posts | Low | High | Check if post exists before retry |
| Alert fatigue | Medium | Low | Tune alert thresholds, batch notifications |

---

### Task 5.4: E2E Testing

**Objective**: Write comprehensive end-to-end tests covering full publishing workflows

**Duration**: 4 days (Week 3)

#### Test Scenarios

**Scenario 1: Single Platform Publishing**
```typescript
test('Publish to Douyin successfully', async () => {
  const content = {
    text: 'Test post',
    images: ['image1.jpg'],
    platform: 'douyin'
  };

  const result = await publishAPI.publish(content);
  expect(result.status).toBe('success');
  expect(result.publishId).toBeDefined();
});
```

**Scenario 2: Multi-Platform Publishing**
```typescript
test('Publish to all platforms simultaneously', async () => {
  const content = {
    text: 'Test post',
    images: ['image1.jpg'],
    platforms: ['douyin', 'xiaohongshu', 'weibo']
  };

  const results = await publishAPI.publishMulti(content);
  expect(results).toHaveLength(3);
  expect(results.every(r => r.status === 'success')).toBe(true);
});
```

**Scenario 3: Retry Flow**
```typescript
test('Retry failed publish', async () => {
  // Mock network error
  const result1 = await publishAPI.publish(content);
  expect(result1.status).toBe('failed');

  // Auto-retry after delay
  await sleep(5000);
  const result2 = await publishAPI.getStatus(result1.jobId);
  expect(result2.attempts).toBe(2);
});
```

**Scenario 4: DLQ Flow**
```typescript
test('Failed job enters DLQ after max retries', async () => {
  // Mock persistent failure
  const result = await publishAPI.publish(invalidContent);

  // Wait for all retries
  await sleep(30000);

  const dlqJobs = await dlqAPI.list();
  expect(dlqJobs.some(j => j.id === result.jobId)).toBe(true);
});
```

**Scenario 5: Account Switching**
```typescript
test('Switch between multiple accounts', async () => {
  const result1 = await publishAPI.publish(content, { accountId: 'account1' });
  const result2 = await publishAPI.publish(content, { accountId: 'account2' });

  expect(result1.accountId).toBe('account1');
  expect(result2.accountId).toBe('account2');
});
```

**Scenario 6: Concurrent Publishing**
```typescript
test('Handle 10 concurrent publish requests', async () => {
  const promises = Array(10).fill(null).map(() => publishAPI.publish(content));
  const results = await Promise.all(promises);

  expect(results).toHaveLength(10);
  expect(results.every(r => r.status === 'success' || r.status === 'pending')).toBe(true);
});
```

#### Test Technology Stack

**Framework**: Jest (existing choice in Phase 4)
**Mocking**: Mock platform APIs for deterministic tests
**E2E Tools**: Supertest (API testing), Playwright (if UI testing needed)
**Test Database**: Separate test database with cleanup between tests

#### Implementation Steps

**Day 1: Test Infrastructure**
- [ ] Set up E2E test environment
- [ ] Create test database and seed data
- [ ] Set up API mocking (nock or MSW)
- [ ] Create test helpers and utilities

**Day 2: Core Scenario Tests**
- [ ] Implement Scenario 1-3 tests
- [ ] Implement platform-specific tests
- [ ] Test error handling flows

**Day 3: Advanced Scenario Tests**
- [ ] Implement Scenario 4-6 tests
- [ ] Test DLQ flows
- [ ] Test concurrent publishing
- [ ] Test account management

**Day 4: CI/CD Integration**
- [ ] Add E2E tests to CI pipeline
- [ ] Configure test reporting (coverage, results)
- [ ] Optimize test performance (<5 min total)
- [ ] Document test execution

#### Acceptance Criteria

- [ ] E2E test coverage >80%
- [ ] All 6 core scenarios have tests
- [ ] Tests pass consistently (no flakiness)
- [ ] Tests run in CI/CD automatically
- [ ] Test execution time <5 minutes
- [ ] Test documentation complete
- [ ] Code coverage report generated

#### Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Flaky tests | High | Medium | Use proper mocking, avoid real API calls |
| Long test execution time | Medium | Low | Run tests in parallel, optimize setup/teardown |
| Test data conflicts | Low | Medium | Use isolated test database, cleanup between tests |
| Mock data diverges from real API | Medium | Medium | Regularly update mocks based on real API responses |

---

### Task 5.5: Deployment Automation

**Objective**: Create deployment script for one-command deployment to production

**Duration**: 3 days (Week 4)

#### Deployment Architecture

**Deployment Path**: US VPS (dev) → HK VPS (prod)

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  US VPS (Dev)           │         │  HK VPS (Prod)          │
│  146.190.52.84          │─────────▶│  43.154.85.217          │
│                         │ Tailscale│                         │
│  - cecelia-core         │  + rsync │  - zenithjoy-autopilot  │
│  - Development          │          │  - Production           │
└─────────────────────────┘          └─────────────────────────┘
```

**Deployment Method**: Tailscale + rsync (as per CLAUDE.md standard)

**Why not CI/CD?**:
- SSH keys in GitHub are a security risk
- Network instability between regions
- Difficult debugging
- Tailscale provides stable internal network
- rsync is reliable and allows incremental updates

#### deploy.sh Script Design

**Location**: `/home/xx/dev/zenithjoy-autopilot/deploy/deploy.sh`

**Script Structure**:
```bash
#!/bin/bash
# deploy.sh - Deploy zenithjoy-autopilot to production (HK VPS)

set -e  # Exit on error

TARGET_ENV=$1  # prod | test

# 1. Pre-flight checks
echo "🔍 Pre-flight checks..."
./deploy/health-check.sh local || exit 1

# 2. Backup current production
echo "💾 Backing up production..."
ssh hk "cd /home/xx/deploy/zenithjoy-autopilot && tar -czf backup-\$(date +%Y%m%d-%H%M%S).tar.gz ."

# 3. Sync files via Tailscale
echo "📦 Syncing files..."
rsync -avz --exclude node_modules --exclude .git \
  /home/xx/dev/zenithjoy-autopilot/ \
  hk:/home/xx/deploy/zenithjoy-autopilot/

# 4. Install dependencies and run migrations
echo "📦 Installing dependencies..."
ssh hk "cd /home/xx/deploy/zenithjoy-autopilot && npm install --production"

echo "🗄️  Running database migrations..."
ssh hk "cd /home/xx/deploy/zenithjoy-autopilot && npm run migrate"

# 5. Restart service
echo "🔄 Restarting service..."
ssh hk "pm2 restart zenithjoy-autopilot"

# 6. Health check
echo "🏥 Health check..."
sleep 5
./deploy/health-check.sh hk || {
  echo "❌ Health check failed, rolling back..."
  ./deploy/rollback.sh
  exit 1
}

echo "✅ Deployment successful!"
```

**health-check.sh**:
```bash
#!/bin/bash
# Check if service is healthy

ENV=$1  # local | hk

if [[ "$ENV" == "local" ]]; then
  curl -f http://localhost:5212/health || exit 1
elif [[ "$ENV" == "hk" ]]; then
  ssh hk "curl -f http://localhost:5212/health" || exit 1
fi

echo "✅ Health check passed"
```

**rollback.sh**:
```bash
#!/bin/bash
# Rollback to previous version

echo "⏮️  Rolling back..."
BACKUP=$(ssh hk "ls -t /home/xx/deploy/zenithjoy-autopilot/backup-*.tar.gz | head -1")
ssh hk "cd /home/xx/deploy/zenithjoy-autopilot && tar -xzf $BACKUP"
ssh hk "pm2 restart zenithjoy-autopilot"
echo "✅ Rollback complete"
```

#### Implementation Steps

**Day 1: Script Development**
- [ ] Create deploy.sh main script
- [ ] Create health-check.sh script
- [ ] Create rollback.sh script
- [ ] Test scripts in test environment

**Day 2: Integration and Testing**
- [ ] Test deployment to HK VPS test environment
- [ ] Test rollback functionality
- [ ] Test health check failure scenarios
- [ ] Verify database migration execution

**Day 3: Documentation and Finalization**
- [ ] Write deployment runbook
- [ ] Document common deployment issues and solutions
- [ ] Add deployment to CI/CD (optional: run tests before deploy)
- [ ] Train team on deployment process

#### Acceptance Criteria

- [ ] deploy.sh script complete and tested
- [ ] Deployment to HK VPS successful
- [ ] Backup creation works
- [ ] Rollback mechanism works
- [ ] Health check catches failures
- [ ] Deployment time <5 minutes
- [ ] Documentation complete (runbook)
- [ ] No manual steps required

#### Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Rsync failure mid-deploy | Low | High | Use rsync --partial, implement retry |
| Database migration failure | Medium | High | Test migrations in staging first |
| Health check false negative | Low | Medium | Implement retry with backoff |
| Rollback failure | Low | Critical | Test rollback regularly, keep multiple backups |

---

## Timeline and Milestones

### Week 1: Xiaohongshu Adapter
- **Day 1-2**: Research and setup
- **Day 3-4**: Core implementation
- **Day 5**: Testing and documentation
- **Milestone**: XiaohongshuAdapter working with >95% success rate

### Week 2: Weibo Adapter + DLQ
- **Day 1-2**: Weibo research and setup
- **Day 3**: Weibo implementation
- **Day 4**: Weibo testing
- **Day 5**: DLQ implementation (Day 1)
- **Milestone**: WeiboAdapter working, DLQ configured

### Week 3: DLQ + E2E Testing
- **Day 1-2**: DLQ monitoring and manual retry (Day 2-3)
- **Day 3-4**: E2E test infrastructure and core scenarios
- **Day 5**: E2E advanced scenarios
- **Milestone**: DLQ complete, E2E tests >50% coverage

### Week 4: E2E + Deployment
- **Day 1**: E2E CI/CD integration (Day 4)
- **Day 2-4**: Deployment automation (Day 1-3)
- **Day 5**: Final integration testing and documentation
- **Milestone**: All Phase 5 tasks complete, ready for production

## Dependencies

### Upstream Dependencies

| Dependency | Status | Required For |
|-----------|--------|--------------|
| Phase 1-4 complete | ✅ Complete | All Phase 5 tasks |
| PostgreSQL database | ✅ Available | Adapter implementation |
| BullMQ running | ✅ Available | DLQ implementation |
| Test environment | ✅ Available | All testing |
| HK VPS access | ✅ Available | Deployment |
| Tailscale network | ✅ Available | Deployment |

### Downstream Impact

| Impact Area | Description |
|-------------|-------------|
| Production readiness | Phase 5 completion enables KR2.2 v1.0.0 release |
| User onboarding | Can start onboarding users to all 3 platforms |
| Performance testing | Can run stress tests after E2E tests complete |
| Documentation | Need user documentation for 3-platform publishing |

## Risk Management

### High-Priority Risks

| Risk | Mitigation | Owner | Status |
|------|-----------|-------|--------|
| Platform API unavailable | Prepare web automation fallback | Dev Team | Monitoring |
| E2E tests too slow | Parallelize tests, optimize mocking | QA Team | To Address |
| Deployment failure on first try | Test in staging first, have rollback ready | DevOps | Prepared |

### Medium-Priority Risks

| Risk | Mitigation | Owner | Status |
|------|-----------|-------|--------|
| Character encoding issues (Weibo) | Use Unicode-aware counting, extensive testing | Dev Team | To Address |
| DLQ grows unbounded | Implement auto-cleanup (30-day retention) | Dev Team | To Implement |
| Rate limiting hits hard limits | Implement request queuing, priority queue | Dev Team | To Implement |

### Low-Priority Risks

| Risk | Mitigation | Owner | Status |
|------|-----------|-------|--------|
| Test data conflicts | Use isolated test DB, cleanup between tests | QA Team | To Implement |
| Alert fatigue from DLQ | Tune alert thresholds, batch notifications | DevOps | To Tune |

## Resource Requirements

### Personnel

| Role | Allocation | Tasks |
|------|-----------|-------|
| Backend Developer | 100% (4 weeks) | Adapter implementation, DLQ |
| QA Engineer | 50% (Week 3) | E2E test design and implementation |
| DevOps Engineer | 50% (Week 4) | Deployment script, infrastructure |
| Tech Lead | 20% (4 weeks) | Code review, architecture guidance |

### Infrastructure

| Resource | Usage | Cost |
|----------|-------|------|
| US VPS (Dev) | Development and testing | Existing |
| HK VPS (Prod) | Production deployment target | Existing |
| Test accounts (3 platforms) | Adapter testing | Free (using personal accounts) |
| Tailscale | Secure deployment channel | Free tier |

## Success Criteria

### Functional Requirements

- [ ] XiaohongshuAdapter works with >95% success rate
- [ ] WeiboAdapter works with >95% success rate
- [ ] DLQ captures all permanently failed tasks
- [ ] E2E test coverage >80%
- [ ] One-command deployment works (<5 min)

### Non-Functional Requirements

- [ ] All code passes audit (L1+L2=0)
- [ ] All documentation complete with version numbers
- [ ] Deployment runbook created and tested
- [ ] Team trained on new features

### Business Impact

- [ ] KR2.2 v1.0.0 ready for release
- [ ] Can support 3 platforms simultaneously
- [ ] System reliability improved with DLQ
- [ ] Fast iteration enabled by deployment automation

## Appendix

### A. Platform API References

- **Xiaohongshu**: https://open.xiaohongshu.com/docs (if available)
- **Weibo**: https://open.weibo.com/wiki/API文档
- **Douyin**: https://open.douyin.com/platform (reference, already implemented)

### B. Code Structure

```
zenithjoy-autopilot/
├── src/
│   ├── adapters/
│   │   ├── PlatformAdapter.ts        # Base class (existing)
│   │   ├── DouyinAdapter.ts          # Existing
│   │   ├── XiaohongshuAdapter.ts     # NEW
│   │   └── WeiboAdapter.ts           # NEW
│   ├── queue/
│   │   ├── publishQueue.ts           # Existing
│   │   └── deadLetterQueue.ts        # NEW
│   └── config/
│       └── platforms.ts              # Add Xiaohongshu, Weibo
├── tests/
│   ├── unit/
│   │   ├── XiaohongshuAdapter.test.ts # NEW
│   │   └── WeiboAdapter.test.ts       # NEW
│   ├── integration/
│   │   └── dlq.test.ts                # NEW
│   └── e2e/
│       ├── publish-flow.test.ts       # NEW
│       ├── retry-flow.test.ts         # NEW
│       └── dlq-flow.test.ts           # NEW
└── deploy/
    ├── deploy.sh                     # NEW
    ├── health-check.sh               # NEW
    └── rollback.sh                   # NEW
```

### C. Configuration Files

**platforms.ts** (additions):
```typescript
export const PLATFORMS = {
  douyin: {
    name: 'Douyin',
    apiBase: 'https://open.douyin.com',
    rateLimit: 100 // requests per minute
  },
  xiaohongshu: {
    name: 'Xiaohongshu',
    apiBase: 'https://open.xiaohongshu.com', // TBD
    rateLimit: 50
  },
  weibo: {
    name: 'Weibo',
    apiBase: 'https://api.weibo.com',
    rateLimit: 150
  }
};
```

### D. Monitoring Dashboards

**Grafana Dashboard**: KR2.2 Publishing Metrics

- Publishing success rate by platform
- DLQ size over time
- Retry attempt distribution
- Platform API response time
- Error rate by error type

### E. Deployment Checklist

Before deploying to production:

- [ ] All Phase 5 tasks complete
- [ ] All tests pass (unit, integration, E2E)
- [ ] Code review approved
- [ ] Audit report clean (L1+L2=0)
- [ ] Database migrations tested in staging
- [ ] Rollback procedure tested
- [ ] Team briefed on new features
- [ ] Monitoring alerts configured
- [ ] User documentation updated

---

**Document Status**: Draft
**Review Status**: Pending
**Approval**: Pending
**Next Review Date**: 2026-02-13 (after Week 1)
