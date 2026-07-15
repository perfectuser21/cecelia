# Bug PrepPRD：slot 会话历史落孤儿 key，主仓 `--resume` 找不到

Brain task: d83ef7c9-428c-4cc4-a8fd-b1ce9c73c306
base_repo: https://github.com/perfectuser21/cecelia

## 症状
slot 里开的会话（如智能获客 e2d67c75）关掉后，主仓 `claude --resume` 报
`No conversation found`，用户以为会话丢了。已复发 >=2 次（07-13 7f7a2e70、07-15 e2d67c75）。

## 根因（已复现坐实）
`_link_projects_dir` 挂在 `AUTO_WORKTREE=1` 门禁下，该门禁要求 cwd 在主仓
（`_in_main_repo_worktree`）。从**已存在的 worktree 内**启动 claude（slot 复用终端目录）
→ 软链不执行 → Claude Code 在 `~/.claude/projects/<wt_key>/` 建真目录
→ 历史落主池之外 → 主仓 `--resume` 看不见。

证据：
- `--dry-run` 复现：主仓启动输出含 `ln -s`；worktree 内启动无。
- 生产实证：e2d67c75 的 project key = `-Users-administrator-worktrees-zenithjoy-session-9cc9a05b`，
  即启动时 cwd 在该 worktree。
- 统计：48 个 zenithjoy worktree key 中 43 个软链（从主仓起）、5 个真目录（从 worktree 内起）。
- 软链修复本身早在 2026-07-06 PR #3567 已进 main，故非老版遗留。

次因（4.1）：清理段（221-223 行）干净退出时 `rm` 掉**共享**软链；同一 key 曾压 4 条会话
（9cc9a05b/26f662f5/cee71334/e2d67c75），后续会话再写即重建成真目录。

## 关联上下文
- memory: issue_session_history_scattered_resume_unfindable（本 PRD 即其根因坐实 + 修复）
- 陈旧重复 PR #3564（2026-07-06 开，0 CI check，被 #3567 取代）→ 开新 PR 时关闭并注明

## 修法
| # | 改动 | 依据 |
|---|---|---|
| 1 | 解耦门禁：任何交互式启动，cwd 是 linked worktree 就软链；主仓用 `git rev-parse --git-common-dir` **正向**求出，不反推 | 核心根因 |
| 2 | 砍掉清理段 `rm` 软链（221-223） | 软链 8 字节零成本，删了才产孤儿 |
| 3 | `mv` → `mv -n`（不覆盖）+ 冲突显式报错 | 现有代码同名即静默覆盖主池历史 |
| 4 | 抽 `_is_real_dir()` 强制 `-L` 先验 + `ln -sfn` | 防新代码把主池当孤儿搬走（最大灾难面） |
| 5 | 启动断言：`$CLAUDE_CONFIG_DIR/projects` 与 `~/.claude/projects` 不同源则告警 | 账号池同源是手工设的，代码无保障 |
| 6 | headless **不**软链 | 否则机器人会话灌爆 /resume，换姿势复发 |
| 7 | ❌ 不做自动 sweep | 反推有损，已证 zenithjoy-skills 会被并错库 |

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 孤儿 key 属于哪个主仓 | A.key 反推路径 B.前缀最长匹配 C.正向 git-common-dir | **C** | A/B 已实证误判：`-Users-administrator-perfect21-zenithjoy-skills` 以主仓 key 为前缀且是独立 repo；`gp-orchestrator-flag` 两种反推候选均不存在 | 跨 repo 并库，不可逆 |
| cwd 是否 linked worktree | A.路径前缀猜 B.`git-dir != git-common-dir` | **B** | git 权威，不依赖命名约定 | 漏链（继续丢会话）/ 误链 |

## Regression Test 计划（proven-to-fire，逻辑接缝 → CI）
现有 `packages/engine/tests/launcher/claude-launch.test.ts` 已有 --dry-run 契约接缝，补 3 条：
1. cwd 已在 worktree 内 → dry-run 输出**含** `ln -s` 契约行（现在必红 = 复现 bug）
2. 同一 key 多会话共用 → 第一个干净退出后**软链仍在**
3. 孤儿真目录与主池**同名文件** → 不覆盖，且冲突报错

注意：第 411 行现有用例「干净退出 → 软链被删除」把 bug 写成了预期，需随修法 2 一起改判。

## 存量（本刀不碰）
13 条会话已于 2026-07-15 手工 rsync --ignore-existing 并回主池 + shasum 全校验 0 失败，
备份在 scratchpad/projkey-backup。其它 repo 的孤儿（如 gp-orchestrator-flag 3 条）
反推不出主仓，出人工清单给用户拍板，不自动搬。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 已亲眼看守卫报红过一次（proven-to-fire）
- [ ] CI 全绿

---

## 对抗深挖第二轮补充（混沌工程师，2026-07-15）

已证伪（不改）：
- G10 账号池顺序：`~/.claude-account{1,2,3}/projects` 全是软链指向 `~/.claude/projects`
  （inode 582971 一致，实测），写 account2 池即写主池，软链不落空。
  但账号级软链是手工设置、代码无保障 → 保留修法 5 的启动断言即可，不做 P0 改动。
- 6.3 `.DS_Store`：`find ~/.claude/projects -maxdepth 2 -name .DS_Store` 为空，现未触发（潜在）。

已坐实，追加进修法：
| # | 改动 | 依据 |
|---|---|---|
| 8 | **G6**：`pwd -P` 失败改硬失败（`return 1` + 告警），不再回退逻辑路径 | 回退会建出 key 对不上的**死链**，比不建链更坏（sweep 误判已处理）；生产已留痕 `-var-folders-*` → `-private-var-folders-*`（launcher 测试残留） |
| 9 | **G4**：`_link_projects_dir` 全程持原子锁（`mkdir "$root/.lock.<key>"` + trap 释放，超时放弃不阻断启动） | 两个 slot 同时命中 148 行 `elif [[ -d "$link" ]]` 分支 → glob 已展开、文件被对方移走 → `mv` 失败 `return 1` → 放弃建链 → 全程写真目录 = 新孤儿 |
| 3' | **G3 精修**：冲突文件既不覆盖也不静默跳过，改名保留 `<uuid>.orphan-<ts>.jsonl` + 显式告警 | `mv` 覆盖丢主池那份；`--ignore-existing` 静默跳过丢 worktree 那份（往往更新）。两个方向都丢数据 |

G5（软链生命周期挂错主体）与修法 2 同源，已覆盖：软链是 per-worktree-path 的**共享资源**，
不是 per-session 私有资源，生命周期不该挂在任一会话退出上。采纳修法 1 后此缺陷会**放大**
（建者众、删者独，删的还是别人的链）→ 故修法 2 必须同刀落地。

G7（prunable worktree）：登记表校验补 `-d "$phys"`，防把不存在路径当合法 worktree。

暂不处理（记录待办）：
- G1/G2 sweep 反推不可判定 → 已由修法 7（不做自动 sweep）规避。
- 正向台账 `.wt-map.jsonl`：本刀不建（YAGNI，修法 1 正向求主仓已够）；
  若将来确需离线查历史孤儿再议。
- 未验证项：Claude Code 在悬空软链上的写入行为；Claude Code key 算法是否严格等于
  「仅替换 / 和 .」（含 `_` 的路径样本未覆盖）→ 修法 8 硬失败可兜住此类 key 不符。
