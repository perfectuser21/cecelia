import fs from 'node:fs';

const docPath = 'docs/current/attempt-run-bridge-guide.md';
const sourcePath = 'packages/brain/src/routes/harness-attempt-run.js';
const doc = fs.readFileSync(docPath, 'utf8');
const source = fs.readFileSync(sourcePath, 'utf8');

function section(title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = doc.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm'));
  if (!match) throw new Error(`缺少独立章节：${title}`);
  return match[1];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyEndpoints() {
  const text = section('端点用途');
  assert(text.includes('POST /api/brain/harness/attempt-run'), '端点用途节缺 POST');
  assert(text.includes('GET /api/brain/harness/attempt-run/:id'), '端点用途节缺 GET');
  assert(text.includes('attempt_id') && /同一|该次/.test(text), '未用 attempt_id 串联同一流程');
  console.log('PASS endpoints');
}

function verifyAuth() {
  const text = section('鉴权方式');
  assert(text.includes('internalAuthOrLoopback'), '鉴权节缺 internalAuthOrLoopback');
  assert(text.includes('Authorization: Bearer CECELIA_INTERNAL_TOKEN'), '鉴权节缺 Bearer token');
  assert(/宿主|远端/.test(text) && /必须/.test(text), '未明确宿主/远端必须带 token');
  console.log('PASS auth');
}

function parseSourceRoles() {
  const match = source.match(/export const ALLOWED_ROLES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert(match, '无法解析生产 ALLOWED_ROLES');
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function verifyRolesPayload() {
  const text = section('角色白名单与 payload');
  const documented = [...text.matchAll(/^- `([^`]+)`\s*$/gm)].map((item) => item[1]);
  const expected = parseSourceRoles();
  assert(documented.length === 9, `文档角色项不是 9：${documented.length}`);
  assert(new Set(documented).size === 9, '文档角色存在重复项');
  assert(JSON.stringify([...documented].sort()) === JSON.stringify([...expected].sort()), `角色集合不等：${JSON.stringify(documented)}`);
  for (const field of ['sprint_dir', 'base_repo', 'branch']) {
    assert(text.split('\n').some((line) => line.includes(`\`${field}\``) && line.includes('必填')), `${field} 未明确必填`);
  }
  assert(/`base_sha`[^。\n]*可省略[^。\n]*生产 Brain[^。\n]*自解析/.test(text), 'base_sha 省略语义不准确');
  console.log(`PASS roles-payload ${JSON.stringify(documented)}`);
}

function verifyRollback() {
  const text = section('派发失败自动回滚');
  for (const state of ['run→failed', 'session→closed', 'task→cancelled']) {
    assert(text.includes(state), `回滚节缺 ${state}`);
  }
  console.log('PASS rollback');
}

const checks = { endpoints: verifyEndpoints, auth: verifyAuth, 'roles-payload': verifyRolesPayload, rollback: verifyRollback };
const target = process.argv[2] ?? 'all';
if (target === 'all') Object.values(checks).forEach((check) => check());
else if (checks[target]) checks[target]();
else throw new Error(`未知检查：${target}`);
