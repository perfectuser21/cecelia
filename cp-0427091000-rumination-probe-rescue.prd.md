# PRD: PROBE_FAIL_RUMINATION 根因可见化 + last_run 真实化

## 背景

`/api/brain/capability-probe` 中 `rumination` 探针 100% 失败率（生产 P0），detail 形如：

```
48h_count=0 last_run=never undigested=N recent_outputs=0 heartbeats_24h=? (loop_dead|degraded_llm_failure)
```

两个问题：

1. **`degraded_llm_failure` 不带根因** —— LLM 实际失败原因（NotebookLM bridge 超时/认证 vs callLLM 余额不足/ENOENT）只在 brain 容器日志里。运维必须 ssh + grep + 翻 cecelia_events，MTTR 拉长。
2. **`last_run=never` 误导** —— 当前 `last_run` 取自"48h 窗口内 max(created_at)"，48h 没数据就显示 `never`，丢失"上次成功是何时"这个关键诊断信息。

更糟糕的是 `dispatchAutoFixes` 把 `f.detail` 直接喂给 dev skill — detail 里没根因，自动修复任务在错方向上反复打转，触发批次/连续失败回滚阈值后把好版本回滚掉，问题反而恶化。

## 目标

把 LLM 失败根因写入结构化事件（`rumination_llm_failure`）+ probe 直接读取该事件并透出 detail。`last_run` 改用全局 max（不限 48h），仅在表全空时显示 `never`。

## 范围

### 一、`rumination.js` `digestLearnings`：双路 LLM 全失败时写 forensic 事件
- 在 NotebookLM 和 callLLM 各自的 try/catch 里捕获 `notebookFailureReason` / `llmFailureReason`
- 双路都失败（`!insight`）时写 `cecelia_events('rumination_llm_failure', ...)`，payload 含 `notebook_error` / `llm_error` / `batch_size` / `learning_ids`
- 事件写入失败 non-blocking（warn log）

### 二、`capability-probe.js` `probeRumination`：last_run 真实化 + LLM 错因透出
- 拆分 `last_run` 查询：48h count 单独一条 SQL，全局 `max(created_at)` 单独一条 SQL（不带 INTERVAL）
- `degraded_llm_failure` 时查 `cecelia_events` 里最近一条 `rumination_llm_failure`，把 `notebook=...` `llm=...` 摘要追加到 detail 末尾（每段截 60 字符）
- 事件查询失败 non-blocking（warn log）

### 三、单测覆盖（grep 静态测试）
- `last_run` 查询不含 INTERVAL 过滤
- detail 含 `last_llm_failure` / `notebook=` / `llm=`
- probe 内查 `event_type = 'rumination_llm_failure'`

## 验收

PROBE_FAIL_RUMINATION 触发时，detail 里直接看到 LLM 失败原因，运维不再需要 grep 容器日志。
