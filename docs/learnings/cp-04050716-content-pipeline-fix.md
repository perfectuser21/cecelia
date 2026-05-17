# Learning: content-pipeline 全链路失效根因分析与修复

**Branch**: cp-04050716-448791a8-7c53-4f54-9c13-d96548  
**Date**: 2026-04-05

### 根本原因

content-pipeline 失效由三个独立缺陷叠加造成：

1. **tick.js 排除列表遗漏父任务**：子阶段任务 6 种类型都在 NOT IN 排除列表，但 `content-pipeline`（父任务）缺失。父任务被 tick 调度到西安 codex-bin，codex-bin v0.118.0 无法连接 chatgpt.com/backend-api/codex/models，所有父任务立即以 `exit_code_1` 失败被隔离。

2. **executor.js liveness probe 误杀子阶段任务**：liveness probe 排除逻辑只包含 `content-pipeline` 父任务，未包含 6 个子阶段类型（content-research、content-copywriting 等）。子阶段任务在 Brain 进程内执行（无 OS 进程），liveness probe 误判为死亡 → 2 次 probe 失败后 quarantine。

3. **thalamus LLM 走 bridge 而非直接 API**：FALLBACK_PROFILE 的 thalamus 配置 `provider: 'anthropic'` 路由到 `callClaudeViaBridge()` → `localhost:3457/llm-call` → 生成 `claude -p` 子进程。bridge 的 `claude -p` 以 exit code 1 失败（<1s），`callLLM` 静默降级到静态模板，copywriting/copy-review/generate 全产出空内容。

### 下次预防

- [ ] 新增 content-* 任务类型时，同步检查三个地方：(1) `tick.js` NOT IN 排除列表，(2) `executor.js` liveness probe 排除集合，(3) 是否需要 in-process 执行而非外部 bridge 派发
- [ ] model-profile FALLBACK_PROFILE 的 provider 设置优先用 `anthropic-api`（直接 REST），除非有明确理由用 bridge（`anthropic`）。bridge 依赖本地 `claude -p` CLI 稳定性，不适合作为 fallback
- [ ] 当 KR 进度长期停滞（< 5%）时，优先检查任务是否批量 quarantine，以及 quarantine reason 是否揭示系统级缺陷（而非单次业务失败）
