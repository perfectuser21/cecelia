# ZenithJoy Engine

AI 开发工作流引擎 - 让 AI 自主、可靠地完成开发任务。

---

## OKR

**目标：Cecelia 24/7 自主运行**

| 关键结果 | 状态 |
|----------|------|
| 信息保持最新（SSOT）| 进行中 |
| CI 100% 覆盖 | ✅ |
| 无人值守开发 | 进行中 |

---

## 核心理念

### 1. 信息保持最新（唯一目标）

所有文档、配置、代码必须保持同步。过时的信息是最大的敌人。

| 唯一真实源 | 位置 |
|------------|------|
| 版本号 | `package.json` |
| 变更历史 | `CHANGELOG.md` |
| 回归契约 | `regression-contract.yaml` |
| 工作流定义 | `skills/dev/SKILL.md` |

### 2. CI 是唯一防线

本地 Hook 只是**辅助**，CI 才是**真正的门卫**。

```
本地 Hook (辅助) → PR 创建 → CI 检查 (唯一防线) → 合并
```

- ❌ 禁止使用 `--admin` 绕过 CI
- ❌ 禁止 force push 到 main/develop
- ✅ CI 失败 = 必须修复，没有例外

### 3. 每次开发 = 一个 PR

不直接在 main/develop 写代码。所有开发都是：

```
创建分支 (cp-*/feature/*) → 写代码 → 创建 PR → CI 通过 → 合并
```

### 4. Stop Hook = 不达目的不罢休

`hooks/stop.sh` 实现循环控制：

- 检测任务是否完成（CI 绿、PR 合并）
- 未完成 → `exit 2` → 阻止会话结束 → 继续尝试
- 最多 15 次重试，防止无限循环

### 5. Worktree = 并行隔离

多任务同时进行时，使用 Git Worktree 隔离：

```bash
git worktree add ../task-a cp-task-a
git worktree add ../task-b cp-task-b
```

每个任务独立目录，互不干扰。

### 6. PRD/DoD = 质量保障

**没有 PRD/DoD 不能写代码**（`branch-protect.sh` 强制）。

| 文件 | 作用 |
|------|------|
| `.prd-*.md` | 功能描述 + 成功标准 |
| `.dod-*.md` | 验收清单（checkbox） |

---

## 入口

| 命令 | 说明 |
|------|------|
| `/dev` | 开始开发流程（自动创建 PRD/DoD） |

---

## 分支策略

```
main (稳定发布)
  └── develop (主开发线)
        └── cp-* / feature/* (功能分支)
```

- 只在 `cp-*` 或 `feature/*` 分支写代码
- PR 合并到 develop，里程碑时 develop 合并到 main
- main 推送后自动 back-merge 到 develop

---

## Hooks

| Hook | 作用 |
|------|------|
| `branch-protect.sh` | 分支检查 + PRD/DoD 验证 |
| `stop.sh` | 循环控制（不达目的不罢休）|
| `credential-guard.sh` | 凭据泄露检测 |

---

## GitHub 分支保护

```yaml
required_status_checks:
  strict: true
  checks:
    - context: test
enforce_admins: true    # Admin 也必须遵守
allow_force_pushes: false
allow_deletions: false
```

检查/修复命令：
```bash
bash scripts/setup-branch-protection.sh --check
bash scripts/setup-branch-protection.sh --fix
```

---

## 目录结构

```
zenithjoy-engine/
├── hooks/           # Claude Code Hooks
├── skills/          # /dev
├── docs/            # 架构、经验文档
├── scripts/         # 部署、检查脚本
├── .github/         # CI 配置
└── src/             # 代码
```
