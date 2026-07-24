# ws1 Red Evidence

- Workstream: `ws1`
- Segment base: `112494128beaa058e011fc5b07556fd5ae5fe6fe`
- Command:
  `npx vitest run sprints/07240958-relay-1fd063d0/tests/codex-slot-contract.test.ts -t '旧 codex-request|旧 codex-remote-launch|migration 用' --reporter=verbose`
- Result: exit code `1`; `3 failed`, `8 skipped`.

Expected failures before implementation:

1. `scripts/codex-request.sh --team team1` exited `1` instead of the required `64`.
2. `scripts/codex-remote-launch.sh --team team3` exited `1` instead of the required `64`.
3. `packages/brain/migrations/360_codex_slot.sql` did not exist.

The shared contract test file was not modified.
