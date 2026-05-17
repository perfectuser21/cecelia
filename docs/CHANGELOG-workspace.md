# Changelog

## [1.28.0] - 2026-02-17

### Added
- Historical Drop-off Analysis feature for user churn analysis
- Cohort Analysis with weekly/monthly grouping and retention tracking
- Funnel Analysis to identify drop-off points in user journey
- Drop-off Detector with risk scoring for at-risk users
- Analysis API routes: /api/analysis/cohorts, /api/analysis/funnel, /api/analysis/dropoff, /api/analysis/complete
- Comprehensive unit tests for all analysis components (80%+ coverage)
- Integration tests for Analysis API endpoints

## [1.23.0] - 2026-02-12

### Added
- Observability Dashboard UI - Real-time execution monitoring and failure analysis
- ActiveRunsPanel component with 5-second auto-refresh
- ExecutionTraceViewer with layer visualization (L0-L4)
- FailureAnalysisChart showing Top 10 failure reasons with reason_kind colors
- StuckDetectionPanel for detecting runs stuck >5 minutes
- Integration with 7 Core Brain Trace APIs (v1.1.1)
- Comprehensive test coverage for all components (API layer + 5 components)
- Vitest test infrastructure with @testing-library/react

## [1.9.0] - 2026-02-01

### Added
- Cecelia Overview dashboard enhancements with real-time monitoring metrics
- Seats configuration display (max concurrent, used, available)
- Tick Loop status (running state, last/next tick times, actions today, interval)
- Circuit breaker status with color-coded indicators (CLOSED/OPEN/HALF_OPEN)
- Task queue statistics visualization (queued, in_progress, completed, failed, cancelled)
- Current activity panel showing in-progress tasks
- Brain API integration (http://localhost:5221/api/brain/tick/status)
- Tasks API integration (/api/tasks/tasks)
- Auto-refresh every 30 seconds for real-time monitoring
- Comprehensive test coverage (18 tests covering API integration, edge cases, data transformations)

## [1.8.0] - 2026-02-01

### Added
- Intent Recognition API (KR1) - Natural language to OKR/Project/Task intent recognition
- POST /api/intent/recognize endpoint for intent recognition
- Support for CREATE_GOAL, CREATE_PROJECT, CREATE_TASK, QUERY_TASKS, UPDATE_TASK intents
- NLP parser with rule-based pattern matching (no ML models)
- Entity extraction (title, priority, status, project/goal references)
- Confidence scoring and explanation generation
- Integration with Brain API through suggested actions
- Comprehensive test coverage (30+ test cases)

## [1.7.0] - Previous version
