# Codex Relay Four-Way Headless Design

## Status

Approved by the principal on 2026-07-26. This supersedes the rejected
per-account bucket design in commit `aca0527ed`. The durable Docker-truth
lifecycle below incorporates the final restart-safety and credential-cleanup
review.

## Goal

Allow up to four simultaneous US M4 headless One Session Codex controller
relays. All four relays may use the same `team1` Codex credentials, while each
run keeps an independent worktree, container, callback identity, and isolated
credential snapshot.

## Scope

This hotfix changes only the legacy headless `skill-relay` Codex controller
path and its callback cleanup:

- total Codex controller concurrency becomes four;
- concurrency is not partitioned by account;
- all relays use the existing `team1` mount;
- snapshots move from Brain container `/tmp` to a host-visible directory;
- each snapshot is deleted by its exact container identity when no live
  container can still consume it, or later by controller callback/watchdog;
- Brain version metadata is synchronized across the four version files plus
  the append-only `.brain-versions` DevGate ledger.

It does not add an account allocator, mount `team2` through `team5`, change
headed relay behavior, stop existing containers, add a database migration, or
merge the resulting pull request.

## Root Cause

`packages/brain/src/harness-skill-relay.js` currently has three assembly
defects:

1. `_activeCodexRelays` is a global scalar checked with `> 0`, and the DB guard
   also blocks when any active Codex relay exists. This hard-codes total
   concurrency to one.
2. `_activeCodexRelays` increments after a successful detached launch but has
   no matching decrement. It is neither a launch reservation nor an accurate
   runtime counter.
3. `snapshotCodexRelayHome()` creates its directory under `os.tmpdir()`.
   Production Brain runs with container-local `/tmp` tmpfs. The sibling Docker
   daemon interprets the resulting bind source as a host path and therefore
   sees an empty or missing credential directory.

The existing `docker-compose.yml` already mounts `team1` read-only and mounts
`/Users/administrator/claude-output` read-write at the identical container
path. No additional account mount is needed.

## Approved Architecture

### Total concurrency gate

The in-process value becomes a transient launch reservation count, not a
runtime active count.

For a Codex headless launch:

1. Reject immediately when four launch reservations already exist.
2. Increment the reservation before the first asynchronous capacity gate.
3. Query `docker ps` and count only complete live names matching
   `cecelia-relay-<8 hex>-cx-<8 hex>`.
4. Query the total number of non-terminal, non-expired
   `skill-relay-codex` rows, excluding the current initiative.
5. Evaluate the two external truths independently: both
   `dockerLive + launchReservations <= 4` and
   `dbActive + launchReservations <= 4` must hold. Docker and DB counts are
   not added together because a healthy relay appears in both.
6. Keep the reservation through snapshot creation and detached spawn.
7. As soon as detached spawn succeeds, release the reservation before the
   `initiative_runs` insert. The live Docker container has taken over as the
   capacity truth for that launch.
8. On all pre-spawn returns or errors, release the reservation in `finally`.

The short-lived reservation closes same-process races before Docker can
observe a new container. Docker live state is the restart-safe truth for
actual detached containers, including a container whose `initiative_runs`
insert failed. The DB query independently protects persisted active-run
state. Docker and DB query failures are both fail-closed and return a deferred
result because either fail-open path could exceed the hard limit.

Holding the reservation through the DB insert was superseded because an insert
failure can leave a successfully detached container with no DB row. A
process-local reservation cannot survive Brain restart, while the exact live
Docker container does.

There is no account dimension. Four relays using `team1` are valid.

### Independent run identity

Each headless Codex launch gets a unique container ID:

`cecelia-relay-<task-short-id>-cx-<random-suffix>`

That identity is also the callback identity and the credential snapshot
directory name. Existing duplicate protection still searches by
`cecelia-relay-<task-short-id>`, so it continues to suppress a second live
container for the same task.

Worktree creation remains keyed by task/initiative and is unchanged. Different
tasks already receive independent worktrees.

### Credential isolation and cleanup

The default snapshot root is:

`$HOST_HOME/claude-output/codex-relay-credentials`

with fallback to:

`$HOME/claude-output/codex-relay-credentials`

`CODEX_RELAY_SNAPSHOT_ROOT` may override it in tests or deployment. The root
and every per-container directory are forced to mode `0700`; copied credential
files are mode `0600`.

The snapshot directory is exactly:

`<snapshot-root>/<container-id>`

Cleanup accepts only a valid `cecelia-relay-...` container ID and deletes only
that exact direct child of the configured snapshot root. It refuses traversal
or arbitrary paths.

