---
id: learning-cp-03161434-fix-quality-meta-runner
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: quality-meta-tests job 错放 HK VPS 导致 CI 耗时 8 分钟

## 背景

`ci-l1-process.yml` 中的 `quality-meta-tests` job 原本耗时 8 分钟，远超预期。

### 根本原因

1. **runner 选择错误**：`runs-on: [self-hosted, Linux, hk-vps]` 将 job 放到了 HK VPS 自托管 runner，而该 runner 有排队等待时间（通常 5 分钟）+ 网络开销。
2. **不必要的依赖安装**：`npm ci --ignore-scripts` 安装了整个 engine 依赖包，但 `tests/quality-system/run-all.sh` 中的 meta-tests 全部只使用 Node.js 内置模块（`fs`、`path`、`child_process` 等），根本不需要 npm 依赖。

这两个问题叠加导致：5 分钟排队 + 1-2 分钟 npm ci + 1 分钟测试 = 8 分钟总耗时。

### 修复方案

1. `runs-on` 改为 `ubuntu-latest` → GitHub 托管 runner，无排队，启动快
2. 删除整个 "Install engine dependencies" step → 节省 1-2 分钟安装时间

预期效果：总耗时从 8 分钟降到 1-2 分钟。

### 下次预防

- [ ] 在创建新 CI job 时，优先考虑 `ubuntu-latest`，只有确实需要本地环境（数据库连接、特定工具链）时才用 `self-hosted`
- [ ] 在添加 `npm ci` 步骤前，先检查该 job 的脚本是否真的用了 npm 包；如果只用 Node.js 内置模块，不需要安装依赖
- [ ] 对 HK VPS runner 的使用要保保守：仅用于需要访问 Brain/PostgreSQL 的 job（如 dod-check 的 RCI 执行、brain-ci）
- [ ] L1 process gate 这类"轻量流程检查"job 应全部使用 `ubuntu-latest`，不应依赖自托管 runner

### 影响范围

仅修改 CI 配置，无业务逻辑变更。Engine 版本 bump 到 12.89.0。
