# Fleet Offline PostgreSQL Tag Recovery Design

**Status:** approved production defect fix inside Phase 4A

## Problem

`fleet-rollout.sh` saves the pinned Runner and PostgreSQL images by immutable
digest. Docker exports both payloads, but records `RepoTags: null`. After an
offline `docker load`, the PostgreSQL content exists under its bare image ID
while `postgres:16-alpine@sha256:...` cannot be resolved. The baseline then
fails closed with `postgres_image_unavailable`, so every affected node remains
drained even though the verified PostgreSQL bytes are present.

## Decision

Keep the public NodeProfile and Worker contract unchanged: PostgreSQL remains a
repository-qualified pinned digest. Restore the local repository tag only after
the bare digest is present and verified.

- The rollout producer tags the pinned PostgreSQL image with the repository/tag
  portion and saves that tagged reference, so new archives preserve `RepoTags`.
- The baseline consumer remains backward compatible with existing archives. If
  the qualified reference is unavailable after load but the exact bare digest
  exists, it restores the repository tag and rechecks the qualified reference.
- If the bare digest is absent or the qualified reference still cannot be
  resolved, bootstrap fails closed and the node remains drained.

No registry pull is added to node bootstrap, no floating image is accepted, and
the Runner digest path is unchanged.

## Verification

Behavioral shell tests must reproduce an archive whose qualified PostgreSQL
reference is absent while its exact bare digest is present. Red must show that
the current reconciler fails to recover it. Green must prove the reconciler
restores only the expected tag and that the rollout producer saves the tagged
reference. Existing Fleet tests, Node admission/profile tests, version smoke,
and CI remain required before merge.

## Versioning and rollback

This changes production Brain-owned Fleet scripts, so bump the Brain package,
Fleet Worker policy version, root/package definitions, and lockfiles. Rollback
is the previous Brain/Worker versions; nodes remain drained if recovery fails.
