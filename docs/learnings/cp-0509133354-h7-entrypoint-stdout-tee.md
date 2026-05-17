# Learning: H7 — entrypoint.sh tee stdout 到 STDOUT_FILE

**PR**: cp-0509133354-h7-entrypoint-stdout-tee
**Sprint**: langgraph-contract-enforcement / Stage 1

## 现象

W8 harness acceptance 5 次连跑（v6 → v10）全部 fail，brain 看不到 sub_task 容器的 claude stdout，callback body 永远 `{"stdout":""}` → 漏过 contract verification（PR URL / commit hash 全丢）。

## 根本原因

PR #2845 重构 Layer 3 spawn-and-interrupt 时，把 entrypoint.sh 从 `exec claude`（前台）改成"先跑 claude → 拿 exit_code → POST callback → 退出"。但 `run_claude()` 让 claude stdout 直接打到 terminal（detached docker spawn 后无人 attach），第 132 行 `STDOUT_FILE` 仍按旧设计期望从该文件读 stdout，**没人写它**。

哲学层根因：detached docker container 模式下，所有副作用（stdout/stderr/文件写入）必须显式持久化，不能依赖 attach。这是 LangGraph node-level contract verification 的子集 —— 节点执行结束必须把"产出"主动写到 brain 可读的位置，否则 brain 拿到空数据等同节点 silent fail。

## 下次预防

- [ ] 任何 detached docker spawn 模式下的脚本，子进程 stdout 必须显式 `tee` 或重定向到 brain 已知的文件路径
- [ ] PR review 时凡涉及 docker spawn 模式切换（attach ↔ detach），必须 grep 所有 `claude` / `npm` / `node` 等长跑命令是否有 stdout 持久化
- [ ] Layer 3 后续节点设计：每个 LLM 节点结束必须 brain-side verify 副作用真发生（spec 阶段 2 的 contract enforcement layer）
