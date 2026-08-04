#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module <<'NODE'
import { createProviderRegistry } from './packages/brain/src/orchestrator/provider-registry.js';
import { claudeAdapter } from './packages/brain/src/orchestrator/providers/claude.js';
import { codexAdapter } from './packages/brain/src/orchestrator/providers/codex.js';
import { grokAdapter } from './packages/brain/src/orchestrator/providers/grok.js';

const registry = createProviderRegistry([claudeAdapter, codexAdapter, grokAdapter]);
const bundle = {
  attempt_id: '11111111-1111-4111-8111-111111111111',
  objective: 'Return structured evidence.',
  inputs: { worktree_path: process.cwd() },
};

for (const provider of ['claude', 'codex', 'grok']) {
  const adapter = registry.resolve({ provider, requires: ['structured_output', 'resume'] });
  const spec = adapter.start({ bundle });
  if (spec.provider !== provider || spec.args.includes('--model')) {
    throw new Error(`${provider}: provider mismatch or implicit model detected`);
  }
}

if (registry.resolve({ provider: 'auto', requires: ['output_schema'] }).name !== 'codex') {
  throw new Error('capability routing did not select codex');
}
NODE

bash docker/cecelia-runner/entrypoint-provider-contract.test.sh
bash docker/cecelia-runner/__tests__/entrypoint-codex-resume-fallback.test.sh
README="packages/brain/src/orchestrator/README.md"
grep -q 'bash docker/build.sh --no-cache' "$README"
grep -q 'HARNESS_CALLBACK_TOKEN /usr/local/bin/entrypoint.sh' "$README"
echo "provider-neutral harness smoke: PASS"
