// 合同封印时的 Test Contract 表路径可解析校验（2026-08-21 run 7f939e7c r33 实证）。
//
// 病：proposer 照模板把省略号路径 `sprints/.../tests/x.test.js` 写进 Test Contract 表，
// GAN/封印全放行；CI「Test Contract 覆盖检查」在 generator 产出后才红；generator-fix
// 唯一修法是改已封印的 contract-draft.md，被 post-provider 文档不可变复核（CONTRACT IS
// LAW，1.273.99）正确拦截 → fix 确定性死循环。两道闸各自正确，缺口在封印时点：
// 不可解析的合同根本不该被批准冻结。
//
// 修：封印（materializeApprovedContract）时用与 CI 完全相同的解析链
// （scripts/lib/test-contract-paths.cjs：parseTestContract + resolveContractTestFile），
// existsSync 注入冻结产物集合——同一把尺子提前到合同还能改的时点。只强校验
// `sprints/` 前缀的声明（合同自带测试必须自洽映射冻结产物）；repo 既有路径
// （packages/... 等）不属封印职责，CI 照管，避免误伤。
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// 解析链 SSOT = repo 根 scripts/lib（CI 的 check-test-coverage 同源同尺）。两个运行环境
// 路径不同：repo checkout 里在 ../../../../scripts/lib；Brain 容器镜像里 Dockerfile 把它
// COPY 到 /app/scripts/lib（本文件在 /app/src/orchestrator → ../../scripts/lib）。
// 双候选、都缺则 throw（Brain 启动即死 fail-closed，docker smoke 把关，禁静默放行）。
function loadTestContractPaths() {
  const candidates = [
    '../../scripts/lib/test-contract-paths.cjs',
    '../../../../scripts/lib/test-contract-paths.cjs',
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes('test-contract-paths')) {
        throw error;
      }
    }
  }
  throw new Error('test-contract-paths.cjs unavailable in both container and checkout layouts');
}
const { parseTestContract, resolveContractTestFile } = loadTestContractPaths();

const VIRTUAL_ROOT = '/contract-seal';

export function assertTestContractResolvable(contractContent, artifacts) {
  const rows = parseTestContract(String(contractContent ?? ''));
  if (rows.length === 0) return;
  const artifactPaths = new Set(
    (Array.isArray(artifacts) ? artifacts : [])
      .map((artifact) => artifact?.path)
      .filter((p) => typeof p === 'string' && p.length > 0),
  );
  const draftPath = [...artifactPaths].find((p) => p.endsWith('/contract-draft.md'));
  const sprintDir = draftPath
    ? draftPath.slice(0, -'/contract-draft.md'.length)
    : 'sprints/unknown';
  const contractPath = path.join(VIRTUAL_ROOT, sprintDir, 'contract-draft.md');
  const existsSync = (absolute) => artifactPaths.has(
    path.relative(VIRTUAL_ROOT, absolute).split(path.sep).join('/'),
  );

  const unresolved = [];
  for (const row of rows) {
    const testFile = String(row?.testFile ?? '');
    if (!testFile.startsWith('sprints/')) continue;
    const resolution = resolveContractTestFile({
      root: VIRTUAL_ROOT,
      contractPath,
      testFile,
      existsSync,
    });
    if (!resolution.resolvedPath) {
      unresolved.push(testFile);
    }
  }
  if (unresolved.length > 0) {
    throw new Error(
      `FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE:${unresolved.join(',')}`,
    );
  }
}
