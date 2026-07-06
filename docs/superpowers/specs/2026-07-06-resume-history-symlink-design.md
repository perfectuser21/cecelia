# 设计：claude-launch.sh 会话历史软链回主仓（修复 /resume 被 session 隔离打散）

- 日期：2026-07-06
- 分支：cp-07061211-resume-history-symlink
- Brain Task：6e155270-47e0-46d2-af72-be98cf6814ca
- Decision：dd170cd8（session 隔离后 /resume 历史恢复方案）
- 关联 PR：#3557（session 隔离根治，本设计修其副作用）

## 问题

PR #3557 让每个交互 claude session 自动落到独立 cwd `~/worktrees/<repo>/session-<sid8>`。Claude Code 按 cwd 派生 projects key（路径中 `/` 和 `.` 逐字符替换为 `-`），把会话 transcript 存进 `~/.claude/projects/<key>/`；`/resume` 按当前 cwd 的 key 过滤。结果：每个 session 独占一个项目文件夹，`/resume` 只能看到自己，全部历史不可见，且持续产生孤儿文件夹。

## 方案（已比选）

- **A（采纳）：launcher 建软链**——per-session worktree 的 projects key 软链到主仓 key，所有 transcript 继续汇聚一池。与三账号共享（accountX/projects → ~/.claude/projects）同一机制，改动集中在 launcher 一处。
- B：取消 cwd 隔离——推翻 #3557，不可接受。
- C：退出后把 transcript 合并回主仓文件夹——session 进行中 /resume 仍看不到历史，且有活跃写句柄风险，劣于 A。

## 实现

改动文件：`scripts/claude-launch.sh`（cecelia 主仓；zenithjoy 走同一 launcher alias，`$_MAIN_REPO` 动态计算天然覆盖）。

### 1. 软链建立（`cd "$_WT_PATH"` 之后、claude 启动之前）

```
_path_to_project_key(): printf '%s' "$1" | sed 's#[/.]#-#g'
_PROJECTS_ROOT = ${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}   # env 可覆盖，供测试沙箱
_MAIN_KEY = key($_MAIN_REPO)；_WT_KEY = key($_WT_PATH)
mkdir -p "$_PROJECTS_ROOT/$_MAIN_KEY"
分支：
  - $_WT_KEY 已是软链：readlink == 主仓目标 → 跳过（幂等，session 复用场景）；目标不符 → rm 后重建
  - $_WT_KEY 是真实目录（孤儿）→ 把其中全部内容（*.jsonl + uuid 子目录）mv 进主仓文件夹，删除空目录，替换为软链
  - 不存在 → ln -s "$_PROJECTS_ROOT/$_MAIN_KEY" "$_PROJECTS_ROOT/$_WT_KEY"
```

**best-effort 铁律**：整段包容错（失败仅 stderr 警告，绝不阻断 claude 启动）。launcher 是所有交互 claude 的必经路径，projects 目录权限异常/磁盘满不得影响主流程。

### 2. 清理（干净退出、worktree 真被 remove 的分支内）

`[[ -L "$_PROJECTS_ROOT/$_WT_KEY" ]] && rm "$_PROJECTS_ROOT/$_WT_KEY"`——先验证是软链再删、只删链接本身（绝不 `rm -r`）。脏 worktree 保留时软链同步保留，否则用户回到脏 worktree 继续工作时历史再次断裂。

### 3. --dry-run 契约

自动 worktree 分支的 dry-run 输出追加一行 `ln -s "<projects_root>/<main_key>" "<projects_root>/<wt_key>"`，供契约测试锁定。

### 4. 关键事实（Research Subagent 已实证）

- key 编码 `/`→`-`、`.`→`-` 与 `~/.claude/projects/` 现有 30+ 条目逐字符对应
- 三账号 projects 均软链至 `~/.claude/projects`，默认根天然覆盖所有账号
- repo 内零代码依赖 `<session-key>` 是真实目录（hooks / worktree 脚本 grep 零命中）
- 项目文件夹内容 = `<uuid>.jsonl` + 同名 uuid 子目录（subagents/tool-results），uuid 命名，mv 迁移无碰撞风险；迁移发生在 claude 启动前，无活跃写句柄

## 错误处理

| 场景 | 行为 |
|---|---|
| projects 根不可写 / ln 失败 | stderr 警告，claude 照常启动（回到现状：历史不共享，无破坏） |
| 孤儿目录迁移中单个 mv 失败 | 跳过该项继续，不替换为软链（保留真实目录，下次再试） |
| 软链已存在但指向错误目标 | rm 后重建（仅当 -L 成立） |
| sanitize 规则与 Claude Code 实际不一致 | 软链 key 错位，claude 写入自建真实目录——退化为现状，无破坏性 |

## 测试策略（integration 档）

新增 describe 块于 `packages/engine/tests/launcher/claude-launch.test.ts`，沿用既有模式（mkdtempSync 沙箱 + mock claude + env 覆盖），新增 `CLAUDE_PROJECTS_ROOT` 指向 tmpdir：

1. **软链建立**：auto-worktree 启动后，mock claude 运行期内 `<projects_root>/<wt_key>` 是软链且指向 `<main_key>`（mock 脚本内 `test -L` + `readlink` 输出断言）
2. **孤儿迁移**：预置 `<wt_key>/` 真实目录含 fake jsonl → 启动后文件出现在 `<main_key>/`，原位变软链
3. **干净退出清理**：claude 干净退出 → 软链被删，`<main_key>/` 内 jsonl 完好
4. **脏 worktree 保留**：mock claude 写未提交文件 → worktree 保留且软链保留
5. **dry-run 契约**：输出含 `ln -s` 行
6. **既有加固**：给既有「真实建立与清理」3 个测试补 `CLAUDE_PROJECTS_ROOT` 沙箱，避免在开发机真实 `~/.claude/projects` 留 tmp 垃圾软链

TDD：commit-1 全部 failing test，commit-2 实现变绿。

## 哨兵

逻辑接缝（key 计算 / 软链 / 迁移 / 清理）→ 上述 CI test 即守卫，proven-to-fire = commit-1 亲见红。环境接缝（真实 ~/.claude/projects）不新增运行时自检：失败模式是无破坏性退化（回到现状），且 launcher best-effort 警告已可观察。

## 范围外

- 历史孤儿文件夹（07-05 起已产生的 session-* 真实目录）的一次性回填合并：merge 后手工执行，不进 launcher
- CI 机械闸门（碰 launcher 必带测试）：已有 engine-ci 覆盖该测试文件，不另建

## 工程合规

- PR title 带 `[CONFIG]`（launcher 属 engine 配置面，同 #3557 惯例）
- Engine 版本 bump 5 文件 + feature-registry.yml changelog + generate-path-views.sh（engine 测试文件变更触发三要素）
- DoD 含 ≥1 条 [BEHAVIOR]，Test 用 CI 兼容格式
