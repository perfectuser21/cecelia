# Kernel Phase 5A Exact-Image Boot Closure Design

## Context

Phase 5A commit `1695f7f49c4bca1a6772d41f3244130be2bfc205`
builds successfully, but its exact Brain image exits before startup:

```text
ERR_MODULE_NOT_FOUND:
/engine/scripts/devgate/kernel-equivalence-devgate-sidecar.mjs
```

`/app/src/lib/kernel-equivalence-production-seam-builders.js` imports the
Engine DevGate sidecar through `../../../engine`, which resolves to `/engine`.
The sidecar imports Brain receipt primitives through `../../../brain`, which
resolves to `/brain`. The image contains only `/app`, so both sides of the
monorepo runtime graph are absent. The CI image build also omits the `GIT_SHA`
build argument, leaving the immutable image identity as `unknown`.

## Chosen architecture

Keep `/app` as the only Brain source copy and create the immutable alias
`/brain -> /app`. Copy the complete `packages/engine/` package into `/engine/`;
do not copy only the first missing sidecar file. This preserves the existing
cross-package relative-import contract, includes the sidecar's sibling
executables, and avoids a second Brain module instance.

The image continues to contain `acl` and `attr`; the existing protected
filesystem image contract remains independently required.

## Exact-image contract

A new Docker-backed contract will accept an image tag and exact 40-hex
`GIT_SHA`, then verify:

1. the image embeds exactly that SHA and never `unknown`;
2. `/brain` resolves to `/app`;
3. the complete Engine DevGate runtime directory exists;
4. importing the production seam builder succeeds inside the image;
5. the production seam import graph resolves Brain and Engine modules without
   host mounts;
6. a temporary isolated PostgreSQL/pgvector container and the exact Brain
   image reach the Brain health endpoint within a fixed deadline;
7. every temporary container and network is removed on success or failure.

The server starts in evaluator mode to avoid background production effects,
but it performs real static module loading, migrations, trusted-execution boot,
port binding, and HTTP health serving against the isolated database.

## CI identity flow

The Docker build receives `--build-arg GIT_SHA=${GITHUB_SHA}`. Both the build
step and the runtime contract reject missing or malformed SHAs. Changes to the
new contract trigger the Docker infrastructure job.

## Failure semantics

- Docker unavailable with `--require-docker`: fail closed.
- Docker unavailable with explicit `--allow-skip`: report a stable skip.
- SHA mismatch, missing graph node, import failure, premature Brain exit,
  health timeout, or cleanup residue: non-zero with a stable reason.
- Cleanup always runs in `finally`; leaked resources are a contract failure.

## Non-goals

- No ReleaseRun, Codex Reviewer, Phase 5B port, migration, merge, deployment,
  or production configuration changes.
- No shared-package extraction or change to the existing cross-package import
  API.
- No duplicate `/brain` source tree.
