# PRD: H7 entrypoint.sh tee stdout 到 STDOUT_FILE

**Brain task**: 4965a3ef-108b-4f36-8b42-114f531ede99
**Spec**: docs/superpowers/specs/2026-05-09-h7-entrypoint-stdout-tee-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1

## 背景

Layer 3 spawn-and-interrupt（PR #2845, 2026-04-28）把 harness 容器从 `exec claude` 改成"先跑 claude → 拿 exit_code → POST callback → 退出"。

但 `docker/cecelia-runner/entrypoint.sh:107-113` `run_claude()` 直接让 claude stdout 打到 terminal：detached docker spawn 后无人 attach，stdout 全部丢失。第 132 行读 `STDOUT_FILE` 永远空 → callback body 永远 `{"stdout":""}`。

后果：brain 看不到 generator/proposer 容器实际产出（PR URL/commit hash），W8 acceptance 5 次跑全部漏过 contract verification。

## 修法

`run_claude()` 给 claude 调用加 `tee "$STDOUT_FILE"`。把 `STDOUT_FILE=...` 上提到 `run_claude()` 之前（原 132 行删掉）。

## 成功标准

- callback body `stdout` 字段不再恒为 ""
- claude 真实 exit code 被保留（不被 tee 0 覆盖）
- 非 harness 任务的 exec 路径完全不变

## 不做

- 不动 callback body 拼装逻辑（132-145 行）
- 不动非 harness 任务 exec 路径（117-123 行）
- 不引入 stdout 流式上传
- 不做 H8/H9/proposer verify push（独立 PR）
