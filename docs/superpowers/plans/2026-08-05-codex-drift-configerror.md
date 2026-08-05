# codex 版本漂移 + configError 分类修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** brain 镜像 codex bump 到 0.146.0，并让 `triggerCodexReview()` 把环境级致命错误（config/版本/trust）安全回队 + 响亮告警，不再烧任务进 quarantine 死循环。

**Architecture:** 新建纯函数分类器 `lib/codex-fatal-patterns.js`（SSOT）；executor exit handler 收集 stderr、命中致命模式时不发 AI Failed callback（双通道天然堵死），直接带状态守卫 UPDATE 回 queued（上限 3 次后转 blocked+P0）。对齐 dispatcher pre-spawn `configError:true` 既有语义（回队+不计熔断），补上其缺失的告警。

**Tech Stack:** Node ESM、vitest（`cd packages/brain && npm test`）、Docker。

## Global Constraints

- 工作目录：`/Users/administrator/worktrees/cecelia/codex-drift-configerror`（分支 `cp-0805095118-codex-drift-configerror`）
- TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；commit-1 = 红测试，commit-2 = 实现转绿
- 不改 dispatcher.js / routes/execution.js / callback-processor.js / quarantine.js 本体
- 所有注释/输出简体中文；ESM（import/export，与 lib/review-task-types.js 同风格）
- 告警统一 `import { raise } from './alerting.js'`，事件类型 `codex_config_error`
- commit message 结尾加：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 守卫测试（红）

**Files:**
- Create: `packages/brain/src/__tests__/codex-fatal-patterns.test.js`
- Create: `packages/brain/src/__tests__/executor-codex-configerror.test.js`

**Interfaces:**
- Produces: 对 Task 2 的约束——`lib/codex-fatal-patterns.js` 导出 `CODEX_FATAL_PATTERNS` 与 `classifyCodexFailure(stdout, stderr)`（命中返回 `{configError:true, reason}`，未命中返回 `null`）；executor.js 必须含 stderr 收集、分类调用、守卫 UPDATE、raise、回队上限

- [ ] **Step 1: 写分类器行为测试**

创建 `packages/brain/src/__tests__/codex-fatal-patterns.test.js`：

```js
import { describe, it, expect } from 'vitest';
import { classifyCodexFailure, CODEX_FATAL_PATTERNS } from '../lib/codex-fatal-patterns.js';

// 三条正样本均为 2026-08-05 生产容器实测原文（codex 0.116.0 × 宿主 0.146.0 维护的 config）
describe('classifyCodexFailure — 环境级致命错误命中', () => {
  it('旧 CLI 读新 config 键：启动即死（stderr）', () => {
    const stderr = 'Error: default_permissions requires a `[permissions]` table';
    const r = classifyCodexFailure('', stderr);
    expect(r).toEqual({ configError: true, reason: 'codex_config_incompatible' });
  });

  it('模型-版本不匹配：API 400（stdout ERROR JSON 行）', () => {
    const stdout = 'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.6-sol\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}';
    const r = classifyCodexFailure(stdout, '');
    expect(r).toEqual({ configError: true, reason: 'codex_version_too_old' });
  });

  it('cwd 不受信任（stderr）', () => {
    const stderr = 'Not inside a trusted directory and --skip-git-repo-check was not specified.';
    const r = classifyCodexFailure('', stderr);
    expect(r).toEqual({ configError: true, reason: 'codex_untrusted_cwd' });
  });
});

describe('classifyCodexFailure — 真任务失败不误伤', () => {
  it('正常 verdict FAIL 的 stdout 不命中', () => {
    expect(classifyCodexFailure('{"verdict":"FAIL","summary":"代码存在空指针风险"}', '')).toBeNull();
  });

  it('普通 lint/构建报错不命中', () => {
    expect(classifyCodexFailure('', "error TS2304: Cannot find name 'foo'.\nnpm error Lifecycle script failed")).toBeNull();
  });

  it('空输入不命中', () => {
    expect(classifyCodexFailure('', '')).toBeNull();
    expect(classifyCodexFailure(undefined, undefined)).toBeNull();
  });
});

describe('CODEX_FATAL_PATTERNS 结构', () => {
  it('每条含 pattern(RegExp) 与 reason(string)', () => {
    expect(CODEX_FATAL_PATTERNS.length).toBeGreaterThanOrEqual(3);
    for (const p of CODEX_FATAL_PATTERNS) {
      expect(p.pattern).toBeInstanceOf(RegExp);
      expect(typeof p.reason).toBe('string');
    }
  });
});
```

