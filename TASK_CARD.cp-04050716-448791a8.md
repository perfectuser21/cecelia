# Task Card: fix(brain): 修复内容生成 + 自动发布链路失效

**Task ID**: 448791a8-7c53-4f54-9c13-d96548973fb5  
**Branch**: cp-04050716-448791a8-7c53-4f54-9c13-d96548

## 问题

内容生成 KR 进度 1%，自动发布 KR 进度 1%。

诊断发现 4 个根因：

### 根因 1：content-pipeline 父任务被派到西安 codex-bin，立即失败
`tick.js` L718 的 NOT IN 排除列表包含 6 个子阶段任务类型，但遗漏了 `content-pipeline`（父任务）。
导致父任务被 `triggerCodexBridge()` 发到西安，西安的 `codex-bin` v0.118.0 无法连接 `chatgpt.com/backend-api/codex/models` → 返回 `exit_code_1` → 任务被隔离。

### 根因 2：content-* 子阶段任务被 liveness probe 杀死
content-* 阶段任务（content-research/copywriting/copy-review/generate/image-review）是 in-Brain 进程内执行，没有 OS 进程。
`executor.js` L3011 的 liveness probe 排除只包含 `content-pipeline` 父任务，不包含 6 个子阶段类型。
导致子阶段任务在 liveness probe 中被误判为死亡 → 2 次后 quarantine。

### 根因 3：thalamus 走 bridge (provider: 'anthropic') 但 bridge 不可靠
`model-profile.js` FALLBACK_PROFILE.config.thalamus.provider 为 `'anthropic'`，
callLLM 路由到 `callClaudeViaBridge()` → POST localhost:3457/llm-call → 
bridge 的 `claude -p` 以 exit code 1 失败（786ms），LLM 调用静默降级到静态模板。
content pipeline 的 copywriting/copy-review/generate 全部产出空模板内容。

### 根因 4（复合）：上述失败叠加导致 OKR 进度停滞
每个 pipeline 都在前三步失败，没有任何内容抵达 export，KR 进度不增。

## 修复方案

**Fix 1**: `tick.js` L718 — 将 `'content-pipeline'` 加入 NOT IN 排除列表
**Fix 2**: `executor.js` L3011 — 将 6 个 content-* 子阶段类型加入 liveness probe 排除
**Fix 3**: `model-profile.js` FALLBACK_PROFILE.config.thalamus — provider 从 `'anthropic'` 改为 `'anthropic-api'`
**Fix 4**: DB migration — 将 profile-anthropic 记录的 thalamus 配置也更新为 `anthropic-api`

## 文件
- `packages/brain/src/tick.js`
- `packages/brain/src/executor.js`
- `packages/brain/src/model-profile.js`
- `packages/brain/migrations/` (新增 migration)
