# Sprint Contract Draft (Round 4)

task_id: bf49c063-7dff-46a6-981d-c46ae2f31862
planner_task_id: 702c9dbf-b67b-497d-b58b-6d6c753b4436
date: 2026-04-09
revision_from: 263a86f6-f45b-4faf-8adb-2df615fb8283

## 修订说明（Round 3 → Round 4）

基于 Evaluator 反馈（review_task: b52ce6fb）修复以下 4 个问题：

**必改项（阻断）**：
1. **[F2 不稳定点1 路径错误]**: `packages/engine/scripts/devgate/check-dod-mapping.cjs` 不存在 → 改为实际存在文件 `scripts/devgate/check-manual-cmd-whitelist.cjs`
2. **[F4 路径错误]**: `.github/workflows/engine-ci.yml` 不存在 → 改为 `.github/workflows/ci.yml`，检查 `e2e-integrity-check` 关键词

**必改项（高）**：
3. **[F4 核心行为未验证]**: 新增实际运行脚本并统计 PASS 数量 ≥5 的验证命令

**必改项（中）**：
4. **[F1 场景5/F2 不稳定点3 路径含糊]**: `check-learning-format.sh` 3路径遍历 → 单一路径 `packages/engine/ci/scripts/check-learning-format.sh`（明确注明此文件需新建）

**可选改进（同步采纳）**：
5. **[F1 场景2 AND 逻辑偏弱]**: 移除 `!c.includes('echo')` 弱条件（几乎所有 shell 脚本都含 echo），仅保留 FAIL/ERROR/失败 关键词检查

---

## Feature 1: /dev Skill 行为审查与加固

**行为描述**:
当 `/dev` skill 在以下 5 个边界场景执行时，系统必须输出明确的错误信息（而非静默退出或无输出），并给出可操作的修复提示：
1. `.dev-lock` 残留（已有同名锁文件）
2. hook 执行失败（pre-push / branch-protect 返回非零）
3. DoD 存在未勾选条目（`- [ ]` 未改为 `- [x]`）
4. worktree 创建冲突（目标路径已存在）
5. Learning 同名文件 diff context 陷阱（`### 根本原因` 出现在 diff context 而非新增行）

**硬阈值**:
- 每个场景错误消息中必须包含 `ERROR:` 或 `FAIL:` 前缀
- `.dev-lock` 残留场景必须输出清理命令提示（含锁文件路径）
- DoD 未勾选场景必须列出所有 `- [ ]` 未通过项（≥1 条）
- hook 失败场景必须输出 hook 名称与失败原因（pre-push.sh 须含错误输出逻辑）
- Learning 同名陷阱场景必须提示 "请创建新文件" 而非 "修改原文件"
- worktree 路径冲突场景必须输出含明确冲突词（`冲突`/`already exists`/`conflict`）的错误提示

