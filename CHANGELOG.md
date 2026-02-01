# Changelog

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
