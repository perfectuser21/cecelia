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

**runner 选择错误**：`runs-on: [self-hosted, Linux, hk-vps]` 将 job 放到了 HK VPS 自托管 runner，而该 runner 有约 5 分钟的排队等待时间 + 网络开销，导致整个 job 耗时 8 分钟（其中 5 分钟是排队等待）。

**注意（经验教训）**：最初以为 `npm ci --ignore-scripts` 也可以删除（认为 meta-tests 只用内置模块），但实际验证发现 `check-dod-mapping.cjs` 依赖 `js-yaml` 包，测试脚本会在启动时检查该依赖是否存在。因此 `npm ci` 步骤是**必须保留**的，只需迁移 runner。

### 修复方案

`runs-on` 改为 `ubuntu-latest` → GitHub 托管 runner，无排队，启动快，npm 缓存效率高。

预期效果：总耗时从 8 分钟降到 2-3 分钟（消除 5 分钟排队等待）。

### 下次预防

- [ ] 在创建新 CI job 时，优先考虑 `ubuntu-latest`，只有确实需要本地环境（数据库连接、特定工具链）时才用 `self-hosted`
- [ ] 对 HK VPS runner 的使用要保守：仅用于需要访问 Brain/PostgreSQL 的 job（如 dod-check 的 RCI 执行、brain-ci）
- [ ] L1 process gate 这类"轻量流程检查"job 应全部使用 `ubuntu-latest`，不应依赖自托管 runner
- [ ] **修改 CI 前先检查依赖**：在删除 `npm ci` 等步骤前，先验证测试脚本是否真的不需要 npm 包（可运行 `node -e "require('js-yaml')"` 测试）

### 影响范围

仅修改 CI `runs-on` 配置，无业务逻辑变更。Engine 版本 bump 到 12.89.0。
