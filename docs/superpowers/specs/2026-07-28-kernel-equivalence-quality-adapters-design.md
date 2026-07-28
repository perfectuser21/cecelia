# Kernel Equivalence Quality Adapters Design

## Scope

Implement isolated drill adapters for:

- `KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE`
- `KERNEL-P1-08-STOP-ORPHAN-LIVENESS`
- `KERNEL-P1-09-DEVGATE-TDD-DOD`
- `KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION`
- `KERNEL-P1-11-REPORT-LEARNING-CLOSURE`

The root equivalence contract remains at `0/99`: this work adds executable
adapter and seam boundaries, but does not register production keys, write proof
matrix references, or mark any behavior proven.

## Architecture

`createQualityEquivalenceAdapterRegistry()` returns five adapters keyed by the
existing contract `adapter_id`. Every adapter implements `prepare`,
`invokeActualSeam`, `observe`, `cancel`, and `cleanup`. A caller-supplied
isolation port maps the logical
`equivalence-drill/{run_id}/{attempt_id}/...` resource into a safe ephemeral
resource. A separate cleanup verifier inspects the resource after cleanup and
never trusts the adapter's cleanup return value.

The actual seams are factory-created inside their owning modules:

- Kernel judge handler in `orchestrator/kernel-handlers.js`
- liveness resolver in `lib/kernel-liveness.js`
- guarded DevGate sidecar in Engine
- attempt ownership store in `orchestrator/attempt-store.js`
- report/auto-learning closure in `auto-learning.js`

Each seam receives its effect signer when the seam is constructed. The adapter
never receives a signer or private key. After executing the real decision or
effect, the seam sends an exact result to `signEffectResult`; the signer returns
the signed effect receipt. Production construction fails when the secure signer
port is absent. Tests inject a signer port backed by ephemeral test keys.

## Scenario semantics

Each seam owns its outcome mapping and does not copy the cell's expected values:

| Behavior | normal | violation | recovery |
|---|---|---|---|
| independent judge | independent handler verdict recorded | self-certification blocked | reassigned evaluator verdict recorded |
| orphan liveness | live attempt preserved | uncertain cleanup denied | confirmed-dead attempt requeued |
| DevGate | TDD and DoD gates pass | invalid RED/DoD evidence denied | corrected history and DoD pass |
| controller ownership | owning callback completes | foreign callback denied | current owner completes after denial |
| report learning | fresh report and learning close | stale evidence causes no writes | refreshed evidence closes |

Recovery signing requires the exact verified violation receipt. Until runtime
core passes that receipt to the adapter, registry construction requires a
trusted predecessor loader keyed by the same run, attempt, resource, provider,
and violation cell.

## Cancellation and cleanup

All adapter and seam calls receive an `AbortSignal`. The guarded DevGate
sidecar launches only the fixed checked-in scripts with fixed argument
construction; signer material remains in the parent process. Abort terminates
the child and waits for exit before cancellation can be confirmed.

Cleanup is idempotent. Adapters clean prepared and partially prepared resources.
The independent verifier re-inspects the resource and confirms absence. A late
effect, unresolved child, missing signer, missing predecessor, or unconfirmed
cleanup remains blocked.

## Tests

Tests execute the registry through `executeDrillCell` where trust-boundary
behavior matters and exercise seam factories directly where actual behavior
mapping matters. Adversarial cases cover unsigned/fake seam results, stale
grants, late effects after abort, cross-owner callbacks, stale closure evidence,
and incorrect recovery lineage.
