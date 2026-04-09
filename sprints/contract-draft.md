# Sprint Contract Draft (Round 2)

**任务 ID**: 39fd84e8-7fd9-4ebc-89f6-8fe9c2ce684e  
**PRD 来源**: c405c6eb-d41a-4794-9398-f80c163c9121  
**创建时间**: 2026-04-09  
**本轮修改项**: 修复 Round 1 全部 4 个 REVISION 问题（参数顺序、stop-dev.sh 缺失命令、阈值错误、02-code.md 缺失命令）  
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

# 边界验证: 02-code.md 包含 Harness 相关描述（修复项4）
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

# 边界验证: stop-dev.sh 同时含 step_2_code + pr_url（强验证，替代弱 harness 字符串检查）
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
`devloop-check.sh` 在三个边界场景下行为正确：(1) cleanup_done 误标场景——Harness 模式下 cleanup_done: true 已写入但 step_2_code 未 done 时，devloop-check 返回 exit 2（blocked），而非走通用 cleanup_done exit 0 早退；(2) Harness 模式正常完成——step_2_code: done + PR 已创建时，返回 exit 0；(3) 标准模式 cleanup_done 路径不受影响——非 Harness 模式时 cleanup_done 正常触发 exit 0。stop-dev.sh 在 Harness 模式正常完成条件下，稳定返回 exit 0（可重复执行 3 次均 exit 0）。

**硬阈值**:
- Harness 模式 + `cleanup_done: true`（残留）+ step_2_code 未 done → devloop-check 返回 exit 2
- Harness 模式 + step_2_code: done + PR URL 存在 → devloop-check 返回 exit 0
- 标准模式 + cleanup_done: true + step_2_code: done → devloop-check 返回 exit 0（不受影响）
- Harness 模式 + step_2_code: done + 无 PR URL → devloop-check 返回 exit 2
- stop-dev.sh 在 Harness 模式 + .dev-lock 存在 + harness_mode=true 条件下，连续执行 3 次均返回 exit 0

