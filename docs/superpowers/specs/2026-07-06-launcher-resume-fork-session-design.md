# Design：launcher resume/continue 自动追加 --fork-session

日期：2026-07-06 ｜ 分支：cp-0706142050-launcher-resume-fork-session ｜ 路径A Bug fix

## 问题

`scripts/claude-launch.sh` 对所有启动无条件注入 `--session-id <uuid>`（#3557 session 隔离核心），
但 claude CLI 规定 `--session-id` 与 `--resume`/`--continue` 同用必须带 `--fork-session`。
launcher 未带 → 用户 `claude --resume`/`-c` 启动即报错秒退，表现为"resume 完全没内容"。
已实锤复现（expect 驱动 `zsh -ic "claude --resume"`）；且已验证
`--session-id + --resume + --fork-session` 组合选择器正常（Phase 3 假设验证通过）。

## 方案对比

- **A（采纳）**：ARGS 解析后检测 resume/continue flags，缺 `--fork-session` 则 `ARGS+=("--fork-session")`。
  最小改动；dry-run（L77）与真实 FINAL_CMD（L150）同源消费 ARGS，自然同步；
  恢复对话 fork 到 launcher 新 session-id，与 per-session worktree / .dev-lock owner_session 模型自洽。
- B（否决）：resume 时跳过 --session-id 注入——破坏 owner_session/Stop Hook 匹配，回退 #3557 前的病。
- C（否决）：launcher 内自实现 resume 选择器——重造轮子，过度工程。

## 实现

`scripts/claude-launch.sh` L25（ARGS 解析循环后）插入：

```bash
_HAS_RESUME=0; _HAS_FORK=0
for arg in ${ARGS[@]+"${ARGS[@]}"}; do
    case "$arg" in
        --resume|--resume=*|-r|--continue|--continue=*|-c) _HAS_RESUME=1 ;;
        --fork-session) _HAS_FORK=1 ;;
    esac
done
if [[ "$_HAS_RESUME" == "1" && "$_HAS_FORK" == "0" ]]; then ARGS+=("--fork-session"); fi
```

bash 3.2 + `set -u` 安全（空数组展开照抄 `_is_headless` 写法）；`--fork-session` ≠ `-p`，不影响 `_is_headless`。

## 影响面

- 只影响交互 alias 用户带 resume/continue 启动的场景。grep 全 repo：无其他调用方给 launcher 传这些 flag；
  headless `cecelia-run.sh` 的 resume 分支直呼裸 claude 不经 launcher，不受影响。
- 已知可接受边角：某 flag 的值恰为字符串 `-r`/`-c` 会误判追加——claude CLI 无此组合场景，测试注明。

## 测试策略（integration 档）

- 新增 4 case 到 `packages/engine/tests/launcher/launcher-dry-run.test.ts`（vitest + execSync dry-run 契约，
  传 `CECELIA_NO_AUTO_WORKTREE=1` 隔离）：
  1. `--dry-run --resume abc` → 输出含 `--fork-session`
  2. `--dry-run -c` → 含
  3. `--dry-run --resume abc --fork-session` → `--fork-session` 恰出现 1 次（防重复）
  4. `--dry-run`（无 resume）→ 不含
- TDD：commit-1 先提 failing tests，commit-2 实现变绿。
- 端到端人工验证（merge 后）：expect 驱动 `zsh -ic "claude --resume"` 选择器弹出。
- 哨兵：逻辑接缝 → CI regression test 即守卫，先红后绿即 proven-to-fire。

## 交付件

- `scripts/claude-launch.sh` 修复
- `launcher-dry-run.test.ts` +4 case
- 版本 bump 19.4.0→19.4.1（6 处：engine package.json / package-lock.json×2 / VERSION / hooks/VERSION /
  .hook-core-version / regression-contract.yaml）
- `feature-registry.yml` changelog 追加 19.4.1 条目
- PR title：`[CONFIG] fix(engine): ...`
