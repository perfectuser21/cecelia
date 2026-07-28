# Fleet GitHub Read Broker Design

## Goal

Allow Kernel Evaluator and Reporter Attempts to verify one frozen pull request
without giving the provider container a GitHub credential or allowing it to run
`gh`.

## Authority and axes

Brain freezes `github-read/v1` in the TaskBundle. The policy contains only the
repository, PR URL/number, head ref, exact head SHA, and allowed state set. It
must agree byte-for-byte with the TaskBundle's existing `pull_request`
authority and with the resolved WorkspaceSpec repository, branch, and expected
head SHA. The remote bridge copies that exact policy into the Worker launch
request. Evaluator and non-canary Reporter launch requests without the policy
fail closed.

The Worker validates the policy before workspace or provider side effects. Its
read broker invokes only:

```text
gh pr view <number> --repo perfectuser21/cecelia
  --json url,number,headRefName,headRefOid,state
```

The command is argv-only and the Worker owns the authenticated environment.
The returned fields must exactly match the frozen repo, PR number, head ref,
head SHA, URL, and state policy.

## Durable observation

The broker writes one mode-0600, no-symlink JSONL journal per Attempt under a
Worker-owned mode-0700 root. Each canonical record contains the Attempt,
task/run/role axes, request digest, normalized public PR fact, timestamp,
previous record digest, and its own SHA-256 digest. A replay with the same
request returns the recorded fact without another GitHub call. A different
request, malformed/reordered record, changed digest, symlink, permissive mode,
or unknown field fails closed.

Crashing before the append is harmless because the operation is read-only and
may be repeated. Crashing after the append replays the immutable record.

## Runner handoff

Before Docker launch, Worker persists the audited public authority in Attempt
state and passes it to the Docker adapter. The adapter writes a bounded
mode-0600 authority file into the Worker-owned Attempt runtime, then bind
mounts that individual file read-only at a fixed container path. It exports
only the path, not a credential.

The managed result-channel driver reads and strictly validates this file. Its
production dependency resolves PR facts only from the file; it never invokes
`gh`. The existing frozen TaskBundle comparison remains the final verifier, so
a provider result cannot choose another repo, PR, branch, head, or state.

## Scope

This slice supports Fleet Evaluator and non-canary Reporter Attempts for
`perfectuser21/cecelia`. Generator mutation remains in the separate mutation
broker. Canary has no GitHub dependency. Provider authentication and general
GitHub API access remain outside this contract.

## Proof contract

Tests must prove:

- exact Brain policy freezing and remote transport copying;
- missing, extra, or mismatched policy fails before credential/workspace/Docker;
- broker argv contains no shell and no credential;
- exact repo/PR/ref/SHA/state binding;
- mode-0600 append-only hash-chain audit;
- crash-before-append retry and post-append exact replay;
- a replay conflict never calls GitHub;
- Docker passes no GitHub token/config and read-only mounts only the authority;
- Runner production verification cannot invoke `gh`;
- canary and Generator behavior stay unchanged;
- install and rollout artifacts contain the new Worker broker and Runner
  contract.
