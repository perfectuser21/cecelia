# Cecelia Quality Platform - 开发指南

> 企业级质量保障基础设施 - 为 AI 驱动的开发工作流提供质量控制

---

## 项目定位

**Cecelia Quality** 是从 zenithjoy-engine 中提取的通用质量保障系统，包含：

1. **Gateway 系统** - 统一输入网关（v1.1.0+）
2. **Control Plane** - 中心化配置管理
3. **Hooks 系统** - Git 工作流拦截
4. **DevGate 框架** - 质量门控检查
5. **Skills** - QA/Audit/Assurance 专业能力

---

## 架构概览

```
┌─────────────────────────────────────────────────┐
│              Cecelia Quality                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  Gateway System (v1.1.0)                        │
│  ├── gateway/    - 统一入口                     │
│  ├── queue/      - 任务队列                     │
│  ├── worker/     - 工作器                       │
│  ├── state/      - 状态追踪                     │
│  └── heartbeat/  - 自主监控                     │
│                                                 │
│  Control Plane                                  │
│  ├── repo-registry.yaml    - 仓库注册表         │
│  ├── qa-policy.yaml        - 测试策略           │
│  └── schemas/              - 数据格式           │
│                                                 │
│  Hooks & Gates                                  │
│  ├── hooks/                - Git 工作流拦截     │
│  └── scripts/devgate/      - 质量门控检查       │
│                                                 │
│  Skills                                         │
│  ├── /qa       - QA 总控                        │
│  ├── /audit    - 代码审计                       │
│  └── /assurance - RADNA 4 层系统                │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Gateway 系统使用指南

### 快速开始

**入队任务**：
```bash
# CLI 模式（推荐）
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-workspace"}'

# JSON 模式
echo '{"taskId":"uuid","source":"n8n","intent":"fixBug","priority":"P1","payload":{}}' | bash gateway/gateway.sh enqueue
```

**查看队列**：
```bash
bash gateway/gateway.sh status
```

**执行任务**：
```bash
bash worker/worker.sh
```

**健康检查**：
```bash
bash heartbeat/heartbeat.sh
```

### 任务格式

```json
{
  "taskId": "uuid",
  "source": "cloudcode|notion|n8n|webhook|heartbeat",
  "intent": "runQA|fixBug|refactor|review|summarize|optimizeSelf",
  "priority": "P0|P1|P2",
  "payload": {
    "project": "string",
    "branch": "string",
    "scope": "string"
  },
  "createdAt": "2026-01-27T14:00:00Z"
}
```

### 优先级规则

| 优先级 | 场景 | 响应时间 |
|--------|------|----------|
| **P0** | 核心功能失败、安全问题 | 立即处理 |
| **P1** | 重要功能、已知 bug | 尽快处理 |
| **P2** | 一般改进、优化 | 正常排队 |

### Worker Intent 路由

| Intent | 执行器 | 说明 |
|--------|--------|------|
| `runQA` | Orchestrator | 执行质量检查 |
| `fixBug` | CloudCode 无头 | 修复 bug |
| `refactor` | CloudCode 无头 | 重构代码 |
| `review` | Review System | 代码审查 |
| `summarize` | Summarizer | 生成摘要 |
| `optimizeSelf` | Self-Optimizer | 系统自优化 |

---

## Control Plane 配置

### repo-registry.yaml

注册需要质量管理的仓库：

```yaml
repositories:
  - id: cecelia-workspace
    name: Cecelia Workspace
    path: /path/to/cecelia-workspace
    type: monorepo
    qa_scripts:
      - scripts/qa-run-all.sh
      - scripts/qa-run-rci.sh
      - scripts/qa-run-gp.sh
```

### qa-policy.yaml

定义测试策略规则：

```yaml
policies:
  - commit_type: feat
    scope: core
    priority: P0
    required_tests:
      - regression: full
      - unit: all
      - e2e: golden_paths
```

---

## Hooks 系统

### 已安装的 Hooks

| Hook | 文件 | 触发时机 | 作用 |
|------|------|----------|------|
| **Branch Protect** | `hooks/branch-protect.sh` | commit 前 | 阻止在 main/develop 直接提交 |
| **PR Gate** | `hooks/pr-gate-v2.sh` | PR 创建前 | 质量检查（L1 + L2A） |
| **Stop Hook** | `hooks/stop.sh` | 会话结束时 | 强制质检完成 |
| **Session Start** | `hooks/session-start.sh` | 会话开始时 | 初始化环境 |
| **Session End** | `hooks/session-end.sh` | 会话结束时 | 清理和总结 |

### Hook 安装

```bash
# 安装到本项目
bash scripts/install-hooks.sh