**验证命令**:
```bash
# 场景1: stop-dev.sh 包含 .dev-lock 残留处理逻辑（_collect_search_dirs 函数）
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  if (!c.includes('_collect_search_dirs')) throw new Error('FAIL: 缺少 worktree 扫描函数');
  if (!c.includes('.dev-lock')) throw new Error('FAIL: 未处理 .dev-lock 残留');
  console.log('PASS: stop-dev.sh 包含 worktree 扫描和锁处理逻辑');
"

# 场景2: pre-push.sh 必须包含失败关键词（不依赖 echo 弱条件）
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/pre-push.sh', 'utf8');
  if (!c.includes('FAIL') && !c.includes('ERROR') && !c.includes('失败')) {
    throw new Error('FAIL: pre-push.sh 未包含失败提示关键词（FAIL/ERROR/失败）');
  }
  console.log('PASS: pre-push.sh 包含失败提示关键词');
"

# 场景3: branch-protect.sh 包含 DoD 未勾选检测逻辑
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/branch-protect.sh', 'utf8');
  if (!c.includes('[ ]') && !c.includes('unchecked') && !c.includes('DoD') && !c.includes('dod')) {
    throw new Error('FAIL: branch-protect.sh 未检查 DoD 勾选状态');
  }
  console.log('PASS: branch-protect.sh 包含 DoD 验证逻辑');
"

# 场景4: /dev skill 或 worktree 相关脚本包含精确的路径冲突错误提示（非泛用 exist）
node -e "
  const fs = require('fs');
  const candidates = [
    'packages/engine/skills/dev/SKILL.md',
    'packages/engine/lib/devloop-check.sh',
    'packages/engine/hooks/stop-dev.sh'
  ];
  let found = false;
  for (const p of candidates) {
    try {
      const c = fs.readFileSync(p, 'utf8');
      if (
        c.includes('冲突') ||
        c.includes('already exists') ||
        c.includes('conflict') ||
        (c.includes('worktree add') && c.includes('ERROR')) ||
        (c.includes('FAIL') && (c.includes('路径') || c.includes('conflict')))
      ) {
        console.log('PASS: ' + p + ' 包含 worktree 路径冲突的精确错误处理');
        found = true;
        break;
      }
    } catch(e) {}
  }
  if (!found) throw new Error('FAIL: 未在任何 /dev 相关文件中找到精确的 worktree 路径冲突错误处理（需含 冲突/already exists/conflict）');
"

# 场景5: Learning Format Gate 单一路径（packages/engine/ci/scripts/check-learning-format.sh，需新建）
# 此文件当前不存在，Generator 需在此路径创建
node -e "
  const fs = require('fs');
  const target = 'packages/engine/ci/scripts/check-learning-format.sh';
  try {
    fs.accessSync(target);
  } catch(e) {
    throw new Error('FAIL: ' + target + ' 不存在（Generator 需新建此文件）');
  }
  const c = fs.readFileSync(target, 'utf8');
  if (!c.includes('根本原因')) {
    throw new Error('FAIL: ' + target + ' 未检测 ### 根本原因 章节');
  }
  if (!c.includes('per-branch') && !c.includes('新文件') && !c.includes('create new')) {
    throw new Error('FAIL: ' + target + ' 未包含同名文件陷阱的修复提示（per-branch/新文件/create new）');
  }
  console.log('PASS: ' + target + ' 同时检测根本原因章节 + 同名文件陷阱修复提示');
"
```

---

## Feature 2: Engine Pipeline 不稳定点修复

**行为描述**:
以下 4 个已知不稳定点在触发时必须产生明确的结构化错误输出，使开发者能够快速定位根因：
1. `check-manual-cmd-whitelist.cjs` 的 `manual:` 命令白名单校验给出具体违规命令名
2. `branch-protect.sh` 在 worktree 环境下正确定位 PRD/DoD 文件
3. Learning Format Gate 对同名文件 diff context 陷阱给出明确提示（"新文件"/"per-branch"）
4. `stop.sh` / `stop-dev.sh` 正确扫描所有活跃 worktree 中的 `.dev-lock`

**硬阈值**:
- `scripts/devgate/check-manual-cmd-whitelist.cjs` 遇到不在白名单的 `manual:` 命令时，错误信息必须包含具体命令名（如 `grep`、`ls`）
- `branch-protect.sh` 在 worktree 子目录下运行时必须能找到正确的 PRD 文件
- Learning Format Gate（`packages/engine/ci/scripts/check-learning-format.sh`，需新建）失败信息必须包含 "新文件" 或 "per-branch" 的修复指引
- `stop.sh` 必须使用 `git worktree list` 扫描（不能只检查当前目录）

