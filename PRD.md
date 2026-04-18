# PRD: LangGraph 路径注入凭据

## 背景
PR #2395 合并后 LangGraph 接通 Docker 开始运转，但每个子节点容器 exit 1 in ~700ms。根因：`runHarnessPipeline()` 没传 `env`，Docker 容器拿不到 `CECELIA_CREDENTIALS`，claude CLI 无 API key → 退出。

## 成功标准
- LangGraph 节点能用 account1 凭据在 Docker 容器内跑 Claude Code
- spending-cap 或 auth-failed 时不传凭据（保持和旧路径行为对齐）
