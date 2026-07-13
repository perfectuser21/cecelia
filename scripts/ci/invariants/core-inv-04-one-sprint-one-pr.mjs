/**
 * CORE-INV-04 — P0 铁律「1 Sprint = 1 Generator = 1 PR」防倒退断言。
 *
 * 守的是什么：harness-pipeline-v2 重设计（memory: harness-pipeline-v2-redesign）删掉了
 * 多 workstream（WS）拆分——一个 Sprint 只 spawn 一个 Generator、只出一个 PR。
 * 这条铁律没有单一"常量"可断言，机制守卫散在三处源码契约，本脚本机械断言它们不倒退：
 *
 *  1. harness-task.graph.js（旧 WORKSTREAM_INDEX/COUNT 接线点所在文件）已在刀4阶段3
 *     物理删除——本条断言改为「文件不得复活」，比"活代码无注入"更强（连死代码宿主都不许存在）。
 *  2. harness-skill-relay.js（SDD 单 session 编排）不得出现 WORKSTREAM 机制，
 *     且 spawnDockerDetached 调用点恰好 1 处——一个 relay 任务 = 单 session 单 Sprint，
 *     不循环 spawn 多容器。
 *  3. harness-generator SKILL.md 保持「单 Sprint」承诺（一个 Sprint = 一个 Generator = 一个 PR）。
 *
 * CI 干净环境兼容：只 readFile + 正则，node 内建即可跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 剥掉行级注释行（^\s*// 与 ^\s*\*），返回活代码行数组。 */
function activeLines(src) {
  return src.split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l));
}

console.log('== CORE-INV-04 1 Sprint = 1 Generator = 1 PR（多 WS 拆分防倒退）==');

// 1) harness-task.graph.js：文件本身已被物理删除，不得复活（比"活代码无注入"更强的不变量）
const taskGraphPath = path.join(ROOT, 'packages/brain/src/workflows/harness-task.graph.js');
check(
  'harness-task.graph.js 保持已删除状态（WORKSTREAM_INDEX/COUNT 接线点连宿主文件都不存在）',
  !fs.existsSync(taskGraphPath),
  `文件复活: ${taskGraphPath}`
);

// 2) harness-skill-relay.js：单 session 单 Sprint，无 WS 机制、单一 spawn 调用点
const relayPath = path.join(ROOT, 'packages/brain/src/harness-skill-relay.js');
const relay = fs.readFileSync(relayPath, 'utf8');
check(
  'harness-skill-relay.js 无任何 WORKSTREAM 机制',
  !/WORKSTREAM/i.test(activeLines(relay).join('\n')),
  '出现 workstream 关键字'
);
// relay 通过 `const spawnFn = deps.spawnFn || spawnDockerDetached` 注入后调用：
// 断言 ①默认实现确为 spawnDockerDetached ②spawnFn 调用点恰 1 处（单 session，无多容器循环）
const relayActive = activeLines(relay).join('\n');
check(
  'harness-skill-relay.js 默认 spawn 实现 = spawnDockerDetached（存量原语，非自造多发装置）',
  /spawnDockerDetached/.test(relayActive)
);
const spawnCalls = relayActive.match(/(?:await\s+)?\bspawnFn\s*\(/g) || [];
check(
  'harness-skill-relay.js spawnFn 调用点恰 1 处（单 session 单 Sprint，无多容器循环）',
  spawnCalls.length === 1,
  `调用点数=${spawnCalls.length}`
);

// 3) harness-generator SKILL.md：单 Sprint 承诺仍在
const skillPath = path.join(ROOT, 'packages/workflows/skills/harness-generator/SKILL.md');
if (fs.existsSync(skillPath)) {
  const skill = fs.readFileSync(skillPath, 'utf8');
  check(
    'harness-generator SKILL.md 保持「单 Sprint / 一个 Sprint = 一个 Generator = 一个 PR」承诺',
    /单\s*Sprint/.test(skill) || /一个\s*Sprint\s*=\s*一个\s*Generator/.test(skill),
    'SKILL.md 里找不到单 Sprint 承诺'
  );
} else {
  // harness-controller / generator skill 若迁出本 repo（skills SSOT=zenithjoy-skills）则跳过此项
  console.log('  SKIP harness-generator SKILL.md 不在本 repo（skills SSOT 外迁），跳过');
}

if (failures > 0) {
  console.error(`== CORE-INV-04 FAIL（${failures} 项）— 铁律「1 Sprint = 1 PR」守卫被破坏 ==`);
  process.exit(1);
}
console.log('== CORE-INV-04 PASS ==');