**验证命令**:
```bash
# 不稳定点1: check-manual-cmd-whitelist.cjs 白名单含具体命令名 + 错误信息引用命令名变量
# 注意：实际文件路径为 scripts/devgate/check-manual-cmd-whitelist.cjs
node -e "
  const c = require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs', 'utf8');
  if (!c.includes('manual:')) throw new Error('FAIL: check-manual-cmd-whitelist.cjs 未处理 manual: 命令');
  if (!c.includes('whitelist') && !c.includes('allowed') && !c.includes('ALLOWED')) {
    throw new Error('FAIL: 未找到白名单定义（whitelist/allowed/ALLOWED）');
  }
  // 验证白名单包含具体命令名（node/curl/bash 必须在白名单中）
  if (!c.includes('node') || !c.includes('curl') || !c.includes('bash')) {
    throw new Error('FAIL: 白名单未包含必要命令名（node/curl/bash）');
  }
  // 验证错误信息拼接逻辑引用了命令名变量（而不是硬编码）
  if (!c.includes('command') && !c.includes('cmd') && !c.includes('命令')) {
    throw new Error('FAIL: 错误信息逻辑未引用命令名变量（command/cmd/命令），具体命令名无法出现在报错中');
  }
  console.log('PASS: check-manual-cmd-whitelist.cjs 白名单含具体命令名，错误信息含命令引用');
"

# 不稳定点1 边界验证: 错误信息模板中命令名可变（非硬编码单一命令）
node -e "
  const c = require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs', 'utf8');
  const hasDynamic = /\\\$\{[^}]*(cmd|command|命令)[^}]*\}|\+ *(cmd|command)|format.*cmd|cmd.*message/.test(c);
  const hasLiteral = /error.*manual:.*\\\$/.test(c) || c.includes('不在白名单') || c.includes('未被允许') || c.includes('not allowed');
  if (!hasDynamic && !hasLiteral) {
    throw new Error('FAIL: 错误信息未动态拼接命令名，错误报告将不含具体违规命令');
  }
  console.log('PASS: 错误信息支持动态命令名引用');
"

# 不稳定点2: branch-protect.sh 包含 worktree 路径检测逻辑
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/branch-protect.sh', 'utf8');
  if (!c.includes('worktree') && !c.includes('GIT_DIR') && !c.includes('toplevel')) {
    throw new Error('FAIL: branch-protect.sh 未处理 worktree 路径');
  }
  console.log('PASS: branch-protect.sh 包含 worktree 路径检测');
"

# 不稳定点3: Learning Format Gate 单一路径（需新建文件），同时检测根本原因 + 新文件修复提示
# 合同规定 Generator 必须在 packages/engine/ci/scripts/check-learning-format.sh 创建此文件
node -e "
  const target = 'packages/engine/ci/scripts/check-learning-format.sh';
  try {
    require('fs').accessSync(target);
  } catch(e) {
    throw new Error('FAIL: ' + target + ' 不存在（Generator 需在此路径新建文件）');
  }
  const c = require('fs').readFileSync(target, 'utf8');
  if (!c.includes('根本原因')) {
    throw new Error('FAIL: ' + target + ' 未检测 ### 根本原因 章节');
  }
  if (!c.includes('per-branch') && !c.includes('新文件') && !c.includes('create new')) {
    throw new Error('FAIL: ' + target + ' 缺少同名文件 diff context 陷阱的修复提示（per-branch/新文件/create new）');
  }
  console.log('PASS: ' + target + ' 同时检测根本原因章节 + diff context 陷阱修复提示');
"

# 不稳定点4: stop-dev.sh 扫描所有 worktree（PR #1189/#1190 修复验证）
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  if (!c.includes('worktree list') && !c.includes('_collect_search_dirs')) {
    throw new Error('FAIL: stop-dev.sh 未使用 worktree list 扫描');
  }
  console.log('PASS: stop-dev.sh 使用 worktree 全扫描');
"
```

---

## Feature 3: CI/CD 环节评估与补充

**行为描述**:
系统产出一份 CI/CD gate 覆盖范围评估报告，明确列出：
- 现有 L1/L2/L3/L4 gate 各自覆盖的检测点
- 仅在本地 hook 层检测、CI 未覆盖的盲区（≥1 条）
- 每个盲区是否建议补充 CI gate 及理由

