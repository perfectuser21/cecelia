#!/usr/bin/env node
/**
 * run-contract-scan.mjs
 *
 * 契约覆盖扫描脚本。每日由 Brain tick 自动触发（fire-and-forget）。
 *
 * 功能：
 *   1. 读取 packages/quality/contracts/cecelia-module-boundaries.yaml
 *   2. 检查每个契约的 test_file 是否存在
 *   3. 对未覆盖的契约，向 Brain API 创建 dev 任务
 *
 * 用法：
 *   node packages/brain/scripts/run-contract-scan.mjs [--repo-root /path/to/repo]
 *   node packages/brain/scripts/run-contract-scan.mjs --dry-run
 */

/* global console, process */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ====== 配置 ======
const BRAIN_API_URL = process.env.BRAIN_API_URL || 'http://localhost:5221';
const DRY_RUN = process.argv.includes('--dry-run');

// repo root = 脚本上三层（scripts → brain → packages → root）
const REPO_ROOT_ARG = process.argv.find(a => a.startsWith('--repo-root='))?.split('=')[1];
const REPO_ROOT = REPO_ROOT_ARG || resolve(__dirname, '../../../');

const CONTRACT_FILE = resolve(
  REPO_ROOT,
  'packages/quality/contracts/cecelia-module-boundaries.yaml'
);

// ====== 主逻辑 ======

/**
 * 读取契约定义文件
 * @returns {{ contracts: Array<{ id: string, description: string, test_file: string, priority: string }> }}
 */
function loadContracts() {
  if (!existsSync(CONTRACT_FILE)) {
    console.error(`[contract-scan] 契约文件不存在: ${CONTRACT_FILE}`);
    return { contracts: [] };
  }
  const raw = readFileSync(CONTRACT_FILE, 'utf8');
  return yaml.load(raw);
}

/**
 * 检查单个契约的 test_file 是否存在
 * @param {{ id: string, test_file: string }} contract
 * @returns {{ covered: boolean, test_file: string }}
 */
function checkContract(contract) {
  const testPath = resolve(REPO_ROOT, contract.test_file);
  return {
    covered: existsSync(testPath),
    test_file: contract.test_file,
  };
}

/**
 * 向 Brain API 创建一个 dev 任务，要求补充契约测试
 * @param {{ id: string, description: string, test_file: string, consumer: string, provider: string, priority: string }} contract
 */
async function createDevTask(contract) {
  const title = `补契约测试：${contract.id}`;
  const description = [
    `## 背景`,
    ``,
    `契约扫描发现以下模块边界没有测试保护：`,
    ``,
    `- **契约 ID**: \`${contract.id}\``,
    `- **消费方**: \`${contract.consumer}\``,
    `- **提供方**: \`${contract.provider}\``,
    `- **优先级**: ${contract.priority}`,
    ``,
    `## 契约说明`,
    ``,
    contract.description.trim(),
    ``,
    `## 需要做什么`,
    ``,
    `创建测试文件 \`${contract.test_file}\`，验证以下内容：`,
    `1. 消费方期望的接口/格式/字段`,
    `2. 提供方实际返回的内容匹配期望`,
    `3. 当提供方接口变更时测试立刻报红`,
    ``,
    `## 参考`,
    ``,
    `参考已有契约测试：\`packages/engine/tests/integration/hook-contracts.test.ts\``,
  ].join('\n');

  const payload = {
    title,
    description,
    task_type: 'dev',
    priority: contract.priority === 'P0' ? 'P0' : 'P1',
    created_by: 'contract-scan',
    trigger_source: 'brain_auto',
    location: 'us',
    execution_mode: 'cecelia',
    payload: JSON.stringify({
      contract_id: contract.id,
      test_file: contract.test_file,
    }),
  };

  if (DRY_RUN) {
    console.log(`[contract-scan] [dry-run] 将创建任务: ${title}`);
    return { created: true, dry_run: true };
  }

  try {
    const res = await fetch(`${BRAIN_API_URL}/api/brain/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[contract-scan] 创建任务失败 (${res.status}): ${text.slice(0, 200)}`);
      return { created: false, error: text };
    }

    const data = await res.json();
    console.log(`[contract-scan] 创建任务: ${title} → id=${data.id || data.task_id || 'ok'}`);
    return { created: true, task: data };
  } catch (err) {
    console.error(`[contract-scan] 网络错误: ${err.message}`);
    return { created: false, error: err.message };
  }
}

/**
 * 检查今日是否已为某个契约创建过修复任务（去重）
 * @param {string} contractId
 * @returns {Promise<boolean>}
 */
async function hasTodayTask(contractId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `${BRAIN_API_URL}/api/brain/tasks?task_type=dev&created_by=contract-scan&limit=20`
    );
    if (!res.ok) return false;
    const data = await res.json();
    const tasks = Array.isArray(data) ? data : (data.tasks || []);
    return tasks.some(
      t =>
        t.payload?.contract_id === contractId &&
        t.created_at?.startsWith(today)
    );
  } catch {
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log(`[contract-scan] 开始扫描，repo_root=${REPO_ROOT}${DRY_RUN ? ' [dry-run]' : ''}`);

  const config = loadContracts();
  const contracts = config?.contracts ?? [];

  if (contracts.length === 0) {
    console.log('[contract-scan] 未找到任何契约定义，退出');
    return;
  }

  console.log(`[contract-scan] 共 ${contracts.length} 个契约`);

  const results = {
    covered: [],
    uncovered: [],
    tasksCreated: [],
    errors: [],
  };

  for (const contract of contracts) {
    const { covered } = checkContract(contract);

    if (covered) {
      results.covered.push(contract.id);
      console.log(`[contract-scan] ✅ ${contract.id} → 已覆盖`);
    } else {
      results.uncovered.push(contract.id);
      console.log(`[contract-scan] ❌ ${contract.id} → 未覆盖 (${contract.test_file})`);

      // 去重：今日已创建过则跳过
      const alreadyCreated = DRY_RUN ? false : await hasTodayTask(contract.id);
      if (alreadyCreated) {
        console.log(`[contract-scan] ⏭️  ${contract.id} → 今日已创建任务，跳过`);
        continue;
      }

      const result = await createDevTask(contract);
      if (result.created) {
        results.tasksCreated.push(contract.id);
      } else {
        results.errors.push({ contract_id: contract.id, error: result.error });
      }
    }
  }

  // 汇总报告
  console.log(`\n[contract-scan] 扫描完成：`);
  console.log(`  ✅ 已覆盖: ${results.covered.length} 个`);
  console.log(`  ❌ 未覆盖: ${results.uncovered.length} 个`);
  console.log(`  📝 创建任务: ${results.tasksCreated.length} 个`);
  if (results.errors.length > 0) {
    console.log(`  ⚠️  错误: ${results.errors.length} 个`);
  }

  console.log(JSON.stringify({
    event: 'contract_scan_complete',
    covered: results.covered.length,
    uncovered: results.uncovered.length,
    tasks_created: results.tasksCreated.length,
    errors: results.errors.length,
  }));
}

main().catch(err => {
  console.error('[contract-scan] 致命错误:', err.message);
  process.exit(1);
});
