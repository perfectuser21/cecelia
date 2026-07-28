# Kernel Equivalence Phase 5 Boot Control Design

## Scope

This change closes only the production boot and crypto/grant control-plane
boundary for the ten already-assembled non-release equivalence seams. It does
not add ReleaseRun, create production resource ports, execute a drill, change
the root proof count, merge, deploy, or claim production readiness.

## Production manifest

Brain accepts one absolute protected JSON manifest path from
`KERNEL_EQ_PRODUCTION_CONFIG_FILE`. The manifest is a bounded owner-only
regular file and contains only:

- the public trust registry;
- the exact canonical assembled-plan digest;
- collector, execution-grant, and ten effect-receipt key IDs plus absolute
  protected private-key file paths;
- the protected grant directory, grant TTL, and Unix socket path;
- bounded resource-port configuration metadata.

Raw `KERNEL_EQ_*` private keys, PEM values, generic secrets, or key values in
the environment are rejected before the manifest is opened. The loader reads
through one `O_NOFOLLOW` file descriptor, validates regular-file ownership,
single-link identity, size, and mode, snapshots every data property, compiles
the plan from the repository-owned canonical contract, overlays only the ten
configured effect key IDs, and verifies both the canonical descriptor digest
and the full configured plan digest. Trust registry, key identities, secret
paths, socket path, and port metadata are cloned and frozen before any lazy
service construction.

## Grant authority split

The existing protected grant reader remains a read-only capability. A new
issuer capability owns the execution-grant signer and the protected directory.
It signs a grant, writes a mode-0600 temporary regular file using
`O_CREAT|O_EXCL|O_NOFOLLOW`, fsyncs the file, atomically renames it to the
opaque grant-ID filename, then fsyncs the directory. It returns only the
opaque grant reference.

Expiry cleanup belongs only to the issuer. It opens candidate grant files with
`O_NOFOLLOW`, validates owner/mode/single-link identity, parses the bounded
expiry, rechecks the inode immediately before unlink, and fsyncs the directory.
Unknown, malformed, unsafe, unexpired, or replaced files are retained and
reported; cleanup never follows links or accepts a caller path. The reader
rejects expired grants even if scheduled cleanup has not yet run.

## Boot and readiness

`loadProductionTrustedExecutionWiring()` validates the manifest and outer
Brain-owned ports, constructs the protected reader and issuer, and returns the
one-shot production `createService`. Missing or invalid configuration returns
one stable `trusted_execution_*` readiness code and never opens a listener.
Missing Phase 5 B resource ports returns
`trusted_execution_ports_unconfigured`; no placeholder implementation is
created.

`bootProductionBrainTrustedExecution()` is the only server boot entry. It
loads the production wiring and then calls the existing secure socket boot.
`server.js` passes the real shared PostgreSQL pool and no inner service,
registry, or adapter injection. A complete isolated test configuration crosses
manifest load, canonical plan pinning, signer load, factory assembly, and
mode-0600 Unix listener creation with plain minimal outer ports.

## CLI readiness

The client module exposes a read-only socket readiness inspection using the
same path, owner, directory, inode, and mode checks as execution. `--check`
uses that live result instead of constant blockers. Proof readiness remains
separate: a healthy listener does not make a 0/99 proof matrix complete.

## Verification

Tests observe RED before implementation for:

- writer/reader authority separation, crash-safe writes, collisions, expiry,
  replacement, symlink, hard-link, and permission attacks;
- missing/bad/raw-secret manifest codes and immutable plan/registry/key
  snapshots;
- server production boot without inner service injection and a real mode-0600
  isolated UDS;
- live CLI socket readiness and the distinction between wiring and proof
  readiness.

Focused regression, all equivalence tests, local PostgreSQL runtime tests,
version/definition checks, lint/syntax, diff checks, and secret scans are
required before handoff.