# 全局安装（推荐）
bash scripts/install.sh
```

### PR Gate 检查项

**PR 模式（L1 + L2A）**：
- ✅ .prd.md 存在且有效
- ✅ .dod.md 存在且全勾
- ✅ docs/QA-DECISION.md 存在
- ✅ docs/AUDIT-REPORT.md 存在且 PASS
- ✅ DoD ↔ Test 映射完整
- ✅ L1 自动化测试通过（typecheck + test + build）
- ✅ L2B 证据文件存在（.layer2-evidence.md）

**Release 模式（L1 + L2A + L2B + L3）**：
- 上述所有检查 +
- ✅ L2B 完整证据（截图/命令验证）
- ✅ L3 DoD 全部验收通过

---

## 开发规范

### 分支策略

```
main (稳定发布，里程碑时合并)
  ↑ 手动 PR
  │
develop (主开发线)
  ↑ PR 合并（CI 必须通过）
  │
cp-* / feature/* (功能分支)
```

**规则**：
- ❌ 禁止直接在 main/develop 写代码
- ✅ 必须在 cp-* 或 feature/* 分支开发
- ✅ 必须有 .prd.md 和 .dod.md 才能写代码
- ✅ 必须通过质检才能创建 PR

### 文件命名规范

| 文件类型 | 命名格式 | 示例 |
|----------|----------|------|
| PRD | `.prd.md` | 功能需求文档 |
| DoD | `.dod.md` | 验收标准清单 |
| QA 决策 | `docs/QA-DECISION.md` | 测试策略决策 |
| 审计报告 | `docs/AUDIT-REPORT.md` | 代码审计结果 |
| Evidence | `.layer2-evidence.md` | 可复核证据 |
| 契约 | `contracts/*.yaml` | 回归契约定义 |

### 质量产物要求

**每个 PR 必须包含**：
1. `.prd.md` - 明确需求
2. `.dod.md` - 验收标准（引用 QA 决策）
3. `docs/QA-DECISION.md` - QA 决策（由 /qa skill 生成）
4. `docs/AUDIT-REPORT.md` - 审计报告（由 /audit skill 生成，Decision: PASS）
5. `.layer2-evidence.md` - 可复核证据
6. `.quality-gate-passed` - 质检通过标记

---

## 测试策略

### 测试分层

| 层级 | 名称 | 内容 | 执行时机 |
|------|------|------|----------|
| **Meta** | 元测试 | regression-contract, hooks, gates | PR + Release |
| **Unit** | 单元测试 | tests/*.test.ts, vitest | PR + Release |
| **E2E** | 端到端测试 | golden_paths, 集成测试 | Release + Nightly |

### 测试命令

```bash
# 运行所有测试
npm test

# 运行质量门控
npm run qa:gate  # 如果配置了

# 手动集成测试
bash tests/manual-integration-test.sh
```

### RCI（Regression Contract Item）

**什么时候需要加 RCI？**
- ✅ 核心功能（Must-never-break）
- ✅ 稳定接口（Verifiable）
- ✅ 可重复验证（Stable Surface）

**RCI ID 命名规则**：
- `H*-00X` - Hooks 相关
- `W*-00X` - Workflow 相关
- `C*-00X` - Core 功能相关
- `B*-00X` - Business 逻辑相关

**示例**：
```yaml
# contracts/cecelia-quality.regression-contract.yaml
rcis:
  - id: C-GATEWAY-001
    name: Gateway 接收任务并入队
    scope: core
    priority: P0
    triggers: [PR, Release]
    test_command: bash tests/gateway.test.ts
```

---

## Skills 使用

### /qa - QA 总控

**用途**：跨仓库统一管理测试决策、回归契约、Golden Paths

**常用命令**：
```
/qa .prd.md                    # 生成 QA 决策
/qa "要不要加 RCI？"            # RCI 判定
/qa "这是 Golden Path 吗？"     # GP 判定
/qa "审计 QA 成熟度"            # QA 审计
```

**产物**：`docs/QA-DECISION.md`

### /audit - 代码审计

**用途**：分层代码审计（L1-L4）

**常用命令**：
```
/audit gateway/ worker/        # 审计指定目录
/audit                         # 审计所有改动文件
```

**产物**：`docs/AUDIT-REPORT.md`

**分层标准**：
- **L1** - 阻塞性问题（必须修）
- **L2** - 功能性问题（建议修）
- **L3** - 最佳实践（可选）
- **L4** - 过度优化（不修）

### /assurance - RADNA 4 层

**用途**：RADNA 质量体系可视化

**四层定义**：
- **R** - Regression（回归）
- **A** - Acceptance（验收）
- **D** - Documentation（文档）
- **N** - Notification（通知）
- **A** - Automation（自动化）

---

## 版本管理

### Semver 规则

| Commit 类型 | 版本变化 | 示例 |
|-------------|----------|------|
| `fix:` | patch (+0.0.1) | 1.0.0 → 1.0.1 |
| `feat:` | minor (+0.1.0) | 1.0.0 → 1.1.0 |
| `feat!:` / `BREAKING:` | major (+1.0.0) | 1.0.0 → 2.0.0 |

### CHANGELOG 更新

每个 PR 必须更新 `CHANGELOG.md`：

```markdown
## [1.1.0] - 2026-01-27

### Added
- Gateway System MVP
- Worker, Heartbeat, State components

### Changed
- Updated test framework to vitest

### Fixed
- N/A
```

---

## 常见问题

### Q: Gateway SHA 检查失败怎么办？

**问题**：`.quality-gate-passed` 中的 SHA 与 HEAD 不匹配

**原因**：chicken-and-egg 问题（更新文件 → commit → SHA 变了）

**解决方案**：
```bash
# 使用正确的格式
CURRENT_SHA=$(git rev-parse --short HEAD)
echo "Test passed
# Commit: $CURRENT_SHA" > .quality-gate-passed
git add .quality-gate-passed
git commit --amend --no-edit
git push -f
```

### Q: 如何跳过 Hook 检查？

**不推荐，但紧急情况下可以**：
```bash
# 临时禁用 hook
git commit --no-verify -m "emergency fix"

# 或设置环境变量
SKIP_HOOKS=1 gh pr create
```

### Q: Worker 执行失败怎么调试？

**查看日志**：
```bash
# 查看最近的 run
ls -lt runs/ | head -5

# 查看任务详情
cat runs/<taskId>/task.json

# 查看执行结果
cat runs/<taskId>/result.json
```

### Q: Heartbeat 如何配置定时任务？

**使用 cron**：
```bash
# 编辑 crontab
crontab -e

# 每 5 分钟执行一次
*/5 * * * * cd /path/to/cecelia-quality && bash heartbeat/heartbeat.sh >> /tmp/heartbeat.log 2>&1
```

---

## 集成指南

### 与 n8n 集成

**Webhook 触发 Gateway**：
```javascript
// n8n HTTP Request Node
const task = {
  taskId: $uuid(),
  source: "n8n",
  intent: "runQA",
  priority: "P1",
  payload: {
    project: "cecelia-workspace",
    branch: "develop"
  }
};

