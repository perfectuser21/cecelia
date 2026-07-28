# Kernel Equivalence Phase 5 Authenticated Readiness and ACL Plan

1. Add RED readiness tests for signed success and adaptive echo, wrong key,
   replay, expired, digest-mismatch, and zero-execution failures.
2. Add a dedicated registry purpose/signer, protected manifest trust-anchor
   loader, signed server envelope, and client verification; run focused GREEN.
3. Add RED pure-parser and platform ACL/xattr tests, replace marker inspection
   with full Darwin/Linux enumeration, and run every protected-path suite GREEN.
4. Add a deterministic RED stale-quarantine replacement test and implement the
   module-private fail-closed recovery seam.
5. Bump Brain version and definitions; run full Kernel, real PostgreSQL,
   probes, syntax/lint/diff/secret scans, facts/manifest/version/local precheck.
6. Commit a new clean exact SHA without push, merge, or deployment and request
   third independent review.
