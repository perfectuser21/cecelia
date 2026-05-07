# Stop Hook v23 — PR-3 v22 遗产清理 + FD 201 leak 修复 Spec

> 日期：2026-05-07
> Brain task：`22a25a39-c935-4128-931b-9785d9acf1f9`
> 上层设计：`docs/design/stop-hook-v23-redesign.md`
> 前置 PRs：[#2823](https://github.com/perfectuser21/cecelia/pull/2823) (PR-1) + [#2826](https://github.com/perfectuser21/cecelia/pull/2826) (PR-2) + [#2827](https://github.com/perfectuser21/cecelia/pull/2827) (PR-2.5) — 已合
> 范围：v23 序列**收尾**

---

## 1. 范围调整说明

原 PR-3 设计预想删除 `dev-active-*.json` 创建逻辑 + `verify_dev_complete` 函数。grep 全 codebase 后发现两个硬约束：

| 约束 | 影响 |
|---|---|
| `packages/engine/hooks/dev-mode-tool-guard.sh` (PreToolUse hook) **仍依赖** `dev-active-*.json` 存在性来判断 "assistant 是否在 /dev 流程"，决定是否拦 ScheduleWakeup / Bash background | 不能删 dev-active 创建 |
| `verify_dev_complete` 函数被 9 个测试文件 + 4 个 docs 引用；唯一**真调用方** stop-dev.sh 已在 v23 切换中删除 | 可标 deprecated；不能直接删函数（炸测试） |

新策略：**保守清理 + 修真 bug**，全删留给独立后续 PR（如真有需要）。

## 2. 必做

| # | 改动 | 价值 |
|---|---|---|
| A | **修 FD 201 leak**：worktree-manage.sh guardian fork 关 FD 201 | 修真 bug — 防 guardian 孤儿持 worktree-create lock |
| B | **mark verify_dev_complete deprecated**：函数头加 deprecation 注释 + 指向 v23 心跳模型 | 文档化 v22→v23 演进 |
| C | **migration 脚本**：`scripts/cleanup-v22-state-files.sh` — 一次性归档现网 `.cecelia/dev-active-*.json`（活的不动） | 现网卫生 |
| D | **feature-registry stop-hook 描述同步 v23**：去掉 "cwd 路由 / ghost 过滤 / mtime expire" 等 v22 引用 | 文档准确 |
| E | **dev-active 创建处加注释**：worktree-manage.sh 标注 "保留供 dev-mode-tool-guard 用，stop-dev.sh 已不读" | 防止后续维护者疑惑 |

## 3. 不做（明确）

| 不做 | 理由 |
|---|---|
| 删 `worktree-manage.sh` 创建 dev-active 的代码 | dev-mode-tool-guard 仍需要 |
| 删 `verify_dev_complete` 函数本体 | 9 测试 + 4 docs 引用，删了炸 CI |
| 迁移 dev-mode-tool-guard 到 lights/ 模型 | 范围过大；本身工作正常；独立 PR 评估 |
| 删现网 `.cecelia/dev-active-*.json` 文件 | migration 脚本归档，不直接删（可能正在用） |

## 4. FD 201 leak 详细分析（项 A）

### 现状代码
```bash
# packages/engine/skills/dev/scripts/worktree-manage.sh cmd_create
exec 201>"$lock_file"
flock -w 5 201

# ... 创建 worktree ...

# v23 PR-2 加的 guardian fork
nohup bash "$_guardian_lib" "$_light_file" >/dev/null 2>&1 &
disown $_guardian_pid 2>/dev/null || true
```

### 问题
`nohup bash ... &` 后台 fork 时**继承父进程所有 FD**，包括 FD 201（worktree-create lock）。即使 cmd_create 退出 → FD 201 在父进程关闭 → guardian 进程仍开着 FD 201 → flock 锁仍持有。

下次 cmd_create 调用 → flock -w 5 失败 → "另一个进程正在创建 worktree"。

### 验证
```bash
$ ps -p <orphan_guardian_pid> -o command
bash /path/.cecelia/hb.sh /path/.cecelia/lights/...

$ fuser .git/worktree-create.lock
.git/worktree-create.lock: <orphan_guardian_pid>
```

**今晚跑 PR-3 时实测命中此 bug**。kill orphan guardian 后才能继续。

### 修复
guardian fork 时显式关 FD 201：

```bash
nohup bash "$_guardian_lib" "$_light_file" </dev/null >/dev/null 2>&1 201>&- &
```

`201>&-` 关闭 FD 201。这样 guardian 不再持有 worktree-create lock。

## 5. 测试策略

### E2E
- `tests/skills/worktree-fd201-leak.test.ts`（新增 1 case）：
  - 创建 worktree（fork guardian） → cmd_create 退出 → 检查 FD 201 已被 guardian 关闭
  - 实现：`fuser` 锁文件 → 应该没有 guardian PID

### Integration
- 19 个 PR-2 测试矩阵 + 3 个 PR-2.5 single-exit 测试**全保持 PASS**（不动决策）

### Unit
- 无（纯结构清理 + 注释）

### Trivial
- migration 脚本 = trivial wrapper（mv 一组文件）；1 unit test

## 6. DoD

```
- [ARTIFACT] worktree-manage.sh guardian fork 行包含 201>&-
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('201>&-'))process.exit(1)"

- [BEHAVIOR] FD 201 不被 guardian 继承
  Test: tests/skills/worktree-fd201-leak.test.ts

- [ARTIFACT] verify_dev_complete 函数头含 @deprecated 标注
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');const m=c.match(/(?:#[^\\n]*\\n){1,5}verify_dev_complete\\(\\)/);if(!m||!m[0].includes('deprecated'))process.exit(1)"

- [ARTIFACT] cleanup-v22-state-files.sh 存在 + chmod +x
  Test: manual:node -e "const fs=require('fs');const s=fs.statSync('scripts/cleanup-v22-state-files.sh');if(!(s.mode&0o111))process.exit(1)"

- [ARTIFACT] worktree-manage.sh dev-active 创建处含保留注释
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('dev-mode-tool-guard'))process.exit(1)"

- [BEHAVIOR] feature-registry stop-hook 描述无 v22 引用
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');const i=c.indexOf('id: stop-hook');const e=c.indexOf('id: ',i+10);const sec=c.slice(i,e);if(sec.includes('cwd-as-key')||sec.includes('ghost 过滤'))process.exit(1)"

- [BEHAVIOR] PR-2 + PR-2.5 测试矩阵全保持 PASS
  Test: tests/hooks/stop-hook-v23-decision.test.ts + tests/hooks/stop-hook-v23-routing.test.ts + tests/hooks/stop-hook-single-exit.test.ts
```

## 7. Engine 三要素

1. PR title 含 `[CONFIG]`
2. **8 文件 version bump 18.24.1 → 18.25.0**（minor，FD leak 修复 + 文档同步）
3. feature-registry.yml 加 18.25.0 changelog

## 8. Commit 顺序

```
commit 1: test(engine): PR-3 v22 cleanup — fail tests
  - tests/skills/worktree-fd201-leak.test.ts (FD 关闭验证 fail)
  - artifact-level deprecated 标注断言（fail，函数还没标）

commit 2: [CONFIG] feat(engine): PR-3 v22 cleanup + FD 201 leak fix
  - worktree-manage.sh: 加 201>&- + dev-active 保留注释
  - devloop-check.sh: verify_dev_complete 标 @deprecated
  - scripts/cleanup-v22-state-files.sh 新建
  - feature-registry.yml stop-hook 描述同步 v23 + 18.25.0 changelog
  - 8 文件 version bump
```

## 9. 自审

- 无 placeholder
- 范围保守但**修了真 bug**（FD 201 leak）
- 不破坏 dev-mode-tool-guard
- 测试矩阵全保留作回归基线
