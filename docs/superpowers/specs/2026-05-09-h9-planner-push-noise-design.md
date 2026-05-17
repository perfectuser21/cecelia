# H9 — harness-planner SKILL push noise 静默

**日期**: 2026-05-09
**状态**: design APPROVED
**Sprint**: langgraph-contract-enforcement / Stage 1
**Brain task**: 5fae603d-6f14-4f84-8838-5121a1b1dd97
**接手 PRD**: docs/handoffs/2026-05-09-langgraph-contract-enforcement-prd.md（Fix 4）

---

## 1. 背景

`packages/workflows/skills/harness-planner/SKILL.md:151` 当前要求 planner 容器执行：

```bash
git push origin HEAD
```

但 planner 容器**没有 push 凭据**（OAuth 不在容器内挂载，运行身份是 detached docker spawn 出来的 cecelia-runner，不绑定 GitHub credentials）。

W8 acceptance 5 次连跑，planner 节点 5 次都报 `git push failed (无 creds)` → SKILL `set -e` 即时 abort → 容器 exit_code 非 0 → Brain 把整个 planner 节点判为失败，但实际上 sprint-prd.md 已经 commit 到了**共享 worktree**，proposer 节点直接读文件即可，**根本不需要远端 branch**。

后果：14 小时 5 次跑全部被这条假错误误导诊断方向。

## 2. 修法

`SKILL.md:151` 把：

```bash
git push origin HEAD
```

改成：

```bash
git push origin HEAD 2>/dev/null || echo "[harness-planner] push skipped (no creds), commit retained on local branch"
```

效果：
- 有 creds → push 成功，echo 不打（`||` 短路）
- 无 creds → push 失败，stderr 静默，echo 打 fallback 提示，**整体退出码 0**
- SKILL 后续步骤（返回 `{"verdict":"DONE"}`）继续走 → planner 节点 success

## 3. 不动什么

- `git checkout -b` / `git add` / `git commit` 三步保留（必需，commit 留在共享 worktree 给 proposer 读）
- SKILL 其他步骤（Step 1/Step 2 不变）
- 其他 SKILL 中类似 `git push` 行为不动（H9 范围只此一处）

## 4. 测试策略

按 Cecelia 测试金字塔：H9 改动是单行 shell fallback，属于 **trivial wrapper（< 20 行无 I/O 的 shell snippet）**。但行为对 harness pipeline 整链路影响重大（5 次 fail 全因这一行），加 unit test 兜住。

### 两层验证

**层 1：ARTIFACT 静态检查（DoD）**
`node -e` grep SKILL.md 是否含 `2>/dev/null` + `||` + `push skipped` 字样。CI L1 兼容。

**层 2：BEHAVIOR unit test**
`tests/skills/harness-planner-push-noise.test.js`（vitest）：
- 从 SKILL.md 用正则提取 Step 3 bash 块
- 把块里 `git push origin HEAD ...` 单行抽出（用 grep）
- 在临时目录里：mock `git` 二进制，让它对 `push` 退 1（模拟无 creds）
- 跑该 single-line snippet，验证：
  - 整体退出码 0（fallback 生效）
  - stdout 含 `push skipped`
  - stderr 不含 git 错误（被 `2>/dev/null` 吞）

不引入 docker，不依赖真 SKILL 容器。CI 能跑。

## 5. DoD（成功标准）

- **[BEHAVIOR]** harness-planner SKILL Step 3 的 git push 失败时整体退出码 0 且打 fallback echo
  Test: `tests/skills/harness-planner-push-noise.test.js`
- **[BEHAVIOR]** SKILL Step 3 git push 成功时不打 fallback echo（无噪音）
  Test: `tests/skills/harness-planner-push-noise.test.js`
- **[ARTIFACT]** SKILL.md:151 含 `2>/dev/null` + `|| echo` + `push skipped`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!/git push origin HEAD 2>\\/dev\\/null \\|\\| echo.*push skipped/.test(c))process.exit(1)"`
- **[ARTIFACT]** 测试文件存在
  Test: `manual:node -e "require('fs').accessSync('tests/skills/harness-planner-push-noise.test.js')"`

## 6. 合并后真实证（手动）

1. brain redeploy（cecelia-runner image 不需重新 build，因为 SKILL.md 是 mount 进容器的）
2. 跑一次 W8 v11 acceptance，看 planner 节点 stdout：
   - 旧：`fatal: could not read Username for 'https://github.com'` 然后整体 exit 128
   - 新：`[harness-planner] push skipped (no creds)` 然后继续走 Step 4 / Step 5
3. brain `task_events` planner 节点 status 应为 success（不再被 push 错误打挂）

## 7. 不做（明确范围）

- ❌ 不引入 push creds 到容器（独立 sprint，不在 Stage 1 范围）
- ❌ 不改其他 harness SKILL 的 push 行为（其他 SKILL 后续 PR 单独评估）
- ❌ 不重设计 sprint-prd.md 传递机制（共享 worktree 仍是 SSOT）
- ❌ 不做 H7/H8/proposer verify push（独立 PR）
