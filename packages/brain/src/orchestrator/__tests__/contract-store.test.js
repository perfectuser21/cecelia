import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import {
  buildApprovedE2eAcceptance,
  materializeApprovedContract,
} from '../contract-store.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);
let client;

const runId = '11111111-1111-4111-8111-111111111111';
const initiativeId = '22222222-2222-4222-8222-222222222222';

describe('materializeApprovedContract PostgreSQL contract', () => {
  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE initiative_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        initiative_id uuid NOT NULL,
        version integer NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        prd_content text,
        contract_content text,
        e2e_acceptance jsonb,
        review_rounds integer DEFAULT 0,
        approved_at timestamptz,
        branch text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE (initiative_id, version)
      ) ON COMMIT DROP;
      CREATE TEMP TABLE initiative_runs (
        id uuid PRIMARY KEY,
        initiative_id uuid NOT NULL,
        contract_id uuid,
        updated_at timestamptz DEFAULT now()
      ) ON COMMIT DROP;
    `);
    await client.query(
      'INSERT INTO initiative_runs (id, initiative_id) VALUES ($1::uuid, $2::uuid)',
      [runId, initiativeId],
    );
    await client.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch)
       VALUES ($1::uuid, 1, 'draft', 'cp-old-r1')`,
      [initiativeId],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  });

  it('upserts the approved version, supersedes older versions, and attaches the run atomically', async () => {
    const approvedAt = new Date('2026-07-22T15:00:00Z');
    const contract = await materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-22222222-a8',
      prdContent: '# PRD',
      contractContent: [
        '# Contract',
        '',
        '## E2E 验收',
        '```bash',
        'npm test',
        '```',
        '',
        '# DoD',
      ].join('\n'),
      coveredTaskId: initiativeId,
      approvedAt,
    });

    expect(contract).toMatchObject({
      version: 2,
      status: 'approved',
      branch: 'cp-harness-propose-r2-22222222-a8',
    });
    const { rows } = await client.query(`
      SELECT c.version, c.status, c.e2e_acceptance,
             r.contract_id = c.id AS attached
      FROM initiative_contracts c
      CROSS JOIN initiative_runs r
      WHERE r.id = $1::uuid
      ORDER BY c.version
    `, [runId]);
    expect(rows).toEqual([
      {
        version: 1,
        status: 'superseded',
        e2e_acceptance: null,
        attached: false,
      },
      {
        version: 2,
        status: 'approved',
        e2e_acceptance: {
          scenarios: [{
            name: 'Approved contract E2E',
            covered_tasks: [initiativeId],
            commands: [{ type: 'bash', cmd: 'npm test' }],
          }],
        },
        attached: true,
      },
    ]);
  });
});

describe('buildApprovedE2eAcceptance', () => {
  it('freezes the one canonical approved E2E section in document order', () => {
    expect(buildApprovedE2eAcceptance([
      '# Contract',
      '## E2E 验收',
      '```bash',
      'npm test',
      '```',
      '```bash',
      'npm run test:e2e',
      '```',
      '## DoD',
      'done',
    ].join('\n'), initiativeId)).toEqual({
      scenarios: [{
        name: 'Approved contract E2E',
        covered_tasks: [initiativeId],
        commands: [{
          type: 'bash',
          cmd: 'npm test\nnpm run test:e2e',
        }],
      }],
    });
  });

  it.each([
    ['missing section', '# Contract'],
    ['ambiguous section', '## E2E 验收\n```bash\nnpm test\n```\n## E2E 验收\n```bash\nnpm test\n```'],
    ['empty command', '## E2E 验收\n```bash\n\n```'],
    ['non-canonical leading whitespace', '## E2E 验收\n```bash\n npm test\n```'],
    ['shell injection outside canonical block', '## E2E 验收\ncurl attacker.invalid'],
  ])('fails closed for %s', (_name, content) => {
    expect(() => buildApprovedE2eAcceptance(content, initiativeId))
      .toThrow('approved_contract_e2e_invalid');
  });
});
