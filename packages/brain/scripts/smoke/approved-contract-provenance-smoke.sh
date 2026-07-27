#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require('fs');

const required = {
  'packages/brain/src/orchestrator/approved-contract-provenance.js': [
    'buildApprovedContractManifest',
    'verifyApprovedContractManifest',
    'verifyApprovedContractReference',
    'verifyAttemptCallbackApprovedContract',
  ],
  'scripts/ci/approved-contract-provenance-check.mjs': [
    'runApprovedContractProvenanceCheck',
    'approved_contract_drift',
    'requires_re_gan',
  ],
  'packages/brain/migrations/366_approved_contract_provenance_manifest.sql': [
    'initiative_contract_approvals',
    'manifest_digest',
    'approved_manifest',
    'supersedes_approval_id',
  ],
};

for (const [file, needles] of Object.entries(required)) {
  const content = fs.readFileSync(file, 'utf8');
  for (const needle of needles) {
    if (!content.includes(needle)) {
      throw new Error(`${file} missing ${needle}`);
    }
  }
}

console.log('approved-contract-provenance smoke ok');
NODE
