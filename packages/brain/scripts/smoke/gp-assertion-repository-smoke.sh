#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BRAIN_DIR"

node --input-type=module <<'NODE'
import {
  inShortTransaction,
  signedContractFromDb,
} from './src/lib/gp-assertion-repository.js';

const queries = [];
const client = {
  async query(sql) {
    queries.push(sql);
    if (sql.includes('FROM golden_path_contract_versions')) {
      return {
        rows: [{
          id: 'contract-smoke',
          golden_path_id: 'gp-smoke',
          content_hash: 'a'.repeat(64),
          status: 'signed',
        }],
      };
    }
    return { rows: [] };
  },
  release() {
    queries.push('RELEASE');
  },
};
const pool = { async connect() { return client; } };
const result = await inShortTransaction(pool, 'BEGIN', db => (
  signedContractFromDb(db, 'journey-smoke', { lock: 'share' })
));

if (result.signed?.id !== 'contract-smoke') process.exit(1);
if (!queries.some(sql => sql.includes('FOR SHARE OF contract'))) process.exit(1);
if (queries.at(0) !== 'BEGIN' || queries.at(-2) !== 'COMMIT') process.exit(1);
if (queries.at(-1) !== 'RELEASE') process.exit(1);
console.log('GP_ASSERTION_REPOSITORY_SMOKE_PASS');
NODE