**硬阈值**:
- 评估报告必须存在于 `sprints/ci-coverage-assessment.md`（或同等路径）
- 报告必须包含 `## 覆盖项` 或等价章节（≥3 个已确认覆盖点）
- 报告必须包含 `## 盲区` 或等价章节（≥1 个建议补充项）
- 每个建议项必须包含 "建议" 和 "理由"

**验证命令**:
```bash
# Happy path: 评估报告文件存在
node -e "
  require('fs').accessSync('sprints/ci-coverage-assessment.md');
  const c = require('fs').readFileSync('sprints/ci-coverage-assessment.md', 'utf8');
  if (c.length < 200) throw new Error('FAIL: 报告内容过短（<200字符）');
  console.log('PASS: ci-coverage-assessment.md 存在，长度=' + c.length);
"

# Happy path: 报告包含覆盖项章节（≥3 个 L 级 gate 独立提及）
node -e "
  const c = require('fs').readFileSync('sprints/ci-coverage-assessment.md', 'utf8');
  const lGates = (c.match(/\bL[1-4]\b/g) || []).length;
  if (lGates < 3) throw new Error('FAIL: 报告中 L1-L4 gate 独立提及次数=' + lGates + '，期望>=3');
  console.log('PASS: 报告提及 L gate 次数=' + lGates);
"

# 失败路径: 报告包含盲区识别（含"盲区"或"未覆盖"关键词）
node -e "
  const c = require('fs').readFileSync('sprints/ci-coverage-assessment.md', 'utf8');
  if (!c.includes('盲区') && !c.includes('未覆盖') && !c.includes('gap') && !c.includes('blind')) {
    throw new Error('FAIL: 报告缺少盲区分析章节');
  }
  console.log('PASS: 报告包含盲区识别内容');
"
```

---

## Feature 4: E2E Integrity Test 设计与实现

**行为描述**:
`packages/engine/scripts/e2e-integrity-check.sh`（或 `.cjs`）在独立运行时：
- 检测 worktree 创建能力（git worktree add 是否可用）
- 检测所有 hook 文件可执行性（hooks/ 目录下所有 .sh 文件）
- 运行 DoD 格式校验（检查 `- [ ]` 检测逻辑）
- 运行 Learning 格式校验（检查 `### 根本原因` 章节检测）
- 运行 branch-protect 检测逻辑（PRD/DoD 文件存在性）
- 每项输出 `PASS: <说明>` 或 `FAIL: <原因>`，脚本整体 exit code 反映所有项目通过状态
- 脚本无需 Brain 在线、无需真实 push 即可运行

同时，`.github/workflows/ci.yml` 的 engine-tests job 中包含调用此脚本的检测步骤（含 `e2e-integrity-check` 关键词）。

**硬阈值**:
- `packages/engine/scripts/e2e-integrity-check.sh`（或 `.cjs`）文件存在且可执行
- 脚本实际运行输出中包含 `PASS:` 字符串（≥5 项检测点通过）
- 脚本在无 Brain 服务时仍能运行（不依赖 curl localhost:5221）
- `.github/workflows/ci.yml` 中包含 `e2e-integrity-check` 关键词（Generator 需在 engine-tests job 新增此步骤）

