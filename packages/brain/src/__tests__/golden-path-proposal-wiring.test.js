// 本文件验证已获授权后的协议；真实默认拒绝见 execution-directory/legacy-relay.test.js。
vi.mock('../execution-directory/legacy-relay.js',()=>({withLegacyRelayExecution:async(_identity,operation)=>operation()}));
// 此执行器测试注入模拟传输；真实隔离入口由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
/**
 * GP2/T2 executor 派发接线（DoD F2）。
 * dispatch 分支/override 排除用源码断言（同 all-features-smoke.test.js 读源模式）——
 * executeTask 全链需重基建 fake，接线正确性由字面量条件保证。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXECUTOR_KIND_FOR } from '../executor-contracts.js';
import { routeTaskCreate } from '../task-router.js';
import { spawnSkillRelaySession } from '../harness-skill-relay.js';
import { INITIATIVE_LOCK_TASK_TYPES, RETIRED_HARNESS_TYPES_DISPATCH, HARNESS_INFLIGHT_TASK_TYPES } from '../lib/task-type-registry.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../executor.js'), 'utf8'
);

describe('executor: golden_path_proposal 派发接线', () => {
  it('EXECUTOR_KIND_FOR不再提供退役GP启动执行体', () => {
    expect(EXECUTOR_KIND_FOR.golden_path_proposal).toBeUndefined();
  });

  it('dispatch 分支覆盖 golden_path_proposal（复用 runHarnessInitiativeRouter）', () => {
    expect(SRC).toMatch(
      /task\.task_type === 'harness_initiative' \|\| task\.task_type === 'golden_path_proposal'/
    );
  });

  it('显式 machine/executor override 排除 golden_path_proposal（防劫持绕过 relay）', () => {
    expect(SRC).toMatch(
      /task\.task_type !== 'harness_initiative' &&\s*task\.task_type !== 'golden_path_proposal'/
    );
  });
});

const DISPATCHER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../dispatcher.js'), 'utf8'
);

describe('dispatcher: golden_path_proposal 防线接线', () => {
  it('并发 cap 计数 SQL 口径含 golden_path_proposal——严格等于 HARNESS_INFLIGHT_TASK_TYPES，且绑定的正是这个导出（不是同名巧合）', () => {
    // Task 3 裁决后（qiumi-task-router PR1）：这条 SQL 改参数化
    // task_type = ANY($2::text[])，字面量不再出现在 SQL 文本里。团队审查 Important #1
    // 裁决：光靠正则测不出"$2 到底绑的是哪个数组"，这里用严格集合相等（不只是
    // toContain）+ 钉住源码里参数数组字面量原样写的是 `[...HARNESS_INFLIGHT_TASK_TYPES]`
    // 这个标识符（不是转抄的字面量、不是另一个同值变量），双重确认绑定对象。
    expect(new Set(HARNESS_INFLIGHT_TASK_TYPES)).toEqual(new Set(['harness_initiative', 'golden_path_proposal']));
    expect(DISPATCHER_SRC).toMatch(/task_type = ANY\(\$2::text\[\]\)/);
    expect(DISPATCHER_SRC).toContain('[candidate.id, [...HARNESS_INFLIGHT_TASK_TYPES]]');
  });
  it('INITIATIVE_LOCK_TASK_TYPES 含 golden_path_proposal', () => {
    // Task 3（qiumi-task-router PR1）之后名单来自 lib/task-type-registry.js 的
    // INITIATIVE_LOCK_TASK_TYPES 派生集合，dispatcher.js 不再手抄字面量数组。
    expect(INITIATIVE_LOCK_TASK_TYPES).toContain('golden_path_proposal');
    // 0923 秋米熔断豁免刀：同一条 import 又加了 getTaskType（判 openclaw-agent 表面），
    // 原先钉死"三个名字按此顺序紧邻"的正则会被任何新增具名导入打红。
    // 放宽为：定位那条 from './lib/task-type-registry.js' 的 import 语句，
    // 断言它确实具名导入了这几个标识符（顺序无关，但必须在同一条 import 里）。
    const registryImport = DISPATCHER_SRC.match(/import \{([^}]*)\} from '\.\/lib\/task-type-registry\.js';/);
    expect(registryImport, "dispatcher.js 必须从 './lib/task-type-registry.js' 具名 import 名单").not.toBeNull();
    const importedNames = registryImport[1].split(',').map((s) => s.trim());
    for (const name of ['INITIATIVE_LOCK_TASK_TYPES', 'RETIRED_HARNESS_TYPES_DISPATCH', 'HARNESS_INFLIGHT_TASK_TYPES', 'getTaskType']) {
      expect(importedNames, `${name} 必须来自 task-type-registry.js（不能手抄字面量）`).toContain(name);
    }
  });
  it('needsBridgeCheck 豁免 golden_path_proposal（relay 不依赖 bridge）——严格等于 HARNESS_INFLIGHT_TASK_TYPES', () => {
    // 团队审查 Important #4：dispatcher.js:811 原内联 !== 双重否定已改
    // !HARNESS_INFLIGHT_TASK_TYPES.includes(nextTask.task_type)，与上面 cap 计数
    // SQL 用同一个派生集合，钉住这处也绑对了。
    // 0923 秋米熔断豁免刀：这道闸又加了 openclaw-agent 表面的豁免
    // （qiumi_task 走 ssh 直派，不经 cecelia-bridge，所以不查 bridge 健康度），
    // 条件变成两个合取项，正则同步放宽到跨行匹配这两项。
    // 棒 3（executor=script）：script 表面同样是 ssh 直派跑场机，不经 bridge，加第三个合取项。
    // Commander独立核验使用research的限定payload标记；表面判定须传整份任务。
    expect(new Set(HARNESS_INFLIGHT_TASK_TYPES)).toEqual(new Set(['harness_initiative', 'golden_path_proposal']));
    expect(DISPATCHER_SRC).toMatch(
      /const needsBridgeCheck = !HARNESS_INFLIGHT_TASK_TYPES\.includes\(nextTask\.task_type\)\s*&&\s*!isOpenclawSurface\(nextTask\)\s*&&\s*!isScriptSurface\(nextTask\.task_type\);/
    );
  });
  it('绝不在 retired 集合（加了 = 派发即 terminal failed）', () => {
    // 同上，名单来自 RETIRED_HARNESS_TYPES_DISPATCH 派生集合。
    expect(RETIRED_HARNESS_TYPES_DISPATCH).not.toContain('golden_path_proposal');
  });
});

describe('GP提案尚未迁移，拒绝旧relay新运行',()=>{
 it.each([{}, {executor:'codex'}, {executor:'claude'}, {executor:'grok'}])('payload%j不取skill、工作区或凭据，不创建run/session',async payload=>{
  const effect=vi.fn();const result=await spawnSkillRelaySession({id:'old',task_type:'golden_path_proposal',payload:{orchestrator:'skill-relay',...payload}},{pool:{query:effect},spawnFn:effect,execFn:effect,loadSkill:effect,ensureWt:effect,tokenFn:effect});
  expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
 });
});
