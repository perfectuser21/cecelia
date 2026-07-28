# Phase 4A macOS Admission Policy Correction

## Context

Phase 4A copied the US M4 as-built macOS `15.7.4` value into the canonical
NodeProfile and treated it as both a minimum version and a required `15.7`
release line. That is stricter than the Provider-neutral Harness Commander PRD,
which requires OS drift to be observable and outside an explicit allowlist to
fail admission, but does not require identical macOS patch versions.

The two current Xian nodes run macOS `15.6.1`. The Cecelia execution contract
does not depend on a functional difference between `15.6.1` and `15.7.4`;
OrbStack/Docker, the Worker system LaunchDaemon, the pinned Runner, toolchain,
health evidence, and admission boundary are the contract.

## Decision

- Use `15.6.1` as the minimum supported macOS version.
- Derive the supported release boundary from its major version: only macOS 15
  is admitted. macOS 14 remains below the floor and macOS 16 remains untested
  drift until deliberately added to policy.
- Admit later macOS 15 releases and patches, including `15.7.4`.
- Keep `15.7.4` as the recommended security-maintenance target in the baseline
  reconciler. A node below that recommendation receives a warning but is not
  drained solely for that reason.
- Continue recording the exact observed OS version in admission evidence.

## Boundaries

This correction changes only Phase 4A NodeProfile, admission, baseline
reconciliation, production smoke assertions, tests, and the Brain version
definition. It does not change the Worker API, Runner digest, workspace
isolation, credential handling, Phase 4B/4C/4D, or Phase 5 acceptance.

## Verification

Tests must prove the following Red-to-Green behavior:

- `15.6.1` and `15.7.4` are admitted.
- `15.6.0`, macOS 14, malformed versions, and macOS 16 are drained.
- Reconciliation reports `15.6.1` as supported while recommending `15.7.4`.
- All three canonical profiles publish the same `15.6.1` minimum.
- The Phase 4A production smoke asserts the corrected minimum.
