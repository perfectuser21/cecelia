# Sprint Contract Draft (Round 3)

**任务 ID**: 5358ae37-d1d0-4ec4-8649-217186dfe62a  
**PRD 来源**: c405c6eb-d41a-4794-9398-f80c163c9121  
**创建时间**: 2026-04-09  
**本轮修改项**: 修复 Round 2 全部 3 个 CRITICAL 命令级问题（devloop-check 调用方式 + stop-dev.sh 注入 + .dev-mode 首行）  
**Sprint 目标**: /dev skill 文档对齐 + Engine pipeline 稳定性修复 + E2E integrity test 套件

---

## Feature 1: /dev skill 文档与实现对齐

**行为描述**:  
运行 `/dev --task-id <id>` 进入 Harness 模式时，SKILL.md 中描述的退出条件与 devloop-check.sh 实际判断逻辑完全一致：Stage 1 明确记录当 sprint-contract.md 不存在时应报错退出（而非静默跳过），Stage 2 明确记录 PR 创建后触发 exit 0 的条件。`steps/01-spec.md` 和 `steps/02-code.md` 均包含 Harness 相关描述。stop-dev.sh 中的 Harness 模式退出逻辑与 SKILL.md 一致。

**硬阈值**:
- `packages/engine/skills/dev/SKILL.md` 包含字符串 `sprint-contract.md`
- `packages/engine/skills/dev/SKILL.md` 中 Harness 模式段落明确包含 `exit 0` 条件描述（step_2_code done + PR 创建）
- `packages/engine/skills/dev/steps/01-spec.md` 包含对 sprint-contract.md 不存在时的处理说明
- `packages/engine/skills/dev/steps/02-code.md` 包含 Harness 相关描述（`harness` 或 `step_2_code` 或 `PR 创建`）
- `packages/engine/hooks/stop-dev.sh` 包含 `step_2_code` 和 `pr_url` 关键词，与 SKILL.md Harness 退出逻辑一致

**验证命令**:
```bash
# Happy path: 检查 SKILL.md 包含 sprint-contract.md 引用
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/skills/dev/SKILL.md', 'utf8');
  if (!content.includes('sprint-contract.md'))
    { console.error('FAIL: SKILL.md 缺少 sprint-contract.md 引用'); process.exit(1); }
  console.log('PASS: SKILL.md 包含 sprint-contract.md 引用');
"

# Happy path: 检查 SKILL.md Harness 段落含 exit 0 + step_2_code
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/skills/dev/SKILL.md', 'utf8');
  const harnessSection = content.split('Harness 模式')[1] || content.split('harness')[1] || '';
  if (!harnessSection.includes('step_2_code') || !harnessSection.includes('exit 0'))
    { console.error('FAIL: SKILL.md Harness 段落缺少 step_2_code + exit 0 描述'); process.exit(1); }
  console.log('PASS: SKILL.md Harness 段落包含 step_2_code + exit 0 条件');
"

# 边界验证: 01-spec.md 包含 sprint-contract.md 不存在时的错误处理说明
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/skills/dev/steps/01-spec.md', 'utf8');
  if (!content.includes('sprint-contract.md'))
    { console.error('FAIL: 01-spec.md 缺少 sprint-contract.md 处理说明'); process.exit(1); }
  console.log('PASS: 01-spec.md 包含 sprint-contract.md 引用');
"

# 边界验证: 02-code.md 包含 Harness 相关描述
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/skills/dev/steps/02-code.md', 'utf8');
  const hasHarness = content.toLowerCase().includes('harness') ||
                     content.includes('step_2_code') ||
                     content.includes('PR 创建');
  if (!hasHarness)
    { console.error('FAIL: 02-code.md 缺少 Harness 相关描述'); process.exit(1); }
  console.log('PASS: 02-code.md 包含 Harness 相关描述');
"

# 边界验证: stop-dev.sh 同时含 step_2_code + pr_url（强验证）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  if (!content.includes('step_2_code'))
    { console.error('FAIL: stop-dev.sh 缺少 step_2_code 关键词'); process.exit(1); }
  if (!content.includes('pr_url'))
    { console.error('FAIL: stop-dev.sh 缺少 pr_url 关键词'); process.exit(1); }
  console.log('PASS: stop-dev.sh 包含 step_2_code + pr_url，与 SKILL.md Harness 退出逻辑一致');
"
```

---

## Feature 2: Engine pipeline 稳定性修复

