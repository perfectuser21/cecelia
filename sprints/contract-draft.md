# Sprint Contract Draft (Round 1)

**任务 ID**: 14882ce6-7284-434f-a1ba-0cb26a2412d4  
**PRD 来源**: c405c6eb-d41a-4794-9398-f80c163c9121  
**创建时间**: 2026-04-09  
**Sprint 目标**: /dev skill 文档对齐 + Engine pipeline 稳定性修复 + E2E integrity test 套件

---

## Feature 1: /dev skill 文档与实现对齐

**行为描述**:  
运行 `/dev --task-id <id>` 进入 Harness 模式时，SKILL.md 中描述的退出条件与 devloop-check.sh 实际判断逻辑完全一致：Stage 1 明确记录当 sprint-contract.md 不存在时应报错退出（而非静默跳过），Stage 2 明确记录 PR 创建后触发 exit 0 的条件。stop-dev.sh 中的 Harness 模式注释与 SKILL.md 描述一致。

**硬阈值**:
- `packages/engine/skills/dev/SKILL.md` 包含字符串 `sprint-contract.md`（表明 Stage 1 已记录合同读取要求）
- `packages/engine/skills/dev/SKILL.md` 中 Harness 模式段落明确包含 `exit 0` 条件描述（step_2_code done + PR 创建）
- `packages/engine/skills/dev/steps/01-spec.md` 包含对 sprint-contract.md 不存在时的处理说明
- `packages/engine/hooks/stop-dev.sh` 包含 `harness` 关键词注释，且与 SKILL.md 一致

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

# Happy path: 检查 SKILL.md Harness 模式段落含 exit 0 + step_2_code 条件
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/skills/dev/SKILL.md', 'utf8');
  const harnessSection = content.split('Harness 模式')[1] || '';
  if (!harnessSection.includes('step_2_code') || !harnessSection.includes('exit 0'))
    { console.error('FAIL: SKILL.md Harness 模式段落缺少 step_2_code + exit 0 描述'); process.exit(1); }
  console.log('PASS: SKILL.md Harness 段落包含 step_2_code + exit 0 条件');
"

# 边界验证: stop-dev.sh 含 harness 注释
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  if (!content.toLowerCase().includes('harness'))
    { console.error('FAIL: stop-dev.sh 缺少 harness 相关注释'); process.exit(1); }
  console.log('PASS: stop-dev.sh 包含 harness 注释');
"

# 边界验证: 01-spec.md 包含 sprint-contract.md 不存在时的错误处理说明
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/skills/dev/steps/01-spec.md', 'utf8');
  if (!content.includes('sprint-contract.md'))
    { console.error('FAIL: 01-spec.md 缺少 sprint-contract.md 处理说明'); process.exit(1); }
  console.log('PASS: 01-spec.md 包含 sprint-contract.md 引用');
"
```

---

## Feature 2: Engine pipeline 稳定性修复

**行为描述**:  
`devloop-check.sh` 在三个边界场景下行为正确：(1) cleanup_done 误标场景——标准模式下 cleanup_done: true 已写入但实际工作未完成时，devloop-check 返回 exit 2（blocked），而非 exit 0 提前结束；(2) Harness 模式正常完成——step_2_code: done + PR 已创建时，返回 exit 0；(3) pre-push hook 失败时，.dev-mode 文件中的 step 状态不被错误置为 done。

**硬阈值**:
- 非 Harness 模式 + `cleanup_done: true` 写入 + step_2_code 仍为 `done`（正常完成）→ devloop-check 返回 exit 0
- Harness 模式 + `cleanup_done: true`（残留）+ step_2_code 未 done → devloop-check **不**走通用 cleanup_done exit 0，而是检查 step_2_code，返回 exit 2
- Harness 模式 + step_2_code: done + PR URL 存在 → devloop-check 返回 exit 0
- stop-dev.sh 在 Harness 模式 + 上述正常条件下，稳定返回 exit 0（可重复执行 3 次均 exit 0）

**验证命令**:
```bash
# Happy path: Harness 模式 + step_2_code done + PR URL → exit 0
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-001
harness_mode: true
sprint_dir: sprints
step_1_spec: done
step_2_code: done
pr_url: https://github.com/perfectuser21/cecelia/pull/9999
EOF
bash packages/engine/lib/devloop-check.sh "$TMPDIR/.dev-mode" "test-branch" 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "0" ] && echo "PASS: Harness 正常完成场景 exit 0" || (echo "FAIL: 期望 exit 0，实际 $EXIT_CODE"; exit 1)

# 边界验证: Harness 模式 + cleanup_done 残留 + step_2_code pending → exit 2（不走通用路径）
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-002
harness_mode: true
sprint_dir: sprints
step_1_spec: pending
step_2_code: pending
cleanup_done: true
EOF
bash packages/engine/lib/devloop-check.sh "$TMPDIR/.dev-mode" "test-branch" 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "2" ] && echo "PASS: Harness 模式 cleanup_done 残留不走通用早退，返回 exit 2" || (echo "FAIL: 期望 exit 2（harness 跳过通用 cleanup_done），实际 $EXIT_CODE"; exit 1)

# 边界验证: 标准模式 + cleanup_done → exit 0（正常路径不受影响）
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-003
harness_mode: false
step_1_spec: done
step_2_code: done
cleanup_done: true
EOF
bash packages/engine/lib/devloop-check.sh "$TMPDIR/.dev-mode" "test-branch" 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "0" ] && echo "PASS: 标准模式 cleanup_done exit 0 正常" || (echo "FAIL: 期望 exit 0，实际 $EXIT_CODE"; exit 1)

