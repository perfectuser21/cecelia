# Kernel Equivalence Phase 5 Authenticated Readiness and ACL Design

## Scope

Close the second exact-SHA review findings on `a957c55b0` without changing
the trusted execution or release lifecycle. The work is limited to production
readiness authentication, protected-path ACL/xattr inspection, and deterministic
stale-socket replacement handling.

## Authenticated readiness

The production manifest registers a dedicated Ed25519 key whose trust-registry
record has purpose `trusted_execution_readiness` and service
`brain.kernel_equivalence.trusted_execution`. The private key is read only by
Brain through the existing protected private-key boundary. The client receives
only a pinned public trust anchor loaded from the protected production manifest;
neither request, response, nor raw key environment may supply it.

The client sends a fresh 256-bit nonce and expected plan identity. Brain returns
an exact signed envelope binding the nonce, response and service schemas,
canonical plan digest, Brain and service identities, socket device/inode,
key ID, issue time, and short expiry. The client verifies exact fields, socket
identity, key purpose/service/lifecycle, freshness, nonce, digest, and signature.
Adaptive echo, wrong key, replay, expired response, or plan drift returns
`ready:false` and never calls the execution service.

## Protected filesystem inspection

All manifest, private-key, grant-root/file, and UDS parent/socket checks use one
shared inspector. Darwin uses full `ls -lde@` entry output and rejects any ACL
entry or extended attribute. Linux uses `getfacl` plus `getfattr` entry
enumeration and rejects named/default/mask ACLs and every extended attribute.
Missing, malformed, timed-out, or truncated inspection fails closed. Pure
parsers have platform fixtures; real platform adversarial tests remain
conditional on mutation tools.

## Stale socket recovery

Recovery continues to pin parent and socket identity, prove only
`ECONNREFUSED` as inactive, quarantine by atomic rename, and unlink only the
quarantined pinned inode. A module-private deterministic post-rename hook is
accepted only by the internal recovery function in tests, not by the public
server configuration. Replacement before or after quarantine causes a stable
failure and preserves the replacement.

## Verification

TDD adversarial tests cover authenticated success with zero execution, adaptive
echo, wrong key, replay, expiry, digest drift, ACL+xattr combinations on every
protected path category, and deterministic quarantine replacement. Completion
requires the full Kernel equivalence suite, real PostgreSQL integrations,
syntax/lint/secret scans, version/facts/manifest checks, and local precheck on a
new clean exact SHA. No push, merge, or deployment is authorized.
