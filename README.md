# Cecelia

AI Virtual Butler System - 24/7 自主运行的管家系统。

## 架构

```
packages/brain      → Brain 后端（调度/决策/保护，端口 5221）
packages/engine     → 开发工作流引擎（hooks/skills/DevGate）
packages/quality    → QA 基础设施
packages/workflows  → Agent 协议 + N8N 配置
apps/api            → 前端 API 层
apps/dashboard      → React UI（端口 5211）
```

## 开发

```bash
# Brain
cd packages/brain && npm ci && npm test

# Dashboard
cd apps/dashboard && npm ci && npm run dev
```

## 部署

```bash
bash scripts/brain-build.sh    # 构建 Brain Docker 镜像
bash scripts/rolling-update.sh # 零停机部署
```
