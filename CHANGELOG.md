# Changelog

All notable changes to Cecelia Quality Platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-25

### Added

- Initial release of Cecelia Quality Platform
- Extracted from zenithjoy-engine v10.6.0
- Hooks system (5 hooks)
  - branch-protect.sh
  - pr-gate-v2.sh
  - stop.sh
  - session-end.sh
  - session-start.sh
- DevGate framework (17 scripts)
  - check-dod-mapping.cjs
  - require-rci-update-if-p0p1.sh
  - scan-rci-coverage.cjs
  - impact-check.sh
  - l2a-check.sh
  - l2b-check.sh
  - detect-priority.cjs
  - draft-gci.cjs
  - and more...
- Skills (3 skills)
  - /audit - L1-L4 code audit
  - /qa - QA controller
  - /assurance - RADNA 4-layer system
- Contract templates
  - gate-contract.template.yaml
  - regression-contract.template.yaml
- Document templates
  - AUDIT-REPORT.md
  - QA-DECISION.md
  - DOD-TEMPLATE.md
  - PRD-TEMPLATE.md
  - .layer2-evidence.template.md
- Installation scripts
  - install.sh (global install)
  - install-local.sh (project-level install)
- Comprehensive documentation
  - README.md
  - Integration guides
  - Architecture docs

### Changed

- N/A (initial release)

### Deprecated

- N/A (initial release)

### Removed

- N/A (initial release)

### Fixed

- N/A (initial release)

### Security

- N/A (initial release)
