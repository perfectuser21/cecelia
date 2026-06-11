#!/usr/bin/env node
// check-contract-exists.mjs — verifies harness PRs include contract-draft.md
// Reads file list from stdin (git diff --name-only output), checks per-sprint-dir.
// Exit 0 = ok; Exit 1 = sprint dir changed without contract-draft.md present.

import { createInterface } from 'node:readline';

const lines = [];
const rl = createInterface({ input: process.stdin, terminal: false });
for await (const line of rl) {
  if (line.trim()) lines.push(line.trim());
}

const sprintContracts = new Set();
const sprintOtherFiles = new Set();

for (const file of lines) {
  const m = file.match(/^sprints\/([^/]+)\//);
  if (!m) continue;
  const dir = m[1];
  if (file === `sprints/${dir}/contract-draft.md`) {
    sprintContracts.add(dir);
  } else {
    sprintOtherFiles.add(dir);
  }
}

const missing = [...sprintOtherFiles].filter(dir => !sprintContracts.has(dir));
if (missing.length > 0) {
  const dir = missing[0];
  console.error(
    `ERROR: sprints/${dir}/contract-draft.md is missing.\n` +
    `Harness PR must include contract-draft.md. Add the contract file to this PR.`
  );
  process.exit(1);
}

process.exit(0);