**验证命令**:
```bash
# Happy path: e2e-integrity-check 脚本文件存在
node -e "
  const fs = require('fs');
  const candidates = [
    'packages/engine/scripts/e2e-integrity-check.sh',
    'packages/engine/scripts/e2e-integrity-check.cjs',
    'packages/engine/scripts/e2e-integrity-check.mjs'
  ];
  const found = candidates.find(p => { try { fs.accessSync(p); return true; } catch(e) { return false; } });
  if (!found) throw new Error('FAIL: e2e-integrity-check 脚本不存在（检查了3个路径）');
  console.log('PASS: 找到 ' + found);
"

# Happy path: e2e-integrity-check 可执行
bash -c '
  SCRIPT=""
  for f in packages/engine/scripts/e2e-integrity-check.sh packages/engine/scripts/e2e-integrity-check.cjs; do
    [ -f "$f" ] && { SCRIPT="$f"; break; }
  done
  [ -z "$SCRIPT" ] && { echo "FAIL: 脚本不存在"; exit 1; }
  [ -x "$SCRIPT" ] && echo "PASS: $SCRIPT 可执行" || (echo "FAIL: $SCRIPT 不可执行（缺少 chmod +x）"; exit 1)
'

# Happy path: 实际运行脚本，验证输出 PASS 数量 ≥5（核心行为验证）
bash -c '
  SCRIPT=""
  for f in packages/engine/scripts/e2e-integrity-check.sh packages/engine/scripts/e2e-integrity-check.cjs; do
    [ -f "$f" ] && { SCRIPT="$f"; break; }
  done
  [ -z "$SCRIPT" ] && { echo "FAIL: 脚本不存在"; exit 1; }
  OUTPUT=$(bash "$SCRIPT" 2>&1)
  PASS_COUNT=$(echo "$OUTPUT" | grep -c "^PASS:")
  [ "$PASS_COUNT" -ge 5 ] && echo "PASS: 脚本输出 $PASS_COUNT 个检测点（>=5）" || (echo "FAIL: PASS 数量=$PASS_COUNT，期望>=5"; echo "--- 脚本输出 ---"; echo "$OUTPUT"; exit 1)
'

# Happy path: ci.yml 包含 e2e-integrity-check（Generator 需在 engine-tests job 新增此步骤）
node -e "
  const c = require('fs').readFileSync('.github/workflows/ci.yml', 'utf8');
  if (!c.includes('e2e-integrity-check')) {
    throw new Error('FAIL: .github/workflows/ci.yml 未包含 e2e-integrity-check，Generator 需在 engine-tests job 新增此步骤');
  }
  console.log('PASS: ci.yml 包含 e2e-integrity-check 引用');
"

# 失败路径: e2e-integrity-check 脚本不依赖 Brain API（无 localhost:5221）
bash -c '
  SCRIPT=""
  for f in packages/engine/scripts/e2e-integrity-check.sh packages/engine/scripts/e2e-integrity-check.cjs; do
    [ -f "$f" ] && { SCRIPT="$f"; break; }
  done
  [ -z "$SCRIPT" ] && { echo "SKIP: 脚本不存在"; exit 0; }
  grep -q "localhost:5221" "$SCRIPT" && (echo "FAIL: 脚本依赖 Brain API（localhost:5221）违反独立运行要求"; exit 1) || echo "PASS: 脚本不依赖 Brain API"
'
```

---

## 整体通过标准

| Feature | 最低通过条件 |
|---------|-------------|
| F1: /dev 加固 | ≥5 个边界场景有明确错误提示；场景5需在单一路径 `packages/engine/ci/scripts/check-learning-format.sh` 新建文件 |
| F2: 不稳定点修复 | 不稳定点1用 `scripts/devgate/check-manual-cmd-whitelist.cjs`（已存在文件）；不稳定点3用 `packages/engine/ci/scripts/check-learning-format.sh`（需新建） |
| F3: CI 评估 | 评估报告存在，含 ≥3 覆盖项 + ≥1 盲区建议 |
| F4: E2E 测试 | 脚本存在可执行 + 实际运行输出 PASS ≥5 + `.github/workflows/ci.yml` 含 `e2e-integrity-check` |

## 文件新建要求（Generator 必须创建）

| 文件路径 | 说明 |
|---------|------|
| `packages/engine/ci/scripts/check-learning-format.sh` | Learning Format Gate 脚本（当前不存在，需新建） |
| `packages/engine/scripts/e2e-integrity-check.sh` | E2E 完整性检测脚本（需新建，≥5 PASS 检测点） |