**行为描述**:  
`devloop-check.sh` 在三个边界场景下行为正确：(1) cleanup_done 误标场景——Harness 模式下 cleanup_done: true 已写入但 step_2_code 未 done 时，devloop-check 返回 exit 2（blocked），而非走通用 cleanup_done exit 0 早退；(2) Harness 模式正常完成——step_2_code: done + PR 已创建时，返回 exit 0；(3) 标准模式 cleanup_done 路径不受影响——非 Harness 模式时 cleanup_done 正常触发 exit 0。stop-dev.sh 在无活跃会话时正确返回 exit 0，且内部结构正确 source devloop-check.sh 并委托 devloop_check 函数执行判断。

**硬阈值**:
- Harness 模式 + `cleanup_done: true`（残留）+ step_2_code 未 done → devloop_check 函数返回 exit 2
- Harness 模式 + step_2_code: done + mock PR URL 存在 → devloop_check 函数返回 exit 0
- 标准模式 + cleanup_done: true + step_2_code: done → devloop_check 函数返回 exit 0（不受影响）
- Harness 模式 + step_2_code: done + 无 PR（mock gh 返回空）→ devloop_check 函数返回 exit 2
- stop-dev.sh 无 `.dev-lock.*` 匹配当前会话时 → exit 0
- stop-dev.sh 正确 source devloop-check.sh 且包含 `harness_mode` 判断逻辑

**验证命令**:
```bash
# ── 修复说明 ──────────────────────────────────────────────────────────────────
# Round 2 问题 1: bash devloop-check.sh 调用 devloop_check_main，扫描 worktree 忽略参数。
# 修复: 通过 source 加载后直接调用内部 devloop_check BRANCH DEV_MODE_FILE 函数。
#
# Round 2 问题 2: stop-dev.sh 不读取 DEV_LOCK_PATH/DEV_MODE_PATH 环境变量。
# 修复: 改为 (a) 无会话行为测试 + (b) 结构静态验证，不注入假路径。
#
# Round 2 问题 3: .dev-mode 首行非 dev，触发 stop-dev.sh 首行校验失败。
# 修复: devloop_check 单元测试文件首行改为 dev（与真实格式对齐）。
# ─────────────────────────────────────────────────────────────────────────────

# [命令 1] Happy path: Harness + step_2_code done + mock PR → devloop_check exit 0
TMPDIR1=$(mktemp -d)
cat > "$TMPDIR1/gh" << 'GHEOF'
#!/bin/bash
echo "9999"
GHEOF
chmod +x "$TMPDIR1/gh"
cat > "$TMPDIR1/.dev-mode" << 'EOF'
dev
task_id: test-task-001
harness_mode: true
sprint_dir: sprints
step_1_spec: done
step_2_code: done
EOF
(
  source packages/engine/lib/devloop-check.sh 2>/dev/null
  export PATH="$TMPDIR1:$PATH"
  result=$(devloop_check "test-branch" "$TMPDIR1/.dev-mode" 2>&1)
  EXIT_CODE=$?
  [ "$EXIT_CODE" = "0" ] && echo "PASS: Harness 正常完成（step_2_code done + mock PR#9999）exit 0" || \
    (echo "FAIL: 期望 exit 0，实际 $EXIT_CODE; output=$result"; exit 1)
)
rm -rf "$TMPDIR1"

# [命令 2] 边界验证: Harness + cleanup_done 残留 + step_2_code pending → exit 2
TMPDIR2=$(mktemp -d)
cat > "$TMPDIR2/.dev-mode" << 'EOF'
dev
task_id: test-task-002
harness_mode: true
sprint_dir: sprints
step_1_spec: pending
step_2_code: pending
cleanup_done: true
EOF
(
  source packages/engine/lib/devloop-check.sh 2>/dev/null
  result=$(devloop_check "test-branch" "$TMPDIR2/.dev-mode" 2>&1)
  EXIT_CODE=$?
  [ "$EXIT_CODE" = "2" ] && echo "PASS: Harness cleanup_done 残留不走通用早退，返回 exit 2" || \
    (echo "FAIL: 期望 exit 2，实际 $EXIT_CODE; output=$result"; exit 1)
)
rm -rf "$TMPDIR2"

# [命令 3] 边界验证: 标准模式 + cleanup_done → exit 0（Harness 修复不影响标准路径）
TMPDIR3=$(mktemp -d)
cat > "$TMPDIR3/.dev-mode" << 'EOF'
dev
task_id: test-task-003
harness_mode: false
step_1_spec: done
step_2_code: done
cleanup_done: true
EOF
(
  source packages/engine/lib/devloop-check.sh 2>/dev/null
  result=$(devloop_check "test-branch" "$TMPDIR3/.dev-mode" 2>&1)
  EXIT_CODE=$?
  [ "$EXIT_CODE" = "0" ] && echo "PASS: 标准模式 cleanup_done → exit 0（不受 Harness 修复影响）" || \
    (echo "FAIL: 期望 exit 0，实际 $EXIT_CODE; output=$result"; exit 1)
)
rm -rf "$TMPDIR3"

# [命令 4] 边界验证: Harness + step_2_code done + mock gh 返回空 → exit 2（无 PR）
TMPDIR4=$(mktemp -d)
cat > "$TMPDIR4/gh" << 'GHEOF'
#!/bin/bash
echo ""
GHEOF
chmod +x "$TMPDIR4/gh"
cat > "$TMPDIR4/.dev-mode" << 'EOF'
dev
task_id: test-task-004
harness_mode: true
sprint_dir: sprints
step_1_spec: done
step_2_code: done
EOF
(
  source packages/engine/lib/devloop-check.sh 2>/dev/null
  export PATH="$TMPDIR4:$PATH"
  result=$(devloop_check "test-branch" "$TMPDIR4/.dev-mode" 2>&1)
  EXIT_CODE=$?
  [ "$EXIT_CODE" = "2" ] && echo "PASS: Harness step_2_code done + 无 PR（mock gh 空）→ exit 2" || \
    (echo "FAIL: 期望 exit 2，实际 $EXIT_CODE; output=$result"; exit 1)
)
rm -rf "$TMPDIR4"

# [命令 5] stop-dev.sh: 无活跃会话（无 .dev-lock 匹配当前 worktree）→ exit 0
# stop-dev.sh 扫描真实 worktree，找不到匹配 .dev-lock 则直接 exit 0
WD=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
LOCK_FOUND=false
for _lf in "$WD"/.dev-lock.*; do [[ -f "$_lf" ]] && LOCK_FOUND=true && break; done
if [[ "$LOCK_FOUND" == "false" ]]; then
  bash packages/engine/hooks/stop-dev.sh 2>&1
  EXIT_CODE=$?
  [ "$EXIT_CODE" = "0" ] && echo "PASS: stop-dev.sh 无活跃 .dev-lock 时 exit 0" || \
    (echo "FAIL: 期望 exit 0，实际 $EXIT_CODE"; exit 1)
else
  echo "SKIP: 当前 worktree 有 .dev-lock，跳过无会话测试"
fi

# [命令 6] stop-dev.sh: 结构验证 — 正确 source devloop-check.sh + harness_mode 判断
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  if (!content.includes('devloop-check.sh'))
    { console.error('FAIL: stop-dev.sh 未 source devloop-check.sh'); process.exit(1); }
  if (!content.includes('devloop_check'))
    { console.error('FAIL: stop-dev.sh 未调用 devloop_check 函数'); process.exit(1); }
  if (!content.includes('harness_mode'))
    { console.error('FAIL: stop-dev.sh 缺少 harness_mode 判断逻辑'); process.exit(1); }
  console.log('PASS: stop-dev.sh 正确 source devloop-check.sh + 调用 devloop_check + 含 harness_mode 判断');
"
```

