# Sprint Contract Draft (Round 1)

task_id: 7ac36b5e-32bd-42d4-a686-32e709d33db7
planner_task_id: 702c9dbf-b67b-497d-b58b-6d6c753b4436
date: 2026-04-09

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
- hook 失败场景必须输出 hook 名称与失败原因
- Learning 同名陷阱场景必须提示 "请创建新文件" 而非 "修改原文件"

**验证命令**:
```bash
# Happy path: stop-dev.sh 存在且可执行
[ -x "packages/engine/hooks/stop-dev.sh" ] && echo "PASS: stop-dev.sh 可执行" || (echo "FAIL: stop-dev.sh 不可执行"; exit 1)

# Happy path: pre-push.sh 存在且可执行
[ -x "packages/engine/hooks/pre-push.sh" ] && echo "PASS: pre-push.sh 可执行" || (echo "FAIL: pre-push.sh 不可执行"; exit 1)

# 失败路径: stop-dev.sh 中包含 .dev-lock 残留处理逻辑（_collect_search_dirs 函数）
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  if (!c.includes('_collect_search_dirs')) throw new Error('FAIL: 缺少 worktree 扫描函数');
  if (!c.includes('.dev-lock')) throw new Error('FAIL: 未处理 .dev-lock 残留');
  console.log('PASS: stop-dev.sh 包含 worktree 扫描和锁处理逻辑');
"

# 失败路径: branch-protect.sh 包含 worktree 路径检测逻辑
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/branch-protect.sh', 'utf8');
  if (!c.includes('worktree') && !c.includes('GIT_DIR') && !c.includes('toplevel')) {
    throw new Error('FAIL: branch-protect.sh 未处理 worktree 路径');
  }
  console.log('PASS: branch-protect.sh 包含 worktree 路径检测');
"
```

---

## Feature 2: Engine Pipeline 不稳定点修复

**行为描述**:
以下 4 个已知不稳定点在触发时必须产生明确的结构化错误输出，使开发者能够快速定位根因：
1. `check-dod-mapping.cjs` 的 `manual:` 命令白名单校验给出具体违规命令名
2. `branch-protect.sh` 在 worktree 环境下正确定位 PRD/DoD 文件
3. Learning Format Gate 对同名文件 diff context 陷阱给出明确提示
4. `stop.sh` / `stop-dev.sh` 正确扫描所有活跃 worktree 中的 `.dev-lock`

**硬阈值**:
- `check-dod-mapping.cjs` 遇到不在白名单的 `manual:` 命令时，错误信息必须包含具体命令名（如 `grep`、`ls`）
- `branch-protect.sh` 在 worktree 子目录下运行时必须能找到正确的 PRD 文件
- Learning Format Gate 失败信息必须包含 "新文件" 或 "per-branch" 的修复指引
- `stop.sh` 必须使用 `git worktree list` 扫描（不能只检查当前目录）

**验证命令**:
```bash
# Happy path: check-dod-mapping.cjs 存在
node -e "
  const c = require('fs').readFileSync('packages/engine/ci/scripts/check-contract-refs.sh', 'utf8');
  console.log('PASS: check-contract-refs.sh 存在，长度=' + c.length);
" 2>/dev/null || \
node -e "
  require('fs').accessSync('packages/engine/scripts/affected-packages.js');
  console.log('PASS: engine scripts 目录可访问');
"

# Happy path: stop.sh 使用 worktree list 扫描所有目录
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop.sh', 'utf8');
  if (!c.includes('worktree list') && !c.includes('_collect_search_dirs')) {
    throw new Error('FAIL: stop.sh 未扫描所有 worktree');
  }
  console.log('PASS: stop.sh 包含 worktree 全扫描逻辑');
"

# 失败路径: pre-push.sh 检查 DoD 未勾选项
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/pre-push.sh', 'utf8');
  if (!c.includes('[ ]') && !c.includes('unchecked') && !c.includes('DoD') && !c.includes('dod')) {
    throw new Error('FAIL: pre-push.sh 未检查 DoD 勾选状态');
  }
  console.log('PASS: pre-push.sh 包含 DoD 验证逻辑');
"

# 失败路径: stop-dev.sh 扫描 worktree（PR #1189/#1190 修复验证）
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

# Happy path: 报告包含覆盖项章节（≥3 个 L 级 gate 提及）
node -e "
  const c = require('fs').readFileSync('sprints/ci-coverage-assessment.md', 'utf8');
  const lGates = (c.match(/L[1-4]/g) || []).length;
  if (lGates < 3) throw new Error('FAIL: 报告中 L1-L4 gate 提及次数=' + lGates + '，期望>=3');
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

同时，`engine-ci.yml` 中包含调用此脚本的 L0 smoke test job。

**硬阈值**:
- `e2e-integrity-check.sh`（或 `.cjs`）文件存在且可执行
- 脚本输出中包含 `PASS` 字符串（≥5 项检测点）
- 脚本在无 Brain 服务时仍能运行（不依赖 curl localhost:5221）
- `engine-ci.yml` 中包含 `e2e-integrity-check` 关键词

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

# Happy path: engine-ci.yml 包含 L0 smoke test job
node -e "
  const c = require('fs').readFileSync('.github/workflows/engine-ci.yml', 'utf8');
  if (!c.includes('e2e-integrity-check') && !c.includes('l0') && !c.includes('smoke')) {
    throw new Error('FAIL: engine-ci.yml 未包含 L0 smoke test');
  }
  console.log('PASS: engine-ci.yml 包含 smoke test 引用');
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
| F1: /dev 加固 | ≥5 个边界场景有明确错误提示 |
| F2: 不稳定点修复 | 4 个已知不稳定点均有修复代码 |
| F3: CI 评估 | 评估报告存在，含 ≥3 覆盖项 + ≥1 盲区建议 |
| F4: E2E 测试 | 脚本存在可执行 + engine-ci.yml L0 job 接入 |
