# Kernel Provider Credential Broker Design

## Goal

Remove the Fleet Worker bootstrap block
`attempt_provider_credential_broker_required` by giving Codex, Claude, and Grok
the same fail-closed, attempt-scoped credential delivery contract. Long-lived
provider homes remain on the controller host and are never mounted into a
Runner container.

## Authority boundary

- Brain preflight still proves that the selected provider/account/machine is
  available. The frozen TaskBundle contains capability evidence, never secret
  bytes.
- The controller credential broker is the only component allowed to read a
  provider credential source. It reads exactly one protected regular file:
  Codex `auth.json`, Claude `.credentials.json`, or Grok `auth.json`.
- The Fleet Worker receives a signed short-lived envelope over the existing
  authenticated Worker request. The existing Fleet Worker token is the HMAC
  root on both sides; it is never passed to Docker.
- The Worker verifies and consumes an envelope once, creates an attempt-owned
  FIFO, starts the Runner, writes the credential bytes once, removes the FIFO,
  and persists only non-secret receipt metadata.
- The Runner writes the bytes to a provider-specific tmpfs home and launches
  the provider. No provider host home, credential file, bearer token, or raw
  credential is present in Docker argv, state, audit, or logs.

## Envelope contract

`provider-credential-envelope/v2` has an exact field set:

- identity: `credential_ref`, `delivery_nonce`, `attempt_id`, `run_id`
- execution binding: `provider`, `account_id`, `machine_id`, `lease_owner`,
  `lease_generation`
- freshness: `issued_at`, `expires_at` (delivery TTL, not provider token TTL)
- integrity: `payload_hash`, base64 `payload`, and HMAC `signature`

The controller validates that the underlying provider credential outlives the
attempt deadline plus a safety margin, but limits envelope delivery to 60
seconds. The Worker rejects unknown fields, invalid signatures, modified
payloads, future/expired timestamps, wrong provider/account/machine/run/lease,
and reused nonces before starting Docker.

Canary TaskBundles are Runner-owned probes and do not invoke a provider.
Therefore the controller must not issue, transmit, consume, or materialize a
credential for a canary.

## Provider materialization

- Codex: `/home/cecelia/.codex/auth.json`, `CODEX_HOME` points at that tmpfs.
- Claude: `/home/cecelia/.claude/.credentials.json`,
  `CLAUDE_CONFIG_DIR` points at that tmpfs.
- Grok: `/home/cecelia/.grok/auth.json`, `GROK_HOME` points at that tmpfs.

All homes are mode `0700`, files are `0600`, and every provider path is backed
by Docker tmpfs. The existing result redaction is generalized to read the
active credential file. Result metadata contains only `credential_ref` and
whether the disposable copy changed.

## Failure and cleanup semantics

Credential validation and FIFO delivery fail closed before provider
invocation. A replay marker is durable and contains metadata only, so a crash
cannot make a consumed envelope reusable. Launch failure removes the container,
FIFO, and attempt runtime. Normal terminal/cancel recovery removes the
container tmpfs and attempt runtime; no secret is written into durable attempt
state.

## Tests

Tests cover provider source allowlists and expiry, signed envelope bindings,
tamper/replay/expiry/wrong-machine rejection, transport issue/no-issue rules,
Worker request validation and durable-state secrecy, Docker tmpfs/FIFO argv,
Runner provider-specific materialization/redaction, and installer inclusion.