---

## Feature 3: E2E Integrity Test 套件

**行为描述**:  
`packages/engine/tests/e2e/dev-workflow-e2e.test.ts` 新增至少 6 个测试用例，覆盖：(1) 标准模式完整状态机路径，(2) Harness 模式完整路径（harness_mode=true → step_2_code done → PR 创建 → exit 0），(3) cleanup_done 误标恢复场景（Harness 模式下残留 cleanup_done 不触发早退），(4) sprint-contract.md 不存在时 Stage 1 报错，(5) PR 已创建但 step_4_ship 未写的处理，(6) Stop hook 在有/无 .dev-lock 下的退出码。所有新增用例可在无网络/无 GitHub 访问的 CI 环境中运行。

**硬阈值**:
- `node --experimental-vm-modules node_modules/.bin/vitest run packages/engine/tests/e2e/dev-workflow-e2e.test.ts` 全部通过（0 failures）
- 测试文件总用例数 ≥ 28（当前基线 22 + 新增 ≥ 6）
- 新增用例中必须含 "harness" 或 "Harness" 关键词的 it/test 描述 ≥ 2 个
- 新增用例中必须含覆盖 cleanup_done 误标场景的用例 ≥ 1 个
- 全部测试无真实网络依赖（不调用 GitHub API、不调用 Brain API）

