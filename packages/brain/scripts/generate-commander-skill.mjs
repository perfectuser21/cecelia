#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { parseActivityContract, object } from '../src/orchestrator/activity-contract.js';

// 设计时生成；stdin 显式契约+SOP，stdout 单个JSON。没有网络、模型或运行时副作用。
const text = value => typeof value === 'string' && value.trim().length > 0
  && value.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const requireValid = condition => { if (!condition) throw Error('commander_skill_invalid'); };
const lines = values => values.length ? values.map(value => `- ${value}`) : ['- 无声明'];

export function generateCommanderSkill(input) {
  requireValid(object(input) && /^[a-z][a-z0-9_]{0,63}$/.test(input.capability));
  let contract = input.contract;
  requireValid(object(contract) && text(contract.workflow) && Array.isArray(contract.activities)
    && contract.activities.length > 0 && contract.activities.length <= 40);
  if (contract.activities.every(a => a.runtime?.protocol === 'json-stdio-v1')) contract = parseActivityContract(contract);
  else {
    const orders = new Set(), keys = new Set();
    for (const a of contract.activities) {
      requireValid(object(a) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(a.key) && !keys.has(a.key)
        && Number.isFinite(a.order) && a.order > 0 && !orders.has(a.order)
        && Number.isSafeInteger(a.budget?.max_duration_s) && a.budget.max_duration_s > 0
        && Number.isSafeInteger(a.budget?.heartbeat_s) && a.budget.heartbeat_s > 0
        && object(a.runtime) && ['setup', 'source', 'per_item', 'batch_end', 'finalize'].includes(a.runtime.phase)
        && text(a.runtime.entry));
      keys.add(a.key); orders.add(a.order);
    }
    contract = { ...contract, activities: [...contract.activities].sort((a, b) => a.order - b.order) };
  }
  requireValid(object(input.sop) && input.sop.schema_version === 1 && Array.isArray(input.sop.cases)
    && input.sop.cases.length <= 40);
  const codes = new Set();
  for (const c of input.sop.cases) {
    requireValid(object(c) && Object.keys(c).every(key => ['code', 'observed', 'action', 'verify', 'permission'].includes(key))
      && ['code', 'observed', 'action', 'verify'].every(key => text(c[key])) && !codes.has(c.code)
      && ['automatic', 'ask', 'report_only'].includes(c.permission));
    codes.add(c.code);
  }
  for (const a of contract.activities) {
    requireValid(text(a.name) && Array.isArray(a.postconditions) && a.postconditions.length > 0
      && a.postconditions.every(p => object(p) && text(p.probe) && text(p.asserts))
      && Array.isArray(a.steps) && a.steps.every(s => object(s) && text(s.key) && text(s.check))
      && [a.failure.empty_ok, a.failure.retryable, a.failure.fatal, a.failure.needs_human.cases]
        .every(values => values.every(text)));
  }
  const contractSha = createHash('sha256').update(JSON.stringify(input.contract)).digest('hex');
  const sopSha = createHash('sha256').update(JSON.stringify(input.sop)).digest('hex');
  const name = `wf-${input.capability}`;
  const out = ['---', `name: ${name}`,
    `description: ${JSON.stringify(`仅用于照完整调度单启动和陪跑 ${input.capability}；按已批准契约监督活动、处置同run故障及完成售后。`)}`,
    `commander_capability: ${input.capability}`, `contract_sha256: ${contractSha}`, `sop_sha256: ${sopSha}`, '---', '',
    `# ${name}`, '', `workflow: ${contract.workflow}`, '',
    '本文件由契约与业务SOP生成。修改真身后重新生成，禁止在运行时改契约或手改本投影。',
    '照完整调度单执行；不选机器、不选手机、不组装 workflow。先确认起跑，再按当前活动证据和预算陪跑。',
    '读取SOP、日志、回执和写心跳必须经调度声明的网关；读不到记 unknown，不猜成功。',
    '终态优先：先检查同TAG协调器请求；已有finalize请求时只核终态、完成售后，不再发运行期心跳或触碰手机。',
    '自动动作限可逆且不出本 run；不可逆或越界动作请示；代码问题只报根因和修法。',
    '空产出只按活动 empty_ok 判定，重试不超过契约 max_attempts；超预算平滑请求收工，保留已采产物。',
    '每tick核对同TAG/设备/锁，按网关给定心跳指令留痕。锁不属于本run时不得清场或解锁。', ''];
  for (const a of contract.activities) {
    out.push(`## ${a.order}. ${a.name} (${a.key})`, '',
      `阶段：${a.runtime.phase}；入口：${a.runtime.entry}；预算：${a.budget.max_duration_s} 秒；活动心跳：${a.budget.heartbeat_s} 秒；最多尝试：${a.runtime.max_attempts ?? 1}。`);
    if (a.runtime.protocol !== 'json-stdio-v1') out.push(`仅用于监督既有shell契约；参数：${a.runtime.args ?? '按调度单与执行计划'}。不能作为JSON执行器输入。`);
    if (a.runtime.detached) out.push('独立触发活动：不属于本批执行顺序，不由陪跑另行发起。');
    if (a.runtime.per_item) out.push(`逐条目分组：${JSON.stringify(a.runtime.per_item)}。`);
    out.push('', '正常态与探针：', ...a.postconditions.map(p => `- ${p.probe}：${p.asserts}`),
      '', '步骤读回：', ...a.steps.map(s => `- ${s.key}：${s.check}`));
    for (const [label, values] of [['允许空产出', a.failure.empty_ok], ['可重试', a.failure.retryable],
      ['需要人处理', a.failure.needs_human.cases], ['致命', a.failure.fatal]]) out.push('', `${label}：`, ...lines(values));
    out.push('');
  }
  out.push('## 同run故障SOP', '');
  for (const c of input.sop.cases) out.push(`### ${c.code}`, `- 实测判据：${c.observed}`,
    `- 权限：${c.permission}`, `- 动作：${c.action}`, `- 读回：${c.verify}`, '');
  out.push('## finalize、复盘与下岗', '',
    '只认同run程序finalize回执；核对真实终态、产物、探针、清场、放锁和执行器已退出。',
    '复盘写事实、证据、actor，区分异常与处置结果；不得把日志自报或cron入队当成功。',
    '收到协调器请求后，完成售后才写同TAG、同nonce完成凭证；at在网关实际写回执时由程序生成带时区时间，禁止估算或抄请求时间；每个售后tick重新核验证据并写本轮回执，不能复用旧回执，然后正常结束tick。',
    'Cecelia确认Brain写入读回、在途tick自然成功后负责下岗；Commander不得自行 cron rm。', '');
  return { schema_version: 1, name, capability: input.capability, workflow: contract.workflow,
    contract_sha256: contractSha, sop_sha256: sopSha, skill: out.join('\n') };
}

let data = '';
try {
  for await (const chunk of process.stdin) {
    data += chunk;
    requireValid(Buffer.byteLength(data) <= 2 * 1024 * 1024);
  }
  const output = generateCommanderSkill(JSON.parse(data));
  process.stdout.write(JSON.stringify(output) + '\n');
} catch {
  process.stderr.write('commander_skill_invalid\n'); process.exitCode = 1;
}
