# Kernel Fleet Admission Stability Design

**Status:** Owner-approved continuation on 2026-08-03

## Problem

Fleet bootstrap currently has two false-negative admission paths:

1. The NodeProfile and installer both require 40 GiB free disk. On the US M4 this
   rejects a healthy host with roughly 35.8 GiB free and only 34% disk usage. The
   absolute threshold is also duplicated in the installer, so it can drift from
   the profile contract.
2. The disposable PostgreSQL runtime probe performs one cold-start attempt. A
   transient Docker/OrbStack startup delay marks the node unavailable even though
   the pinned image and runtime are healthy on the next attempt.

## Decision

Use two independent disk guards: at least 10 GiB free and at most 85% used. Ten
GiB preserves room for the pinned images, an eight-slot fleet node's worktrees,
and temporary attempt data without requiring most of a small server volume to be
empty. The NodeProfile is the sole source of the absolute floor; the installer
loads that value instead of embedding another constant.

Retry only the disposable PostgreSQL runtime start a maximum of three times,
cleaning the exact deterministic probe container before and after every attempt.
Successful retry admits the capability; three failures remain fail-closed.

## Boundaries

- No capacity, role-weight, Runner digest, OS, OrbStack, callback, or worktree
  policy changes.
- No disk cleanup or deletion is hidden inside admission.
- No retry of permanent profile, digest, or resource-policy failures.
- Tick remains disabled during rollout.

## Verification

- Red/Green unit coverage proves one transient PostgreSQL failure is retried and
  three failures remain unavailable.
- Profile/admission and installer contract tests prove 10 GiB passes, below 10
  GiB fails, and the installer reads the profile value.
- Brain version and `DEFINITION.md` change together.
- After merge and deployment, rerun three-machine bootstrap/admission, then the
  real two-phase protocol probe before any business Kernel run.
