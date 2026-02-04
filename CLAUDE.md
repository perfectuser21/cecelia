# ZenithJoy Engine

AI 开发工作流引擎。

---

## 唯一真实源

| 内容 | 位置 |
|------|------|
| 版本号 | `package.json` |
| 变更历史 | `CHANGELOG.md` |
| 功能清单 | `FEATURES.md` |
| 回归契约 | `regression-contract.yaml` |
| 工作流定义 | `skills/dev/SKILL.md` |
| 知识架构 | `docs/ARCHITECTURE.md` |
| 开发经验 | `docs/LEARNINGS.md` |

---

## 核心规则

1. **只在 cp-* 或 feature/* 分支写代码** - Hook 引导
2. **每个 PR 更新版本号** - semver
3. **完成度检查必须跑** - □ 必要项全部完成
4. **CI 绿是唯一完成标准**
5. **❌ 禁止使用 `--admin` 绕过分支保护和 CI** - 永远遵守规则

### 关于 --admin 权限

**绝对禁止使用 `gh pr merge --admin` 或任何绕过分支保护的操作。**

**原因**：
- ❌ 绕过 CI 检查会失去安全保障
- ❌ 绕过分支保护会破坏历史稳定性
- ❌ 制造"特殊通道"会让规则失效
- ❌ 导致未来更大的冲突和不可预期的行为

**正确做法**：
- ✅ 遇到合并冲突 → 创建 release/* 分支解决冲突
- ✅ release/* 包含 develop → 通过祖先关系检查
- ✅ CI 失败 → 修复问题，不要绕过
- ✅ 规则阻塞 → 改进规则本身，不要开后门

**分支流程已优化**：
- main 推送后自动 back-merge 到 develop（防止长期分叉）
- release/* 分支合法（但必须包含 develop 的所有提交）
- 所有合并都有自然路径，不需要 admin 权限

---

## 入口

| 命令 | 说明 |
|------|------|
| `/dev` | 开始开发流程 |
| `/audit` | 代码审计与修复（有边界） |

---

## 目录结构

```
zenithjoy-engine/
├── hooks/           # Claude Code Hooks
│   ├── branch-protect.sh      # 分支保护 + 步骤状态机 (项目+全局)
│   ├── stop.sh                # 循环控制（15 次重试上限）(全局)
│   ├── subagent-stop.sh       # Subagent 循环控制 (项目)
│   ├── credential-guard.sh    # 凭据保护 (全局)
│   ├── mark-subagent-done.sh  # 标记 Subagent 完成 (项目)
│   ├── require-subagent-token.sh  # Subagent Token 验证 (项目)
│   ├── session-start.sh       # 会话开始 (全局)
│   └── pr-gate-v2.sh          # [已废弃] v12.4.5 移除
├── skills/
│   ├── dev/         # /dev 开发工作流
│   ├── audit/       # /audit 代码审计
│   └── qa/          # /qa QA 总控
├── docs/            # 详细文档
│   ├── ARCHITECTURE.md    # 知识分层架构
│   └── LEARNINGS.md       # 开发经验
├── templates/       # 文档模板
├── scripts/         # 部署脚本
│   └── deploy.sh    # 部署到 ~/.claude/
├── .github/         # CI 配置
├── n8n/             # n8n 工作流
└── src/             # 代码
```

---

## 项目级配置 (.claude/settings.json)

**skills 和 hooks 的配置格式不同**：

| 配置项 | 支持 `paths` 简写 | 项目级覆盖 |
|--------|------------------|-----------|
| skills | ✅ 支持 | ✅ |
| hooks  | ❌ 不支持 | ✅（需完整写） |

### skills 配置（简写）
```json
{
  "skills": {
    "paths": ["./skills"]
  }
}
```

### hooks 配置（必须完整写事件）
```json
{
  "hooks": {
    "PreToolUse": [
      {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "./hooks/branch-protect.sh"}]},
      {"matcher": "Bash", "hooks": [{"type": "command", "command": "./hooks/require-subagent-token.sh"}]}
    ],
    "SubagentStop": [
      {"hooks": [{"type": "command", "command": "./hooks/subagent-stop.sh"}]}
    ]
  }
}
```

**注意**：质量检查（原 pr-gate-v2.sh）已在 v12.4.5 移除，完全交给 CI 处理。

**开发流程**：
- 项目内 `./hooks/` 和 `./skills/` → develop 分支开发版
- 全局 `~/.claude/hooks/` 和 `~/.claude/skills/` → main 分支稳定版（deploy.sh 部署）
- 在项目内测试新功能，稳定后 merge 到 main 并 deploy 到全局

---

## 分支策略（develop 缓冲）

```
main (稳定发布，里程碑时更新)
  └── develop (主开发线，日常开发)
        ├── cp-* (小任务，直接回 develop)
        └── feature/* (大功能，可选，最终也回 develop)
```

**核心原则**：
- main 始终稳定，只在里程碑时从 develop 合并
- develop 是主开发线，所有日常开发都在这里
- 只在 cp-* 或 feature/* 分支写代码（Hook 引导）
- cp-* 完成后回 develop，积累够了 develop 回 main

详细文档见 `docs/`。

---

## GitHub 分支保护

### 标准配置

所有核心仓库的 main/develop 分支必须启用以下保护：

```yaml
required_status_checks:
  strict: true
  checks:
    - context: test
enforce_admins: true          # 关键：Admin 也必须遵守 CI
allow_force_pushes: false
allow_deletions: false
```

### 保护的仓库

| 仓库 | main | develop |
|------|------|---------|
| zenithjoy-engine | ✅ | ✅ |
| zenithjoy-autopilot | ✅ | ✅ |
| zenithjoy-core | ✅ | ✅ |

### 检查/修复命令

```bash
# 检查所有仓库
bash scripts/setup-branch-protection.sh --check

# 修复所有仓库
bash scripts/setup-branch-protection.sh --fix

# 检查/修复指定仓库
bash scripts/setup-branch-protection.sh --check owner/repo
bash scripts/setup-branch-protection.sh --fix owner/repo
```

### 为什么 enforce_admins 必须是 true

- **问题**：如果 `enforce_admins: false`，Admin 可以绕过 CI 强行合并 PR
- **后果**：CI 失去最后防线的意义，bug 代码可能直接进入 main/develop
- **解决**：`enforce_admins: true` 确保即使是 Admin 也必须等 CI 绿才能合并
