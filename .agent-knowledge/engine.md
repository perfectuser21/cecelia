# Engine 模块详情

> 从 `packages/engine/` 提取的关键信息（更新于 2026-03-28）。
> 详细说明书：http://38.23.47.81:9998/knowledge/engine/

---

## 基本信息

| 项目 | 值 |
|------|----|
| 路径 | `packages/engine/` |
| 版本 | `packages/engine/VERSION` |
| 职责 | 开发工作流引擎（Hooks、DevGate、Skills、CI 工具） |

---

## 核心组件

| 组件 | 路径 | 职责 |
|------|------|------|
| Hooks | `packages/engine/hooks/` | 分支保护、Stop Hook、Bash Guard |
| Skills | `packages/engine/skills/` | 内置 dev/qa/audit/assurance skill 配置 |
| DevGate | `scripts/devgate/` | CI 门禁脚本（DoD 映射、RCI 覆盖、版本检查） |
| CI 配置 | `packages/engine/ci/` | GitHub Actions 工作流配置 |
| Tests | `packages/engine/tests/` | Engine 单元测试（vitest） |

---

## 关键 Hooks

| Hook | 触发时机 | 职责 |
|------|---------|------|
| `branch-protect.sh` | Write/Edit | 分支保护，强制 PRD/DoD，阻止 main 直写 |
| `stop-dev.sh` | 会话结束 | 检查 PR 是否合并，未合并时 exit 2 循环 |
| `bash-guard.sh` | Bash 命令 | 主仓库 main 分支禁止危险 bash 命令 |
| `credential-guard.sh` | Write | 防止凭据写入代码文件 |

---

## DevGate 门禁脚本

```bash
# DoD → Test 映射检查（CI L2 强制）
node packages/engine/scripts/devgate/check-dod-mapping.cjs

# RCI 覆盖率扫描
node scripts/devgate/scan-rci-coverage.cjs

# P0/P1 任务必须更新 RCI
bash scripts/devgate/require-rci-update-if-p0p1.sh

# 版本同步检查（Engine 改动后）
bash scripts/check-version-sync.sh
```

---

## Engine 版本规则

Engine Skills/Hooks 改动的三要素：

**1. PR title 含 `[CONFIG]`**（触发 engine-ci.yml）

**2. 版本 bump 5 个文件**（`packages/engine/ci/scripts/check-version-sync.sh` 强制校验）：
```
packages/engine/package.json       (.version 字段)
packages/engine/package-lock.json
packages/engine/VERSION
packages/engine/.hook-core-version
packages/engine/regression-contract.yaml
```

**3. 文档更新**：
- `packages/engine/features/feature-registry.yml` — 新增 changelog 条目
- 运行 `bash packages/engine/scripts/generate-path-views.sh` 重新生成路径视图

commit 前缀 `[CONFIG]` 触发 engine-ci.yml。

---

## 深度说明书

- Engine 模块图：http://38.23.47.81:9998/knowledge/engine/