// POST to gateway
$http.post('http://localhost/path/to/gateway.sh', {
  body: JSON.stringify(task)
});
```

### 与 Notion 集成

**Notion CRD → n8n → Gateway**：
1. Notion 创建任务（Status: 待执行）
2. n8n 每 5 分钟轮询
3. 发现新任务 → 调用 Gateway
4. Worker 执行 → 更新 Notion 状态

### 与 CloudCode 集成

**直接调用 Gateway**：
```bash
# 在 Claude Code 中
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-workspace"}'
```

---

## 贡献指南

### 提交 PR 流程

1. **创建 PRD** - `.prd.md`
2. **调用 /qa** - 生成 QA 决策
3. **写 DoD** - `.dod.md`（引用 QA 决策）
4. **写代码** - 实现功能
5. **写测试** - 单元测试 + 集成测试
6. **调用 /audit** - 代码审计
7. **创建 Evidence** - `.layer2-evidence.md`
8. **提交 PR** - 自动触发 CI

### 代码审查标准

- ✅ 所有 Hook 检查通过
- ✅ CI 全绿（quality-check, test, lint, docs）
- ✅ Audit Report: PASS
- ✅ DoD 全部勾选
- ✅ 无安全漏洞

---

## 参考文档

### 内部文档

- `README.md` - 项目介绍
- `CHANGELOG.md` - 版本历史
- `docs/` - 详细文档
- `gateway/README.md` - Gateway 使用指南

### 外部资源

- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Keep a Changelog](https://keepachangelog.com/)

---

## 版本历史

- **v1.1.0** (2026-01-27) - Gateway System MVP
- **v1.0.0** (2026-01-25) - Initial release

---

**🚀 Cecelia Quality - 让质量保障成为开发的自然延伸，而非负担**
