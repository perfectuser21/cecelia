# Canonical Red Evidence

- Contract test tree: `sprints/08121555-unified-work-router/tests/`
- Frozen at: `a90aa390b2`
- RED reproduction: the pre-fix Runner inherited the Evaluator pushurl fence and exited 128; Judge also had no structured way to defer the five server-owned post-Judge checks.
- GREEN requirement: fixture-only Git pushes succeed, candidate pushes remain blocked, and only the declared post-Judge checks may use `deferred=true`.
