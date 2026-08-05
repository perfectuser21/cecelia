# brain 镜像 codex 版本漂移 + configError 分类修复设计

日期：2026-08-05
Brain task：caf46de6-a50a-4f1b-867c-d04177ed9027
决策：e9cf7877（bug-fix）

## 问题（生产容器已实测复现）

1. `packages/brain/Dockerfile:38` 硬钉 `@openai/codex@0.116.0`，宿主 brew codex 已升 0.146.0。团队 config（容器只读挂载 `~/.codex-team1`）由新版维护：旧 CLI 读新 config 键 `default_permissions` 启动即死（`Error: default_permissions requires a [permissions] table`）；config 钉的 `gpt-5.6-sol` 被 API 400 拒（`requires a newer version of Codex`）。
2. `triggerCodexReview()`（executor.js:2415-2528）spawn 后 exit≠0 一律 POST `execution-callback` status='AI Failed' → 任务 failed → `handleTaskFailure` failure_count++ → quarantine + thalamus retry 死循环。**环境级错误被烧成任务失败**。stderr 虽 pipe 但无人读（2470/2477 行），错误原文进不了任何分类。
3. 容器 FS 只读（EROFS 实测），在线升级不可能，唯一出口 = 镜像重建。

对齐的既有语义（dispatcher.js 798-866 行，pre-spawn `configError:true` 先例）：回 queued + 释放 claim + 不计熔断 + 不 autoblock。弱点：无告警、无重试上限——本次一并补强。

## 修法（方案 B，Research Subagent 已核）

### 1. Dockerfile bump

`packages/brain/Dockerfile:38`：`@openai/codex@0.116.0` → `@openai/codex@0.146.0`。注释补一行本次事故：版本必须与宿主 codex / 团队 config 兼容（config 由宿主新版维护，旧 CLI 读不动会启动即死）。
CI 的 `docker-infra-smoke` job（ci.yml 93-96 行）会真 build 验证装得上；preflight 测试对 Dockerfile 的断言不含版本号，不会误红。

### 2. 新建 `packages/brain/src/lib/codex-fatal-patterns.js`（SSOT）

```js
export const CODEX_FATAL_PATTERNS = [
  { pattern: /requires a newer version of Codex/i, reason: 'codex_version_too_old' },
  { pattern: /default_permissions requires a `?\[permissions\]`? table/i, reason: 'codex_config_incompatible' },
  { pattern: /error(?::| in) .*config\.toml/i, reason: 'codex_config_parse_error' },
  { pattern: /Not inside a trusted directory/i, reason: 'codex_untrusted_cwd' },
];
export function classifyCodexFailure(stdout, stderr) { /* 命中返回 {configError:true, reason}，否则 null */ }
```

分类只看错误特征，不看 exit code（调用方已保证 exit≠0 才调）。stdout 与 stderr 都要扫（codex 版本 400 错误走 stdout 的 ERROR JSON 行，config 解析错走 stderr——生产实测两种都有）。

### 3. `executor.js triggerCodexReview()` exit handler 改造

- spawn 后新增 stderr 收集（对齐 stdout 写法）。
- exit handler：`code !== 0` 时先 `classifyCodexFailure(stdout, stderr)`：
  - **命中** → 不 POST callback（双通道 callback_queue 根本不产生记录，两条链天然堵死）。改为：
    1. `payload.codex_config_error_count` +1（读当前值）；
    2. count < 3 → `UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL, payload=… WHERE id=$1 AND status IN ('in_progress','dispatched')`（状态守卫防迟到竞态），同步清 `payload.run_status`（对齐 quarantine.js skipCount requeue 写法，防 watchdog 悬挂误判）；`raise('P1','codex_config_error', <含 reason+stderr 摘要>, {debounce})`；
    3. count ≥ 3 → `status='blocked'` + `raise('P0','codex_config_error', …)`（防"派发→秒挂→回队"快速空转烧 review 池槽位）；
  - **未命中** → 维持现状（AI Failed callback，真任务失败照旧走 quarantine/thalamus）。
- `raise` 从 `./alerting.js` import（签名 `raise(level, eventType, message, opts)`，P1 每小时汇总推飞书）。

### 4. 部署与真机验证（merge 后）

`bash scripts/brain-deploy.sh`（内部从 origin/main git archive 干净 build + migrations + 蓝绿切换）。验证：容器 `codex --version`=0.146.0；把现存 queued 的 arch_review 任务派发跑通（不再秒挂 AI Failed）。

## 测试策略

- **unit（本次核心，vitest，`cd packages/brain && npm test`）**：
  - `codex-fatal-patterns.test.js`：行为测试。真实生产错误样本三条（原文断言命中 + reason 正确）：`Error: default_permissions requires a [permissions] table`、`ERROR: {"type":"error","status":400,...requires a newer version of Codex...}`、`Not inside a trusted directory and --skip-git-repo-check was not specified.`；反例不误伤：普通 verdict FAIL stdout、lint 报错文本、空串 → 返回 null。
  - `executor-codex-configerror.test.js`：沿用 preflight.test.js 的静态源码断言风格，锁定 executor.js：收集 stderr、exit handler 调 classifyCodexFailure、命中分支不 fetch execution-callback、UPDATE 带 `status IN ('in_progress','dispatched')` 守卫、raise('P1'/'P0','codex_config_error')、requeue 上限 3。
  - commit-1 对旧实现必须红（分类器模块不存在 + 静态断言全 miss），proven-to-fire。
- **integration（部署后人工，不进 CI）**：真机重建容器后派发真实 arch_review 验证收尾。
- **E2E**：不适用。

## 守卫种类判定

- 逻辑接缝（分类器）：CI unit test。
- 环境接缝（codex CLI×config 兼容性）：**configError 路径本身就是运行时自检**——环境坏 → P1/P0 响亮告警 + 任务不烧，替代此前的静默死循环。CI 的 docker-infra-smoke 同时守住"该版本装得上"。

## 不做

- 不改 dispatcher pre-spawn configError 逻辑（语义已对，只是无告警，本次 post-spawn 路径带告警即可覆盖同类发现）
- 不动 quarantine/thalamus/retry-policy 本体
- 不给 routes/execution.js、callback-processor.js 加 config_error 识别（方案 A 已否决：三处贯通成本高、漏一处即假修复）
- 宿主 codex 升级策略/自动同步机制（后续另立）

## commit 顺序（TDD 铁律）

1. commit-1 `fix(brain): codex 环境级致命错误分类守卫测试（红）`
2. commit-2 `fix(brain): Dockerfile bump codex 0.146.0 + triggerCodexReview configError 安全回队（绿）`
