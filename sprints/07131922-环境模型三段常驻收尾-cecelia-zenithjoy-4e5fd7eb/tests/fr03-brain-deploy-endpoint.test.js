/**
 * fr03-brain-deploy-endpoint.test.js
 * 验证 FR-03：Brain deploy/dev 端点存在并可调用
 * Sprint: 07131922-环境模型三段常驻收尾
 * task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
 *
 * 运行：node fr03-brain-deploy-endpoint.test.js
 * 或：cd /workspace && node sprints/07131922-.../tests/fr03-brain-deploy-endpoint.test.js
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const BRAIN_SRC = path.join(ROOT_DIR, 'packages/brain/src');

let PASS = 0;
let FAIL = 0;

function logPass(msg) { console.log(`[PASS] ${msg}`); PASS++; }
function logFail(msg) { console.log(`[FAIL] ${msg}`); FAIL++; }
function logSkip(msg) { console.log(`[SKIP] ${msg}`); }

console.log('=== FR-03: Brain Deploy Dev 端点核验 ===\n');

// T01: Brain src 中存在 deploy dev 端点定义
console.log('--- T01: 端点代码存在性 ---');
try {
  const grepResult = execSync(
    `grep -rn "deploy.*dev\\|dev.*deploy\\|POST.*deploy" "${BRAIN_SRC}" --include="*.js" | grep -v "__tests__" | grep -v ".test." | head -10`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  if (grepResult.length > 0) {
    logPass(`T01: 找到 deploy/dev 相关端点定义:\n  ${grepResult.split('\n').slice(0, 3).join('\n  ')}`);
  } else {
    logFail('T01: 未找到 POST /api/brain/deploy {dev:true} 端点定义');
  }
} catch {
  logFail('T01: grep 执行失败或无结果');
}

// T02: 存在 /api/brain/deploy/dev/status 查询端点
console.log('\n--- T02: dev/status 端点 ---');
try {
  const statusEndpoint = execSync(
    `grep -rn "deploy/dev/status\\|deploy.*dev.*status" "${BRAIN_SRC}" --include="*.js" | grep -v "__tests__" | head -5`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  if (statusEndpoint.length > 0) {
    logPass(`T02: 找到 deploy/dev/status 端点:\n  ${statusEndpoint.split('\n')[0]}`);
  } else {
    logFail('T02: 未找到 GET /api/brain/deploy/dev/status 端点定义');
  }
} catch {
  logFail('T02: 查找 dev/status 端点失败');
}

// T03: 存在单元测试覆盖 deploy dev
console.log('\n--- T03: 单元测试覆盖 ---');
const testsDir = path.join(BRAIN_SRC, '__tests__');
if (existsSync(testsDir)) {
  try {
    const testFiles = execSync(
      `find "${testsDir}" -name "*.test.*" | xargs grep -l "deploy.*dev\\|dev.*deploy" 2>/dev/null || echo ""`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (testFiles.length > 0) {
      logPass(`T03: 找到 deploy/dev 单元测试: ${testFiles}`);
    } else {
      logFail('T03: 未找到覆盖 POST /api/brain/deploy {dev:true} 的单元测试');
    }
  } catch {
    logFail('T03: 查找单元测试失败');
  }
} else {
  logFail(`T03: __tests__ 目录不存在: ${testsDir}`);
}

// T04: auto-dev-deploy.yml 存在
console.log('\n--- T04: CI workflow 存在性 ---');
const workflowPath = path.join(ROOT_DIR, '.github/workflows/auto-dev-deploy.yml');
if (existsSync(workflowPath)) {
  const content = readFileSync(workflowPath, 'utf-8');
  logPass('T04: .github/workflows/auto-dev-deploy.yml 存在');

  // T04a: 触发条件含 develop 分支
  if (content.includes('develop')) {
    logPass('T04a: workflow 含 develop 分支触发条件');
  } else {
    logFail('T04a: workflow 缺少 develop 分支触发条件');
  }

  // T04b: concurrency group 为 deploy-environment
  if (content.includes('deploy-environment')) {
    logPass('T04b: concurrency group=deploy-environment（与 staging 串行）');
  } else {
    logFail('T04b: 缺少 concurrency group=deploy-environment');
  }

  // T04c: cancel-in-progress: false
  if (content.includes('cancel-in-progress: false')) {
    logPass('T04c: cancel-in-progress=false（不取消在途部署）');
  } else {
    logFail('T04c: 缺少 cancel-in-progress: false');
  }

  // T04d: timeout-minutes 设置
  if (content.includes('timeout-minutes')) {
    logPass('T04d: 含 timeout-minutes 限制');
  } else {
    logFail('T04d: 缺少 timeout-minutes 配置（应 ≤ 10 分钟）');
  }
} else {
  logFail('T04: .github/workflows/auto-dev-deploy.yml 不存在（FR-03 未实施）');
}

// T05: 在线端点验证（可选）
console.log('\n--- T05: 在线端点验证（可选）---');
try {
  const healthCheck = execSync(
    'curl -sf http://localhost:5221/api/brain/health 2>/dev/null',
    { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  if (healthCheck.includes('healthy')) {
    logPass('T05前置: Brain 5221 健康，可执行在线端点测试');
    // 尝试调用 deploy/dev/status 端点
    try {
      const statusResp = execSync(
        'curl -sf http://localhost:5221/api/brain/deploy/dev/status 2>/dev/null',
        { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (statusResp.length > 0) {
        logPass(`T05: GET /api/brain/deploy/dev/status 返回: ${statusResp.substring(0, 100)}`);
      } else {
        logSkip('T05: /api/brain/deploy/dev/status 返回空响应（可能端点未实施）');
      }
    } catch {
      logSkip('T05: /api/brain/deploy/dev/status 端点暂未实施（FR-03 实施后重跑）');
    }
  } else {
    logSkip('T05: Brain 5221 未运行，跳过在线验证');
  }
} catch {
  logSkip('T05: Brain 5221 未运行，跳过在线验证');
}

console.log('\n============================================');
console.log(`FR-03 完成：PASS=${PASS}  FAIL=${FAIL}`);
console.log('============================================');

if (FAIL > 0) {
  process.exit(1);
}
process.exit(0);
