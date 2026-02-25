# Changelog

All notable changes to @cecelia/core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-02-01

### Added
- Voice queue management API for Orchestrator
  - GET /api/orchestrator/queue - view queue status
  - POST /api/orchestrator/execute-now/:id - move task to front
  - POST /api/orchestrator/pause/:id - pause running task
- TypeScript interfaces for queue management (QueuedTask, RunningTask)
- Unit tests for queue API endpoints

## [1.0.0] - 2026-01-27

### Added

- Initial release of @cecelia/core
- Multi-model AI executor functionality
- Dashboard task visualization API
- Dev workflow tracking endpoints (`/api/dev/*`)
- GitHub integration endpoints (`/api/github/*`)
- Task tracker service with file-based reports
- Engine info service
- Cecelia run tracking with Core/Notion sync

### Changed

- Migrated from standalone zenithjoy-core repository to monorepo
- Updated package name from `zenithjoy-core` to `@cecelia/core`
- Updated repository references in configuration arrays

[1.0.0]: https://github.com/ZenithJoycloud/cecelia-workspace/releases/tag/core-v1.0.0