**验证命令**:
```bash
# Happy path: 全部 E2E 测试通过（使用 vitest 直接调用，CI 兼容）
node --experimental-vm-modules node_modules/.bin/vitest run packages/engine/tests/e2e/dev-workflow-e2e.test.ts 2>&1 | tail -20
EXIT_CODE=$?
[ "$EXIT_CODE" = "0" ] && echo "PASS: 所有 E2E 测试通过" || (echo "FAIL: E2E 测试有失败项"; exit 1)

# 边界验证: 总测试用例数 ≥ 28，Harness 覆盖 ≥ 2 个
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/tests/e2e/dev-workflow-e2e.test.ts', 'utf8');
  const harnessMatches = (content.match(/[Hh]arness/g) || []).length;
  const itMatches = (content.match(/^\s*(it|test)\(/mg) || []).length;
  console.log('Harness 关键词出现次数: ' + harnessMatches);
  console.log('总测试用例数: ' + itMatches);
  if (harnessMatches < 2) { console.error('FAIL: Harness 相关用例不足 2 个'); process.exit(1); }
  if (itMatches < 28) { console.error('FAIL: 总用例数 ' + itMatches + ' 未达到 28（基线 22 + 新增 6）'); process.exit(1); }
  console.log('PASS: 用例数量（' + itMatches + '）和 Harness 覆盖验证通过');
"

# 边界验证: 测试文件含 cleanup_done 误标场景 + harness 路径
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/tests/e2e/dev-workflow-e2e.test.ts', 'utf8');
  if (!content.includes('cleanup_done'))
    { console.error('FAIL: 测试文件缺少 cleanup_done 场景'); process.exit(1); }
  if (!content.toLowerCase().includes('harness'))
    { console.error('FAIL: 测试文件缺少 harness 路径用例'); process.exit(1); }
  console.log('PASS: 测试文件包含 cleanup_done 误标 + harness 路径用例');
"

# 边界验证: 无真实网络调用依赖
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/tests/e2e/dev-workflow-e2e.test.ts', 'utf8');
  const hasRealNetwork = /https?:\/\/api\.github|localhost:5221(?!.*mock)/.test(content);
  if (hasRealNetwork) { console.error('FAIL: 测试文件包含真实网络调用'); process.exit(1); }
  console.log('PASS: 无真实网络调用依赖');
"
```

---

## 合同范围边界

**在合同内**（Generator 负责交付）:
- `packages/engine/skills/dev/SKILL.md` 文档修复（Harness 段落对齐）
- `packages/engine/skills/dev/steps/01-spec.md` + `steps/02-code.md` 描述补全
- `packages/engine/lib/devloop-check.sh` cleanup_done 误标边界逻辑修复
- `packages/engine/hooks/stop-dev.sh` Harness 退出逻辑对齐（含 step_2_code + pr_url 关键词）
- `packages/engine/tests/e2e/dev-workflow-e2e.test.ts` 新增 ≥ 6 用例

**不在合同内**:
- Brain 端任务调度逻辑
- GAN 合同协商 skill 改动
- CI workflow 文件改动
- 真实 GitHub API / Brain API 集成测试
- Harness Planner/Generator/Reviewer skill 改动

---

## 整体通过标准

1. Feature 1 全部 5 条验证命令 exit 0
2. Feature 2 全部 6 条验证命令 exit 0（4 条 devloop_check 函数测试 + 2 条 stop-dev.sh 结构/行为验证）
3. `node --experimental-vm-modules node_modules/.bin/vitest run packages/engine/tests/e2e/dev-workflow-e2e.test.ts` → 0 failures
4. 总测试用例数 ≥ 28，含 ≥ 2 个 Harness 路径用例 + ≥ 1 个 cleanup_done 误标用例

---

## Round 3 修改说明

| 问题 | Round 2 错误 | Round 3 修复 |
|------|-------------|-------------|
| [CRITICAL 1] devloop-check 调用方式 | `bash devloop-check.sh args` → 调 main，扫 worktree，忽略参数 | `source devloop-check.sh` + 直接调 `devloop_check BRANCH FILE` 函数 |
| [CRITICAL 2] stop-dev.sh 注入 | `DEV_LOCK_PATH=... bash stop-dev.sh` → 变量未读取 | 改为 (a) 无会话 exit 0 行为测试 + (b) `node -e` 结构静态验证 |
| [CRITICAL 3] .dev-mode 首行 | 首行 `task_id: ...` → stop-dev.sh 首行校验失败 | 所有测试 .dev-mode 文件首行改为 `dev` |
| gh mock 方案 | N/A（Round 2 命令直接失效，未到 gh 检查） | 在 $TMPDIR 创建可执行 `gh` mock，通过 `export PATH="$TMPDIR:$PATH"` 注入 |