**验证命令**:
```bash
# Happy path: Harness 模式 + step_2_code done + PR URL → exit 0
# 注意: devloop_check 函数签名为 BRANCH DEV_MODE_FILE（$1=branch, $2=dev_mode_file）
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-001
harness_mode: true
sprint_dir: sprints
step_1_spec: done
step_2_code: done
pr_url: https://github.com/perfectuser21/cecelia/pull/9999
EOF
bash packages/engine/lib/devloop-check.sh "test-branch" "$TMPDIR/.dev-mode" 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "0" ] && echo "PASS: Harness 正常完成场景 exit 0" || (echo "FAIL: 期望 exit 0，实际 $EXIT_CODE"; exit 1)

# 边界验证: Harness 模式 + cleanup_done 残留 + step_2_code pending → exit 2
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-002
harness_mode: true
sprint_dir: sprints
step_1_spec: pending
step_2_code: pending
cleanup_done: true
EOF
bash packages/engine/lib/devloop-check.sh "test-branch" "$TMPDIR/.dev-mode" 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "2" ] && echo "PASS: Harness 模式 cleanup_done 残留不走通用早退，返回 exit 2" || (echo "FAIL: 期望 exit 2，实际 $EXIT_CODE"; exit 1)

# 边界验证: 标准模式 + cleanup_done → exit 0（正常路径不受影响）
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-003
harness_mode: false
step_1_spec: done
step_2_code: done
cleanup_done: true
EOF
bash packages/engine/lib/devloop-check.sh "test-branch" "$TMPDIR/.dev-mode" 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "0" ] && echo "PASS: 标准模式 cleanup_done exit 0 正常" || (echo "FAIL: 期望 exit 0，实际 $EXIT_CODE"; exit 1)

# 边界验证: Harness 模式 + step_2_code done + 无 PR URL → exit 2
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-004
harness_mode: true
sprint_dir: sprints
step_1_spec: done
step_2_code: done
EOF
bash packages/engine/lib/devloop-check.sh "test-branch" "$TMPDIR/.dev-mode" 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "2" ] && echo "PASS: Harness 无 PR URL 时 exit 2" || (echo "FAIL: 期望 exit 2，实际 $EXIT_CODE"; exit 1)

# 新增: stop-dev.sh 在 Harness 模式正常完成场景下 exit 0（修复项2：补充 stop-dev.sh 验证）
TMPDIR=$(mktemp -d)
DEVLOCK="$TMPDIR/.dev-lock"
DEVMODE="$TMPDIR/.dev-mode"
touch "$DEVLOCK"
cat > "$DEVMODE" << 'EOF'
task_id: test-task-stop-001
harness_mode: true
sprint_dir: sprints
step_1_spec: done
step_2_code: done
pr_url: https://github.com/perfectuser21/cecelia/pull/9999
cleanup_done: true
EOF
# 设置环境变量让 stop-dev.sh 找到测试用的 .dev-lock 和 .dev-mode
DEV_LOCK_PATH="$DEVLOCK" DEV_MODE_PATH="$DEVMODE" \
  bash packages/engine/hooks/stop-dev.sh 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "0" ] && echo "PASS: stop-dev.sh Harness 正常完成场景 exit 0（第1次）" || (echo "FAIL: 期望 exit 0，实际 $EXIT_CODE"; exit 1)

# stop-dev.sh 可重复执行 3 次均 exit 0（幂等性）
PASS_COUNT=0
for i in 1 2 3; do
  TMPDIR=$(mktemp -d)
  cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-stop-repeat
harness_mode: true
sprint_dir: sprints
step_2_code: done
pr_url: https://github.com/perfectuser21/cecelia/pull/9999
cleanup_done: true
EOF
  touch "$TMPDIR/.dev-lock"
  DEV_LOCK_PATH="$TMPDIR/.dev-lock" DEV_MODE_PATH="$TMPDIR/.dev-mode" \
    bash packages/engine/hooks/stop-dev.sh 2>&1
  [ "$?" = "0" ] && PASS_COUNT=$((PASS_COUNT+1))
  rm -rf "$TMPDIR"
done
[ "$PASS_COUNT" = "3" ] && echo "PASS: stop-dev.sh 连续 3 次均 exit 0" || (echo "FAIL: stop-dev.sh 3次中只有 $PASS_COUNT 次 exit 0"; exit 1)
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

# 边界验证: 总测试用例数 ≥ 28（基线 22 + 新增 ≥ 6，修复项3：阈值从 26 改为 28）
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

# 边界验证: 测试文件含 cleanup_done 误标场景
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
2. Feature 2 全部 6 条验证命令 exit 0（4 条 devloop-check 场景 + 2 条 stop-dev.sh 幂等）
3. `node --experimental-vm-modules node_modules/.bin/vitest run packages/engine/tests/e2e/dev-workflow-e2e.test.ts` → 0 failures
4. 总测试用例数 ≥ 28，含 ≥ 2 个 Harness 路径用例 + ≥ 1 个 cleanup_done 误标用例

---

## Round 2 修改说明

| 问题 | 修复内容 |
|------|----------|
| [修复项1] Feature 2 参数顺序 | 所有 devloop-check.sh 调用改为 `"test-branch" "$TMPDIR/.dev-mode"` |
| [修复项2] stop-dev.sh 缺失验证 | Feature 2 新增 stop-dev.sh 2 条验证命令（单次 + 3次幂等） |
| [修复项3] Feature 3 阈值 | `< 26` 改为 `< 28`（基线 22 + 新增要求 6 = 28） |
| [修复项4] 02-code.md 缺失 | Feature 1 新增 02-code.md 内容验证命令 |
| [可选改进] stop-dev.sh 弱验证 | 改为检查 `step_2_code` + `pr_url` 关键词（强验证） |
| [可选改进] 测试命令不一致 | 统一用 `node --experimental-vm-modules node_modules/.bin/vitest run` |