# 边界验证: Harness 模式 + step_2_code done + 无 PR → exit 2
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
task_id: test-task-004
harness_mode: true
sprint_dir: sprints
step_1_spec: done
step_2_code: done
EOF
bash packages/engine/lib/devloop-check.sh "$TMPDIR/.dev-mode" "test-branch" 2>&1
EXIT_CODE=$?
rm -rf "$TMPDIR"
[ "$EXIT_CODE" = "2" ] && echo "PASS: Harness 无 PR 时 exit 2" || (echo "FAIL: 期望 exit 2，实际 $EXIT_CODE"; exit 1)
```

---

## Feature 3: E2E Integrity Test 套件

**行为描述**:  
`packages/engine/tests/e2e/dev-workflow-e2e.test.ts` 新增至少 6 个测试用例，覆盖：(1) 标准模式完整状态机路径（init → Stage 1 done → Stage 2 done → cleanup_done → exit 0），(2) Harness 模式完整路径（harness_mode=true → step_2_code done → PR 创建 → exit 0），(3) cleanup_done 误标恢复场景（Harness 模式下残留 cleanup_done 不触发早退），(4) sprint-contract.md 不存在时 Stage 1 报错，(5) PR 已创建但 step_4_ship 未写的处理，(6) Stop hook 在有/无 .dev-lock 下的退出码。所有新增用例可在无网络/无 GitHub 访问的 CI 环境中运行（全部 mock 或本地 git repo 模拟）。

**硬阈值**:
- `npx vitest run packages/engine/tests/e2e/dev-workflow-e2e.test.ts` 全部通过（0 failures）
- 测试文件新增用例数 ≥ 6（相对当前版本）
- 新增用例中必须含 describe 块或 it 描述包含 "harness" 或 "Harness" 的用例 ≥ 2 个
- 新增用例中必须含覆盖 cleanup_done 误标场景的用例 ≥ 1 个
- 全部测试无网络依赖（不调用 GitHub API、不调用 Brain API）

**验证命令**:
```bash
# Happy path: 全部 E2E 测试通过
cd /Users/administrator/worktrees/cecelia/$(git worktree list --porcelain | grep -A2 "HEAD" | grep "worktree" | head -1 | awk '{print $2}' | xargs basename 2>/dev/null || echo ".") 2>/dev/null || true
npm run test -- --run packages/engine/tests/e2e/dev-workflow-e2e.test.ts 2>&1 | tail -20
# 期望输出: "X passed" 且无 "failed"

# 边界验证: 测试文件包含 Harness 相关用例
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/tests/e2e/dev-workflow-e2e.test.ts', 'utf8');
  const harnessMatches = (content.match(/[Hh]arness/g) || []).length;
  const itMatches = (content.match(/^\s*(it|test)\(/mg) || []).length;
  console.log('Harness 关键词出现次数: ' + harnessMatches);
  console.log('总测试用例数: ' + itMatches);
  if (harnessMatches < 2) { console.error('FAIL: Harness 相关用例不足 2 个'); process.exit(1); }
  if (itMatches < 26) { console.error('FAIL: 总用例数 ' + itMatches + ' 未达到新增 6 个（基线约 20）'); process.exit(1); }
  console.log('PASS: 用例数量和 Harness 覆盖验证通过');
"

# 边界验证: 测试文件含 cleanup_done 误标场景
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/tests/e2e/dev-workflow-e2e.test.ts', 'utf8');
  if (!content.includes('cleanup_done') || !content.includes('harness'))
    { console.error('FAIL: 测试文件缺少 cleanup_done + harness 组合场景'); process.exit(1); }
  console.log('PASS: 测试文件包含 cleanup_done 误标相关用例');
"

# 边界验证: 无网络依赖（不含 fetch/axios/https 真实调用）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/tests/e2e/dev-workflow-e2e.test.ts', 'utf8');
  const hasFetch = /(?:fetch|axios|https?:\/\/api\.github|localhost:5221)/.test(content);
  if (hasFetch) { console.error('FAIL: 测试文件包含网络调用'); process.exit(1); }
  console.log('PASS: 无真实网络调用依赖');
"
```

---

## 合同范围边界

**在合同内**（Generator 负责交付）:
- `packages/engine/skills/dev/SKILL.md` 文档修复（Harness 段落对齐）
- `packages/engine/skills/dev/steps/01-spec.md` + `steps/02-code.md` 描述补全
- `packages/engine/lib/devloop-check.sh` cleanup_done 误标边界逻辑修复
- `packages/engine/hooks/stop-dev.sh` Harness 注释对齐
- `packages/engine/tests/e2e/dev-workflow-e2e.test.ts` 新增 ≥ 6 用例

**不在合同内**:
- Brain 端任务调度逻辑
- GAN 合同协商 skill 改动
- CI workflow 文件改动
- 真实 GitHub API / Brain API 集成测试
- Harness Planner/Generator/Reviewer skill 改动

---

## 整体通过标准

1. Feature 1 验证命令全部 exit 0
2. Feature 2 验证命令全部 exit 0（4 条场景均符合预期退出码）
3. `npx vitest run packages/engine/tests/e2e/dev-workflow-e2e.test.ts` → 0 failures
4. 新增 E2E 用例数 ≥ 6，含 ≥ 2 个 Harness 路径用例 + ≥ 1 个 cleanup_done 误标用例
