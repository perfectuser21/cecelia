import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  collectFrozenContractArtifacts,
  createFrozenContractArtifactResolver,
} from '../frozen-contract-artifacts.js';

const APPROVED_SHA = 'a'.repeat(40);
const SPRINT_DIR = 'sprints/08110022-relay-d96c9fa0';

describe('collectFrozenContractArtifacts', () => {
  it('freezes every approved-SHA test as exact content plus digest', () => {
    const files = [
      `${SPRINT_DIR}/tests/change-kind.test.js`,
      `${SPRINT_DIR}/tests/structure-gate.test.js`,
    ];
    const contents = new Map([
      [files[0], 'it("routes the change", () => {});\n'],
      [files[1], 'it("fails closed", () => {});\n'],
    ]);
    const readGitFile = vi.fn((sha, filePath) => {
      expect(sha).toBe(APPROVED_SHA);
      return contents.get(filePath);
    });

    const artifacts = collectFrozenContractArtifacts({
      approvedSha: APPROVED_SHA,
      sprintDir: SPRINT_DIR,
      listGitFiles: vi.fn(() => files),
      readGitFile,
    });

    expect(artifacts).toEqual(files.map((filePath) => ({
      type: 'frozen_contract_test',
      path: filePath,
      content: contents.get(filePath),
      sha256: createHash('sha256').update(contents.get(filePath)).digest('hex'),
      source_sha: APPROVED_SHA,
    })));
    expect(Object.isFrozen(artifacts)).toBe(true);
    expect(artifacts.every(Object.isFrozen)).toBe(true);
  });

  it('fails closed when an approved test cannot be read', () => {
    expect(() => collectFrozenContractArtifacts({
      approvedSha: APPROVED_SHA,
      sprintDir: SPRINT_DIR,
      listGitFiles: () => [`${SPRINT_DIR}/tests/missing.test.js`],
      readGitFile: () => undefined,
    })).toThrow(/frozen_contract_test_unreadable/);
  });

  it('recovers an in-flight approved SHA from the append-only reviewer receipt', async () => {
    const filePath = `${SPRINT_DIR}/tests/red.test.js`;
    const content = 'throw new Error("RED");\n';
    const persisted = [{
      type: 'frozen_contract_test',
      path: filePath,
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
      source_sha: APPROVED_SHA,
    }];
    const db = {
      query: vi.fn(async (_sql, params) => {
        expect(params[1]).toBe(APPROVED_SHA);
        return { rows: [{ approved_sha: APPROVED_SHA, frozen_artifacts: persisted }] };
      }),
    };
    const resolve = createFrozenContractArtifactResolver({
      db,
      listGitFiles: vi.fn((_sha, _prefix, { repo }) => {
        expect(repo).toBe('perfectuser21/cecelia');
        return [filePath];
      }),
      readGitFile: vi.fn(() => content),
    });

    await expect(resolve({
      ctx: {
        observed: {
          task: { payload: { sprint_dir: SPRINT_DIR, base_repo: 'https://github.com/perfectuser21/cecelia.git' } },
          contract: { row: { id: '33333333-3333-4333-8333-333333333333', version: 3, frozen_artifacts: [] } },
          decisionLog: [{
            action: 'verdict:reviewer',
            detail: { rn: 3, verdict: 'APPROVED', contract_sha: APPROVED_SHA },
          }],
        },
      },
    })).resolves.toEqual(persisted);
    expect(db.query).toHaveBeenCalledOnce();
  });
});
