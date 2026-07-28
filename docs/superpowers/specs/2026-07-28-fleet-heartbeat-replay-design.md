# Fleet Heartbeat Replay Protection Design

## Goal

Make Fleet heartbeat delivery replay-safe without weakening lease fencing or
losing audit evidence. A heartbeat that committed but lost its ACK must return
the same signed ACK when retried; reuse of its nonce with any altered signed
field must fail with HTTP 409.

## Protocol and persistence

Migration 371 creates append-only `harness_heartbeat_receipts`. Its authority
key is `(attempt_id, lease_generation, heartbeat_nonce)`. Each row stores the
complete authority binding, the SHA-256 of the canonical signed request,
heartbeat/session inputs, and the server-owned `heartbeat_at` and
`lease_expires_at` values used in the ACK.

`AttemptStore.persistFleetHeartbeat()` owns one PostgreSQL transaction:

1. lock the Attempt with `FOR UPDATE`;
2. read an existing nonce receipt;
3. return it when every binding and request digest is identical;
4. reject a differing request for the same nonce;
5. for a new nonce, re-check live Fleet authority and request freshness;
6. renew the lease and insert the immutable receipt;
7. commit before the route signs its ACK.

The route permits an authenticated stale timestamp to reach the store because
an old exact replay may be recovering a lost ACK. Freshness is enforced for new
receipts only. Receipts are never expired or deleted online; this preserves
audit history and prevents nonce reuse for the lifetime of an Attempt
generation.

## Worker retry behavior

The Fleet heartbeat client caches one fully built wire request per Attempt
authority tuple. Transport errors, HTTP errors, and invalid ACKs keep that
request unchanged, including nonce, observed timestamp, body, and HMAC. A valid
ACK consumes the pending request; only the next heartbeat creates a new nonce.
A changed lease generation/job/owner discards the obsolete pending request and
creates a newly fenced heartbeat.

## Error semantics

- exact replay: HTTP 200 with byte-equivalent authority fields and HMAC;
- same nonce, altered signed request: HTTP 409 `fleet_heartbeat_conflict`;
- new stale request: HTTP 409 `fleet_heartbeat_stale`;
- lost lease or changed Fleet authority: HTTP 409;
- persistence error: HTTP 500 without an ACK.

## Verification

Unit tests freeze transactional ordering, exact dedupe, altered-payload
conflict, stale-new versus stale-replay behavior, and Worker wire reuse.
PostgreSQL integration runs migration 371 on a fresh schema, proves uniqueness,
append-only retention, rerunnability, and foreign-key `RESTRICT`.