- [ ] **Step 2: 写 executor 接线静态断言测试**

创建 `packages/brain/src/__tests__/executor-codex-configerror.test.js`（沿用 executor-codex-review-preflight.test.js 的 readFileSync 静态断言风格）：

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(path.join(__dirname, '..', 'executor.js'), 'utf8');

// 守卫：codex 环境级致命错误必须走 configError 安全回队，不得烧任务（决策 e9cf7877）
describe('triggerCodexReview configError 接线', () => {
  it('收集 stderr（旧实现只收 stdout，环境错误原文进不了分类）', () => {
    expect(executorSrc).toMatch(/child\.stderr\?\.on\('data'/);
  });

  it('exit handler 调用 classifyCodexFailure 分类', () => {
    expect(executorSrc).toMatch(/classifyCodexFailure\(/);
    expect(executorSrc).toMatch(/from '\.\/lib\/codex-fatal-patterns\.js'/);
  });

  it('命中时带状态守卫回队（防迟到竞态）', () => {
    expect(executorSrc).toMatch(/status IN \('in_progress','dispatched'\)/);
  });

  it('回队计数上限（防快速空转风暴）', () => {
    expect(executorSrc).toMatch(/codex_config_error_count/);
  });

  it('响亮告警 codex_config_error（P1 回队 / P0 封顶）', () => {
    expect(executorSrc).toMatch(/raise\('P1',\s*'codex_config_error'/);
    expect(executorSrc).toMatch(/raise\('P0',\s*'codex_config_error'/);
  });
});
```

- [ ] **Step 3: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/codex-fatal-patterns.test.js src/__tests__/executor-codex-configerror.test.js`
Expected: 分类器测试全 FAIL（模块不存在，import 报错）；executor 静态断言 5 条全 FAIL。**必须亲眼看到红**，把输出记进报告。

- [ ] **Step 4: Commit（commit-1，红）**

```bash
git add packages/brain/src/__tests__/codex-fatal-patterns.test.js packages/brain/src/__tests__/executor-codex-configerror.test.js
git commit -m "fix(brain): codex 环境级致命错误分类守卫测试（红）"
```

---

### Task 2: 实现（绿）+ Dockerfile bump

**Files:**
- Create: `packages/brain/src/lib/codex-fatal-patterns.js`
- Modify: `packages/brain/src/executor.js`（triggerCodexReview，约 2415-2528 行）
- Modify: `packages/brain/Dockerfile`（第 38 行）

**Interfaces:**
- Consumes: Task 1 两个测试文件（必须转绿，且不许改测试）
- Produces: `classifyCodexFailure(stdout, stderr)` → `{configError:true, reason}` | `null`

- [ ] **Step 1: 新建分类器**

创建 `packages/brain/src/lib/codex-fatal-patterns.js`：

```js
/**
 * CODEX_FATAL_PATTERNS — codex CLI 环境级致命错误特征（SSOT）。
 *
 * 这些错误与任务内容无关（config 不兼容 / CLI 版本过旧 / cwd 不受信任），
 * 不应计入任务失败或触发 quarantine——应安全回队 + 响亮告警（决策 e9cf7877）。
 * 事故背景：镜像 codex 0.116.0 读宿主 0.146.0 维护的 config 启动即死，
 * arch_review 全量被烧进 quarantine 死循环（2026-08-05）。
 */
export const CODEX_FATAL_PATTERNS = [
  { pattern: /requires a newer version of Codex/i, reason: 'codex_version_too_old' },
  { pattern: /default_permissions requires a `?\[permissions\]`? table/i, reason: 'codex_config_incompatible' },
  { pattern: /error(?::| in) [^\n]*config\.toml/i, reason: 'codex_config_parse_error' },
  { pattern: /Not inside a trusted directory/i, reason: 'codex_untrusted_cwd' },
];

/**
 * 分类 codex 非零退出的输出。命中环境级致命错误返回 { configError, reason }，否则 null。
 * stdout 与 stderr 都扫：版本 400 错误走 stdout 的 ERROR JSON 行，config 解析错走 stderr（均生产实测）。
 */
export function classifyCodexFailure(stdout, stderr) {
  const text = `${stderr || ''}\n${stdout || ''}`;
  for (const { pattern, reason } of CODEX_FATAL_PATTERNS) {
    if (pattern.test(text)) return { configError: true, reason };
  }
  return null;
}
```

- [ ] **Step 2: 改 executor.js**

a) 文件顶部 import 区补（若 raise 尚未 import）：
```js
import { classifyCodexFailure } from './lib/codex-fatal-patterns.js';
```
`raise` 按文件既有 import 风格从 `./alerting.js` 引入（先确认是否已 import，勿重复）。

b) `triggerCodexReview` 内，stdout 收集行之后加 stderr 收集：
```js
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
```

c) `child.on('exit', ...)` handler：在 `console.log(\`[executor] codex review exit code=...\`)` 之后、现有 callback 逻辑之前插入：

```js
      // 环境级致命错误（config 不兼容/CLI 版本过旧/trust 拒绝）→ 不发 AI Failed callback
      // （callback_queue 无记录，inline 与 worker 两条链都不会烧任务），安全回队 + 响亮告警。
      // 对齐 dispatcher pre-spawn configError 语义（回队+不计熔断），补上告警与回队上限。
      const fatal = code === 0 ? null : classifyCodexFailure(stdout, stderr);
      if (fatal) {
        try {
          const summary = (stderr || stdout).slice(-300).replace(/\s+/g, ' ').trim();
          const countRes = await pool.query(
            `SELECT COALESCE((payload->>'codex_config_error_count')::int, 0) AS n FROM tasks WHERE id = $1`,
            [task.id]
          );
          const n = (countRes.rows[0]?.n ?? 0) + 1;
          if (n < 3) {
            await pool.query(
              `UPDATE tasks
                 SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
                     payload = (COALESCE(payload, '{}'::jsonb) - 'run_status')
                               || jsonb_build_object('codex_config_error_count', $2::int),
                     updated_at = NOW()
               WHERE id = $1 AND status IN ('in_progress','dispatched')`,
              [task.id, n]
            );
            raise('P1', 'codex_config_error', `codex 环境错误(${fatal.reason})，任务安全回队(${n}/3)：task=${task.id} ${summary}`);
          } else {
            await pool.query(
              `UPDATE tasks
                 SET status = 'blocked', claimed_by = NULL, claimed_at = NULL,
                     payload = (COALESCE(payload, '{}'::jsonb) - 'run_status')
                               || jsonb_build_object('codex_config_error_count', $2::int),
                     updated_at = NOW()
               WHERE id = $1 AND status IN ('in_progress','dispatched')`,
              [task.id, n]
            );
            raise('P0', 'codex_config_error', `codex 环境错误连续${n}次(${fatal.reason})，任务已 blocked 待人工：task=${task.id} ${summary}`);
          }
          console.error(`[executor] codex configError: reason=${fatal.reason} task=${task.id} count=${n}`);
        } catch (cfgErr) {
          console.error(`[executor] codex configError 处理自身失败: ${cfgErr.message} task=${task.id}`);
        }
        return;
      }
```

实现前必须核对：
- `pool` 在 executor.js 模块作用域的实际标识符（约 2390 行 updateTaskRunInfo 附近有用例，照抄）；
- `raise` 的实际签名（alerting.js 47 行）——若支持 debounce opts 可给 P1 加，不支持就不加，**不要发明参数**；
- `payload - 'run_status'` 的键名与 quarantine.js skipCount requeue 的既有写法核对，键名不同则照 quarantine.js 的为准。

d) 保持命中分支之外的现有逻辑一字不动（未命中 → 原 callback 路径）。

- [ ] **Step 3: Dockerfile bump**

`packages/brain/Dockerfile` 第 38 行改为：

```dockerfile
# 2026-08-05 事故：0.116.0 读宿主 0.146.0 维护的团队 config（default_permissions 新键）启动即死，
# arch_review 全量秒挂。codex 版本必须与宿主 brew codex / ~/.codex-team* config 保持兼容。
RUN npm install -g @openai/codex@0.146.0
```

- [ ] **Step 4: 跑新测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/codex-fatal-patterns.test.js src/__tests__/executor-codex-configerror.test.js`
Expected: 全 PASS。

- [ ] **Step 5: 跑既有相关测试确认不破坏**

Run: `cd packages/brain && npx vitest run src/__tests__/executor-codex-review-preflight.test.js src/__tests__/executor-codex-review.test.js`
Expected: 全 PASS（preflight 对 Dockerfile 的断言不含版本号）。

- [ ] **Step 6: Commit（commit-2，绿）**

```bash
git add packages/brain/src/lib/codex-fatal-patterns.js packages/brain/src/executor.js packages/brain/Dockerfile
git commit -m "fix(brain): Dockerfile bump codex 0.146.0 + triggerCodexReview configError 安全回队（绿）"
```