Cleanup happens:

- immediately when snapshot/setup or detached spawn fails before a container
  exists;
- after an `initiative_runs` insert failure, only after exact
  `docker rm -f <container-id>` succeeds or an exact `docker ps -a` check
  confirms that container is absent;
- on every relay callback, before returning the existing 200 acknowledgement;
- when `scanStuckHarness` successfully transitions an overdue Codex relay to
  `failed`, covering the case where the container exited without delivering
  its callback.

If exact removal fails and the container is confirmed present, or Docker
cannot confirm its state, the snapshot is preserved because that container
may still be using it. A present container remains counted by the Docker
admission gate across Brain restarts; callback/watchdog later performs exact
cleanup. This supersedes the earlier “always cleanup after insert failure”
wording, which could revoke credentials from a still-live controller.

Callback cleanup is best-effort so filesystem trouble cannot change the
existing acknowledgement contract.

The watchdog fallback never performs a prefix delete. After the guarded
terminal `UPDATE`, and only when `rowCount > 0`, it enumerates direct children
of the snapshot root. It accepts only complete IDs matching
`cecelia-relay-<current-task-short-id>-cx-<8 hex>` and passes each accepted ID
to the same exact-child cleanup function. Directories for other tasks,
malformed names, and the real team1 credential home are untouched. A lost
terminal race (`rowCount === 0`) performs no cleanup because another owner may
have advanced the run.

The real `~/.codex-team1` directory remains read-only and is never deleted or
mounted read-write into a relay.

## Error Handling

- Four active/reserved relays: return
  `{ok:false,deferred:true,reason:'codex_concurrent_limit'}` without consuming
  task attempts.
- Docker or DB concurrency query failure: return the same deferred result and
  log the failing external truth.
- Missing team1 `auth.json`: preserve the current loud failure and task
  rollback.
- Snapshot creation failure: rollback the task and do not spawn.
- Spawn failure after snapshot creation: remove the exact snapshot and
  preserve existing task rollback behavior.
- Insert failure after successful spawn: exact-remove the container first.
  Cleanup the snapshot only when removal succeeds or exact inspection confirms
  absence; preserve it for `present` or `unknown`.
- Callback cleanup failure: warn and still return HTTP 200.
- Watchdog terminal cleanup failure: warn after the durable failed transition;
  do not undo or repeat the terminal DB update.

## Test Strategy

### Unit and integration-level behavior

The permanent regression suite proves:

- zero through three total active rows allow launch;
- four total active rows defer;
- four exact live Docker relays defer even when DB active is zero;
- one Docker-only orphan leaves exactly three launch slots;
- malformed or partial Docker names do not count;
- Docker capacity query failure defers fail-closed;
- four simultaneous launch reservations using the same team1 may progress;
- a fifth simultaneous launch is deferred;
- reservations release after detached spawn success and on pre-spawn failure;
- an insert-failure orphan remains capacity-visible after simulated Brain
  process state reset;
- failed removal plus confirmed absence cleans the exact snapshot and does not
  strand capacity;
- failed removal plus present/unknown state preserves the snapshot;
- each of four runs has a distinct container ID, callback URL, worktree input,
  and snapshot directory;
- snapshots live under the configured host-visible root with `0700`
  directories and `0600` files;
- spawn failure removes only that run's snapshot;
- relay callback removes only the callback container's snapshot;
- watchdog terminal cleanup removes only complete matching IDs for its task;
- watchdog `UPDATE rowCount=0` removes no snapshot;
- watchdog cleanup leaves other-task snapshots and the real team1 home intact;
- the existing team1-only compose mount remains the account contract.

### Regression and operational gates

- Existing harness relay, headed relay, callback, and credential isolation
  tests must remain green.
- `codex-cred-isolation-smoke.sh` must pass with the new host-visible API.
- Brain full unit suite, facts check, relevant smoke checks, and DevGate run
  before push.

## Alternatives Rejected

### Per-account buckets

Rejected by the principal. The production requirement is four simultaneous
controllers sharing team1, so per-account mutexes recreate the outage.

### Mount team1 through team5 and add an allocator

Rejected as unnecessary P0 scope. Team1 has sufficient capacity and is already
mounted read-only.

### DB-only gate

Rejected because concurrent requests in one Brain process can all read the
same pre-insert count and oversubscribe the limit. It also cannot see a
successfully detached container whose DB insert failed.

### Database migration for leases

Rejected for this hotfix. The existing `initiative_runs` table already
contains persisted active-run truth, Docker already exposes restart-safe live
container truth, and a transient in-process reservation closes the remaining
pre-spawn local race.
