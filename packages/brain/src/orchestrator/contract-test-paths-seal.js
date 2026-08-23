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

export function assertTestContractResolvable(contractContent, artifacts, { readRepoFile } = {}) {
  const content = String(contractContent ?? '');
  // r51（run 587f4f0e，r45 族第 4 变体）：manual 命令带 vitest -t 过滤时，其余用例
  // 被 skip，输出形如 "1 passed | 2 skipped (3)"——精确尾缀 grep "N passed (N)"
  // 必败 → CI 确定性红且冻结后 fix 无权修。封印时静态拦：同一行命令既含 ` -t `
  // 又含 passed-精确尾缀 grep 的，拒封印打回 proposer（换 grep -qE "[1-9][0-9]* passed"）。
  for (const line of content.split('\n')) {
    if (!/manual:|vitest/.test(line)) continue;
    if (/\s-t\s+["']/.test(line) && /grep[^|]*passed \([0-9]+\)/.test(line)) {
      throw new Error(
        `FROZEN_CONTRACT_TEST_CONTRACT_FRAGILE_GREP:${line.trim().slice(0, 160)}`,
      );
    }
  }
  const rows = parseTestContract(content);
  const artifactPaths = new Set(
    (Array.isArray(artifacts) ? artifacts : [])
      .map((artifact) => artifact?.path)
      .filter((p) => typeof p === 'string' && p.length > 0),
  );
  // r45（run 6de78554）死锁案卷：proposer 漏产 ## Test Contract 表（rows=0）时旧逻辑
  // 直接放行，CI 覆盖闸在 generator 后才红，而 contract-draft 已冻结（守卫正确拒改）
  // → fix 结构性无解。封印时点强制：artifacts 里每个冻结测试文件都必须被表登记；
  // 缺表/漏登记拒封印，打回 proposer 可重写轮。
  const frozenTestFiles = [...artifactPaths].filter(
    (p) => /\/tests\//.test(p) && /\.(test\.[cm]?[jt]sx?|test\.sh|mjs)$/.test(p),
  );
  const registered = new Set(rows.map((row) => String(row?.testFile ?? '')));
  const unregistered = frozenTestFiles.filter((p) => !registered.has(p));
  if (unregistered.length > 0) {
    throw new Error(
      `FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED:${unregistered.join(',')}`,
    );
  }
  if (rows.length === 0) return;
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
    if (!testFile.startsWith('sprints/')) {
      // r50（run a998d588，r45 族第 3 变体）：repo 既有路径行的 BEHAVIOR 措辞
      // 无法匹配 it() 名时，CI 覆盖检查红的唯一修法在冻结 contract-draft →
      // fix 死锁。注入 readRepoFile 时用同一把尺在封印时点校验；文件读不到 =
      // 登记了不存在的 repo 测试，同拒。未注入时保持现行为（零回归兜底）。
      if (typeof readRepoFile !== 'function' || testFile.endsWith('.sh')) continue;
      let repoContent = null;
      try {
        repoContent = String(readRepoFile(testFile) ?? '');
      } catch (readError) {
        // 失败留真实原因（r61 冤案：底层是 repo 白名单 throw，被吞成裸路径后
        // 误诊为 proposer 没建文件，两轮点火全冤杀）。
        const cause = String(readError?.message ?? readError ?? 'unknown')
          .replace(/[\s,]+/g, ' ')
          .slice(0, 160);
        unresolved.push(`${testFile}#read_error:${cause}`);
        continue;
      }
      const repoItNames = [...repoContent.matchAll(/\b(?:it|test)\(['"]([^'"]+)['"]/g)]
        .map((m) => m[1]);
      for (const behavior of (Array.isArray(row?.behaviors) ? row.behaviors : [])) {
        const found = repoItNames.some(
          (n) => n.toLowerCase().includes(String(behavior).toLowerCase())
            || String(behavior).toLowerCase().includes(n.toLowerCase()),
        );
        if (!found) unresolved.push(`${testFile}#behavior:${behavior}`);
      }
      continue;
    }
    const resolution = resolveContractTestFile({
      root: VIRTUAL_ROOT,
      contractPath,
      testFile,
      existsSync,
    });
    if (!resolution.resolvedPath) {
      unresolved.push(testFile);
      continue;
    }
    // r39（run d2334022）：BEHAVIOR 覆盖名与冻结 it() 名不匹配时，CI 覆盖检查在
    // generator 后才红，而合同与冻结测试封印后双不可变 → fix 无解死局。封印时用
    // check-test-coverage 相同的匹配语义（it/test 名提取 + 双向小写子串）提前拦截。
    if (!testFile.endsWith('.sh')) {
      const rel = path.relative(VIRTUAL_ROOT, resolution.resolvedPath).split(path.sep).join('/');
      const artifact = (Array.isArray(artifacts) ? artifacts : []).find((a) => a?.path === rel);
      const content = typeof artifact?.content === 'string' ? artifact.content : '';
      const itNames = [...content.matchAll(/\b(?:it|test)\(['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const behavior of (Array.isArray(row?.behaviors) ? row.behaviors : [])) {
        const found = itNames.some(
          (n) => n.toLowerCase().includes(String(behavior).toLowerCase())
            || String(behavior).toLowerCase().includes(n.toLowerCase()),
        );
        if (!found) unresolved.push(`${testFile}#behavior:${behavior}`);
      }
    }
  }
  if (unresolved.length > 0) {
    throw new Error(
      `FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE:${unresolved.join(',')}`,
    );
  }
}
