# QA Control Plane

> 跨 Repo 质检管理的单一真相源

## 概述

Control Plane 是所有 Repos 的质检管理中心，提供：
- **单一真相源**：所有契约定义集中在这里
- **证据协议**：统一的 evidence 格式
- **执行分离**：Repos 只负责产出 evidence，Control Plane 定义规则

## 架构

```
cecelia-quality/
├── control-plane/              # Control Plane（全局配置）
│   ├── repo-registry.yaml     # Repos 注册表
│   ├── qa-policy.yaml         # 测试策略规则
│   └── schemas/
│       └── qa-evidence.schema.json  # Evidence 格式定义
│
├── contracts/                  # 各 Repo 的契约实例
│   ├── cecelia-workspace.regression-contract.yaml
│   ├── other-repo-1.regression-contract.yaml
│   └── ...
│
└── scripts/                    # 执行器脚本
    ├── qa-run-all.sh          # 完整质检执行器
    ├── qa-run-rci.sh          # RCI 执行器
    └── qa-run-gp.sh           # GP 执行器
```

## 核心文件

### 1. repo-registry.yaml

**作用**：注册所有参与质检的 Repos

**格式**：
```yaml
repos:
  - id: cecelia-workspace
    name: "Cecelia Workspace"
    type: Workspace
    path: /home/xx/dev/cecelia-workspace
    git_url: https://github.com/ZenithJoycloud/cecelia-workspace
    main_branch: develop
    owner: Core Team
    priority: P0
    enabled: true
    runners:
      qa: "npm run qa"
      rci: "bash scripts/qa-run-rci.sh"
      gp: "bash scripts/qa-run-gp.sh"
    evidence_path: ".qa-evidence.json"
```

### 2. qa-policy.yaml

**作用**：定义 commit 类型 → TestStrategy 的映射规则

**格式**：
```yaml
test_strategy_rules:
  fix:
    version_bump: patch
    required_tests: [L1]
    rci_priority: [P0, P1]
    trigger_gp: false

  feat:
    version_bump: minor
    required_tests: [L1, L2A]
    rci_priority: [P0, P1, P2]
    trigger_gp: true
```

### 3. schemas/qa-evidence.schema.json

**作用**：定义所有 Repos 产出的 evidence 统一格式

**用途**：
- 验证 evidence 格式正确性
- Core API 解析 evidence 的依据
- Dashboard 展示 evidence 的规范

## 契约实例（contracts/）

每个 Repo 有独立的 regression-contract 文件：

| 文件 | Repo |
|------|------|
| `cecelia-workspace.regression-contract.yaml` | cecelia-workspace |
| `other-repo-1.regression-contract.yaml` | other-repo-1 |

## 执行器脚本（scripts/）

### qa-run-all.sh

**完整质检执行器**，产出统一 evidence：

```bash
# 用法
bash scripts/qa-run-all.sh <scope> [commit_type] [branch]

# 示例
bash scripts/qa-run-all.sh pr feat cp-xxx

# 产出
.qa-evidence.json  # 符合 schemas/qa-evidence.schema.json
.qa-logs/run-*.log # 详细日志
```

### qa-run-rci.sh

**RCI 执行器**，根据 scope/priority 过滤执行：

```bash
# 用法
bash scripts/qa-run-rci.sh <scope> [priority]

# 示例
bash scripts/qa-run-rci.sh pr P0,P1

# 产出
.qa-rci-result.json
```

### qa-run-gp.sh

**Golden Path 执行器**，执行 E2E 测试：

```bash
# 用法
bash scripts/qa-run-gp.sh <scope>

# 示例
bash scripts/qa-run-gp.sh release

# 产出
.qa-gp-result.json
```

## 使用流程

### 1. 注册新 Repo

在 `repo-registry.yaml` 中添加：

```yaml
repos:
  - id: new-repo
    name: "New Repo"
    type: Business
    path: /home/xx/dev/new-repo
    git_url: https://github.com/org/new-repo
    main_branch: main
    owner: Team
    priority: P1
    enabled: true
    runners:
      qa: "npm run qa"
      rci: "bash scripts/qa-run-rci.sh"
      gp: "bash scripts/qa-run-gp.sh"
    evidence_path: ".qa-evidence.json"
```

### 2. 创建契约实例

复制 `contracts/cecelia-workspace.regression-contract.yaml` 为模板：

```bash
cp contracts/cecelia-workspace.regression-contract.yaml \
   contracts/new-repo.regression-contract.yaml
```

编辑并定义 RCI/GP。

### 3. 在 Repo 中使用

将执行器脚本复制到各 Repo（或使用符号链接）：

```bash
# 在 new-repo 中
ln -s /home/xx/dev/cecelia-quality/scripts/qa-run-all.sh scripts/
ln -s /home/xx/dev/cecelia-quality/scripts/qa-run-rci.sh scripts/
ln -s /home/xx/dev/cecelia-quality/scripts/qa-run-gp.sh scripts/
```

### 4. 执行质检

```bash
# 在 new-repo 中
bash scripts/qa-run-all.sh pr

# 查看 evidence
cat .qa-evidence.json
```

### 5. Core API 收集 evidence

Core API 通过以下方式收集 evidence：

1. **主动收集**（Pull）：
   ```bash
   # 读取 repo-registry.yaml
   # 遍历所有 repos
   # 读取各 repo 的 .qa-evidence.json
   ```

2. **被动接收**（Webhook）：
   ```bash
   # Repo 执行完质检后
   # POST evidence 到 Core API
   ```

## 与现有系统的关系

| 组件 | 位置 | 职责 |
|------|------|------|
| **/qa Skill** | `~/.claude/skills/qa/` | AI 决策规则（判断跑什么测试）|
| **Cecelia-Quality** | 本 repo | 契约定义 + 执行器 + Control Plane |
| **Business Repos** | cecelia-workspace 等 | 执行测试 + 产出 evidence |
| **Core API** | cecelia-workspace/apps/core | 收集 evidence + 提供 API |
| **Dashboard** | cecelia-workspace/apps/dashboard | 展示 evidence |

## 版本管理

- Control Plane 版本：`control-plane/VERSION`
- 契约版本：各 `contracts/*.yaml` 中的 `version` 字段
- Evidence Schema 版本：`schemas/qa-evidence.schema.json` 中的 `$schema`

## 下一步（Phase 1-4）

- **Phase 1**：Core API（/api/qa/execute, /api/qa/sync）
- **Phase 2**：Dashboard MVP（Repos 总览 / RCI 状态墙 / Run 执行中心）
- **Phase 3**：sync/query 扩展
- **Phase 4**：趋势分析
