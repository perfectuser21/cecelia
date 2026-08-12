import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  CONTRACT_ARTIFACT_MAX_BYTES,
  collectApprovedContractArtifacts,
  validateContractArtifacts,
} from '../contract-artifacts.js';

const REVISION = '6faaa9f55e9789ffd29fd2760a9b5994df272e86';
const SPRINT_DIR = 'sprints/08121555-unified-work-router';

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function fixture(overrides = {}) {
  const files = {
    [`${SPRINT_DIR}/sprint-prd.md`]: '# PRD',
    [`${SPRINT_DIR}/contract-draft.md`]: '# Contract',
    [`${SPRINT_DIR}/contract-dod.md`]: '# DoD',
    [`${SPRINT_DIR}/task-plan.md`]: '# Plan',
    [`${SPRINT_DIR}/tests/routing.test.mjs`]: 'test("routing", () => {})',
    [`${SPRINT_DIR}/tests/receipt.test.mjs`]: 'test("receipt", () => {})',
    ...overrides,
  };
  return {
    files,
    listGitFiles: vi.fn((_revision, prefix) => Object.keys(files)
      .filter((path) => path.startsWith(`${prefix}/`))
      .reverse()),
    readGitFile: vi.fn((_revision, path) => {
      if (!Object.hasOwn(files, path)) throw new Error(`missing ${path}`);
      return files[path];
    }),
  };
}

describe('collectApprovedContractArtifacts', () => {
  it('从精确 approved SHA 收集完整合同资产并按 path 确定性排序', () => {
    const deps = fixture();

    const result = collectApprovedContractArtifacts({
      sourceRevision: REVISION,
      sprintDir: SPRINT_DIR,
      prdPath: `${SPRINT_DIR}/sprint-prd.md`,
      repo: 'perfectuser21/cecelia',
      ...deps,
    });

    expect(result.artifacts.map((artifact) => artifact.path)).toEqual(
      Object.keys(deps.files).sort(),
    );
    expect(result.artifacts).toEqual(result.artifacts.map((artifact) => ({
      path: artifact.path,
      content: deps.files[artifact.path],
      sha256: sha256(deps.files[artifact.path]),
      byte_length: Buffer.byteLength(deps.files[artifact.path], 'utf8'),
      source_revision: REVISION,
    })));
    expect(deps.listGitFiles).toHaveBeenCalledWith(REVISION, SPRINT_DIR, {
      repo: 'perfectuser21/cecelia',
    });
    expect(deps.readGitFile.mock.calls.every(([revision]) => revision === REVISION)).toBe(true);
    expect(result.prdContent).toBe('# PRD');
    expect(result.contractContent).toBe('# Contract\n\n# DoD');
  });

  it('task-plan 不存在时仍冻结核心三件套和 tests', () => {
    const deps = fixture();
    delete deps.files[`${SPRINT_DIR}/task-plan.md`];

    const result = collectApprovedContractArtifacts({
      sourceRevision: REVISION,
      sprintDir: SPRINT_DIR,
      readGitFile: deps.readGitFile,
      listGitFiles: deps.listGitFiles,
    });

    expect(result.artifacts.map(({ path }) => path)).not.toContain(`${SPRINT_DIR}/task-plan.md`);
    expect(result.artifacts).toHaveLength(5);
  });

  it('task-plan 已被 Git 列出但读取失败时 fail closed', () => {
    const deps = fixture();
    deps.readGitFile.mockImplementation((_revision, path) => {
      if (path === `${SPRINT_DIR}/task-plan.md`) throw new Error('ETIMEDOUT');
      return deps.files[path];
    });

    expect(() => collectApprovedContractArtifacts({
      sourceRevision: REVISION,
      sprintDir: SPRINT_DIR,
      readGitFile: deps.readGitFile,
      listGitFiles: deps.listGitFiles,
    })).toThrow(/FROZEN_CONTRACT_ARTIFACTS_MISSING.*task-plan/i);
  });

  it('持久化边界拒绝缺核心三件套或混合 source revision 的资产集合', () => {
    const deps = fixture();
    const complete = collectApprovedContractArtifacts({
      sourceRevision: REVISION,
      sprintDir: SPRINT_DIR,
      readGitFile: deps.readGitFile,
      listGitFiles: deps.listGitFiles,
    }).artifacts;

    expect(() => validateContractArtifacts(
      complete.filter(({ path }) => !path.endsWith('/contract-dod.md')),
      { requireTests: true, requireCore: true },
    )).toThrow(/FROZEN_CONTRACT_ARTIFACTS_MISSING:core/);
    expect(() => validateContractArtifacts(
      complete.map((artifact, index) => index === 0
        ? { ...artifact, source_revision: 'a'.repeat(40) }
        : artifact),
      { requireTests: true, requireCore: true },
    )).toThrow(/FROZEN_CONTRACT_ARTIFACT_INVALID:source_revision_set/);
  });

  it.each([
    ['tests 为空', []],
    ['tests 路径遍历', [`${SPRINT_DIR}/tests/../escape.test.mjs`]],
    ['tests 绝对路径', ['/tmp/escape.test.mjs']],
    ['tests 重复路径', [
      `${SPRINT_DIR}/tests/routing.test.mjs`,
      `${SPRINT_DIR}/tests/routing.test.mjs`,
    ]],
  ])('%s 时 fail closed', (_name, listedPaths) => {
    const deps = fixture();
    deps.listGitFiles.mockReturnValue(listedPaths);

    expect(() => collectApprovedContractArtifacts({
      sourceRevision: REVISION,
      sprintDir: SPRINT_DIR,
      readGitFile: deps.readGitFile,
      listGitFiles: deps.listGitFiles,
    })).toThrow(/FROZEN_CONTRACT_ARTIFACT/);
  });

  it('核心文件缺失时不返回半份批准合同', () => {
    const deps = fixture();
    delete deps.files[`${SPRINT_DIR}/contract-dod.md`];

    expect(() => collectApprovedContractArtifacts({
      sourceRevision: REVISION,
      sprintDir: SPRINT_DIR,
      readGitFile: deps.readGitFile,
      listGitFiles: deps.listGitFiles,
    })).toThrow(/FROZEN_CONTRACT_ARTIFACTS_MISSING/);
  });

  it('总 UTF-8 字节数超过 256 KiB 时稳定拒绝', () => {
    const deps = fixture({
      [`${SPRINT_DIR}/tests/large.test.mjs`]: '界'.repeat(CONTRACT_ARTIFACT_MAX_BYTES),
    });

    expect(() => collectApprovedContractArtifacts({
      sourceRevision: REVISION,
      sprintDir: SPRINT_DIR,
      readGitFile: deps.readGitFile,
      listGitFiles: deps.listGitFiles,
    })).toThrow(/FROZEN_CONTRACT_ARTIFACT_SIZE_LIMIT/);
  });
});
