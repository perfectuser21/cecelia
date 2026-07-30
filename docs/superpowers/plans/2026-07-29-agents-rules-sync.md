# AGENTS.md 硬规则摘要 + drift-guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Codex（原生只读 AGENTS.md）补齐一份和 `.claude/CLAUDE.md` 同步的硬规则摘要，并用脚本+CI 保证两边不再漂移。

**Architecture:** 单一 SSOT（`.claude/CLAUDE.md` 里的 `HARD_RULES` marker 区块），`AGENTS.md` 里放逐字同步的副本；`scripts/check-agents-rules-sync.sh` 做纯文本 diff 校验；`scripts/smoke/*-smoke.sh` glob 已被 CI 的 `dashboard-staging-gate-smoke` job 无条件收编，新增 smoke 脚本零 ci.yml 改动即可接入 CI。

**Tech Stack:** Bash（set -euo pipefail）、sed 提取 marker 区块、mktemp 隔离测试 fixture。

## Global Constraints

- 不改动 `packages/brain` 任何运行时代码，不碰 `orchestrator/` 目录（P0 `4a530430` 占用中）
- Conventional commit 格式（`feat(docs): ...` / `test(ci): ...`）
- TDD 顺序：commit 1 = 失败的 smoke test，commit 2 = 实现让它通过
- 不新建 ci.yml job；复用 `dashboard-staging-gate-smoke` 已有的 `scripts/smoke/*-smoke.sh` glob

---

### Task 1: 失败的 smoke test（先写会失败的测试）

**Files:**
- Create: `scripts/smoke/check-agents-rules-sync-smoke.sh`

**Interfaces:**
- Consumes: 无（本任务只写测试，被测脚本 `scripts/check-agents-rules-sync.sh` 尚不存在）
- Produces: 供 Task 2 验证用的 smoke 脚本，接口约定：`bash scripts/check-agents-rules-sync.sh [file_a] [file_b]`，退出码 0=同步，非 0=不同步且 stderr/stdout 含"不一致"字样

- [ ] **Step 1: 写 smoke 脚本**

```bash
cat > scripts/smoke/check-agents-rules-sync-smoke.sh << 'SMOKE_EOF'
#!/usr/bin/env bash
# Smoke: scripts/check-agents-rules-sync.sh 必须能检测出硬规则摘要漂移，
# 且真实仓库文件（.claude/CLAUDE.md / AGENTS.md）当前必须是同步状态。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/check-agents-rules-sync.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Smoke: check-agents-rules-sync.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ ! -f "$SCRIPT" ]]; then
  echo "❌ $SCRIPT 不存在"
  exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# 场景 1：两份内容一致 → 必须 exit 0
cat > "$WORKDIR/a-sync.md" <<'EOF'
noise before
<!-- HARD_RULES:BEGIN -->
1. 规则一
2. 规则二
<!-- HARD_RULES:END -->
noise after
EOF
cp "$WORKDIR/a-sync.md" "$WORKDIR/b-sync.md"

if bash "$SCRIPT" "$WORKDIR/a-sync.md" "$WORKDIR/b-sync.md" > "$WORKDIR/sync.log" 2>&1; then
  echo "✅ 场景1通过：同步状态下退出码 0"
else
  echo "❌ 场景1失败：同步状态下不应该报错"
  cat "$WORKDIR/sync.log"
  exit 1
fi

# 场景 2：制造漂移 → 必须非零退出 + 报错信息里出现"不一致"提示
cat > "$WORKDIR/a-drift.md" <<'EOF'
<!-- HARD_RULES:BEGIN -->
1. 规则一
2. 规则二
<!-- HARD_RULES:END -->
EOF
cat > "$WORKDIR/b-drift.md" <<'EOF'
<!-- HARD_RULES:BEGIN -->
1. 规则一（被人手动改过，没同步）
2. 规则二
<!-- HARD_RULES:END -->
EOF

set +e
bash "$SCRIPT" "$WORKDIR/a-drift.md" "$WORKDIR/b-drift.md" > "$WORKDIR/drift.log" 2>&1
DRIFT_EXIT=$?
set -e

if [[ "$DRIFT_EXIT" -eq 0 ]]; then
  echo "❌ 场景2失败：制造了漂移，脚本却返回 0"
  cat "$WORKDIR/drift.log"
  exit 1
fi
if ! grep -q "不一致" "$WORKDIR/drift.log"; then
  echo "❌ 场景2失败：报错信息里没有可读的'不一致'提示"
  cat "$WORKDIR/drift.log"
  exit 1
fi
echo "✅ 场景2通过：漂移场景正确报错（exit $DRIFT_EXIT），报错信息含'不一致'提示"

# 场景 3：真实仓库文件必须是同步状态（这是本 smoke 存在的真正目的）
if bash "$SCRIPT" "$REPO_ROOT/.claude/CLAUDE.md" "$REPO_ROOT/AGENTS.md" > "$WORKDIR/real.log" 2>&1; then
  echo "✅ 场景3通过：真实 .claude/CLAUDE.md 与 AGENTS.md 硬规则摘要同步"
else
  echo "❌ 场景3失败：真实仓库文件硬规则摘要已漂移"
  cat "$WORKDIR/real.log"
  exit 1
fi

echo "✅ 全部场景通过"
SMOKE_EOF
chmod +x scripts/smoke/check-agents-rules-sync-smoke.sh
```

- [ ] **Step 2: 运行确认失败**

Run: `bash scripts/smoke/check-agents-rules-sync-smoke.sh`
Expected: FAIL，输出 `❌ .../scripts/check-agents-rules-sync.sh 不存在`

- [ ] **Step 3: Commit（红色状态）**

```bash
git add scripts/smoke/check-agents-rules-sync-smoke.sh
git commit -m "test(ci): 添加 AGENTS.md/CLAUDE.md 硬规则同步 smoke（先红后绿）"
```

---

### Task 2: 实现 drift-guard 脚本 + 硬规则摘要内容（让测试变绿）

**Files:**
- Create: `scripts/check-agents-rules-sync.sh`
- Modify: `.claude/CLAUDE.md`（追加 section，不改动现有内容）
- Modify: `AGENTS.md`（追加 section，不改动现有内容）

**Interfaces:**
- Consumes: Task 1 的 smoke 脚本（`scripts/smoke/check-agents-rules-sync-smoke.sh`），会被本任务的实现文件满足
- Produces: `scripts/check-agents-rules-sync.sh [file_a] [file_b]`（默认 `.claude/CLAUDE.md` `AGENTS.md`），退出码 0/1

- [ ] **Step 1: 实现 check-agents-rules-sync.sh**

```bash
cat > scripts/check-agents-rules-sync.sh << 'SCRIPT_EOF'
#!/usr/bin/env bash
# 校验 .claude/CLAUDE.md 与 AGENTS.md 里的「硬规则摘要」section（HARD_RULES marker 之间）是否一致。
# 背景：codex exec 纯任务提示词下只原生读 AGENTS.md 不读 CLAUDE.md（07-29 实测），
# 需要一份同步副本兜底，此脚本防止两边手改后漂移。
# 用法：check-agents-rules-sync.sh [file_a] [file_b]（默认 .claude/CLAUDE.md 和 AGENTS.md）
set -euo pipefail

FILE_A="${1:-.claude/CLAUDE.md}"
FILE_B="${2:-AGENTS.md}"

extract_block() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "❌ 文件不存在: $file" >&2
    exit 1
  fi
  sed -n '/<!-- HARD_RULES:BEGIN -->/,/<!-- HARD_RULES:END -->/p' "$file"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AGENTS.md / CLAUDE.md 硬规则同步检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

BLOCK_A=$(extract_block "$FILE_A")
BLOCK_B=$(extract_block "$FILE_B")

if [[ -z "$BLOCK_A" ]]; then
  echo "❌ $FILE_A 里没有找到 HARD_RULES marker" >&2
  exit 1
fi
if [[ -z "$BLOCK_B" ]]; then
  echo "❌ $FILE_B 里没有找到 HARD_RULES marker" >&2
  exit 1
fi

if [[ "$BLOCK_A" == "$BLOCK_B" ]]; then
  echo "✅ $FILE_A 与 $FILE_B 的硬规则摘要一致"
  exit 0
else
  echo "❌ $FILE_A 与 $FILE_B 的硬规则摘要不一致，请同步（以 $FILE_A 为准复制进 $FILE_B）："
  diff <(echo "$BLOCK_A") <(echo "$BLOCK_B") || true
  exit 1
fi
SCRIPT_EOF
chmod +x scripts/check-agents-rules-sync.sh
```

- [ ] **Step 2: 在 .claude/CLAUDE.md 追加硬规则摘要 section**

在 `.claude/CLAUDE.md` 文件末尾（`## 7. 禁止事项` 之后、`## 7. Brain 知识查询工具` 之前，或直接追加到文件最末）插入以下内容：

```markdown

## 硬规则摘要（Hard Rules Summary — Codex/Grok 同步锚点）

> 本 section 是给非 Claude Code 执行体（Codex/Grok 等）的行为约束兜底摘要。
> 07-29 实测：codex exec 纯任务提示词下只原生读 AGENTS.md，不读本文件——AGENTS.md 里必须有一份同步副本。
> 与 `AGENTS.md` 里同名 section 逐字同步，由 `scripts/check-agents-rules-sync.sh` 校验，禁止手动改一边不改另一边。

<!-- HARD_RULES:BEGIN -->
### 语言
1. 所有输出必须使用简体中文，禁止日语、韩语或其他语言。

### 分支与提交
2. 绝对禁止 `git push origin main`。
3. 绝对禁止在 main 分支上 `git add` / `git commit`。
4. 分支策略：`cp-*` / `feature/*` 分支开发 → PR → main，不允许绕过。
5. push 后必须等待 CI 完成，禁止用 `gh pr merge --admin` 绕过 CI 检查。
6. commit message 遵循 Conventional Commits 格式（feat/fix/docs/chore/test/refactor/build/ci/style/perf/revert）。

### 危险操作确认
7. 网络配置变更、分区操作、`docker rm -f` 生产容器、数据库 schema 直改、`ufw deny 22` 等危险操作，必须先告知风险并获得明确确认后才能执行。

### Brain 改动门禁（DevGate）
8. 改动 `packages/brain` 代码前必须依次通过：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs`。
9. DevGate 校验失败时禁止继续编码，必须先修复校验问题。
10. 不允许凭记忆/猜测编造架构、跳过 DevGate、引用已废弃的旧路径。

### 任务追踪
11. 改代码走 `/dev` 流程（bug 修复 / 小改动 / 大功能三条路径）。
12. 任务生命周期状态通过 Brain API（`localhost:5221`）管理，不使用临时 ad-hoc 状态记录。

### 决策留痕
13. 用户做出的实质性决策必须写入 Brain `decisions` 表，不放进 memory 或 CLAUDE.md。

### 代码规范
14. 禁止创建 `*New.tsx` / `*Old.tsx` / `*Backup.*` 等临时版本文件。
15. 禁止在仓库根目录堆放临时脚本。
16. 不主动创建 markdown 文档，除非用户明确要求。
17. 单文件超过 500 行需拆分；同一段逻辑重复出现 3 次以上需提取为函数。
18. 完成任务后必须清理调试用的 `console.log`、注释掉的死代码、未使用的 import。

### Bug 修复流程
19. 修 bug 前必须先写一个能复现该 bug 的 failing test。
20. 该 failing test 修复后必须永久保留在 CI 里作为回归测试，不能删除。

### 验收标准
21. 功能验收必须验证真实产出效果（例如：视频类功能用 ffprobe 验证真实视频/音频流；数据写入类功能查数据库确认记录存在），不能仅凭"测试通过"这类空泛断言收尾。

### 凭据管理
22. API Key / Token / 密钥等凭据一律不提交进 git；`.gitignore` 必须排除 `.env` / `*.key` / `*.pem` 等敏感文件模式。

### AI 自我检测
23. 当输出中出现"手动/您可以/暂时禁用/等待用户/绕过/临时/跳过/忽略/先不管/稍后"这类推诿性措辞时，必须停下重新分析并自动解决问题，不能把困难推给用户。
<!-- HARD_RULES:END -->
```

- [ ] **Step 3: 在 AGENTS.md 追加同名 section（逐字复制 Step 2 的 marker 区块内容）**

在根目录 `AGENTS.md` 文件末尾追加：

```markdown

## 硬规则摘要（Hard Rules Summary — 与 .claude/CLAUDE.md 同步）

> 这是 `.claude/CLAUDE.md` 里同名 section 的逐字同步副本，专为 Codex 等只原生读 AGENTS.md 的执行体准备。
> 由 `scripts/check-agents-rules-sync.sh` 校验一致性，改动前必须先改 `.claude/CLAUDE.md` 再同步过来。

<!-- HARD_RULES:BEGIN -->
（此处内容与 Step 2 `.claude/CLAUDE.md` 里 `<!-- HARD_RULES:BEGIN -->` 到 `<!-- HARD_RULES:END -->` 之间的文本逐字相同，第 1-23 条）
<!-- HARD_RULES:END -->
```

> 实现时直接把 Step 2 里 marker 之间的完整文本复制粘贴到这里，一字不差。

- [ ] **Step 4: 运行 smoke 确认变绿**

Run: `bash scripts/smoke/check-agents-rules-sync-smoke.sh`
Expected: PASS，`✅ 全部场景通过`

- [ ] **Step 5: 本地验证 CI glob 会捡到新 smoke（不改 ci.yml）**

Run: `ls scripts/smoke/*.sh`
Expected: 输出包含 `check-agents-rules-sync-smoke.sh`（`dashboard-staging-gate-smoke` job 的 `for s in scripts/smoke/*-smoke.sh` 会自动跑到它，无需改 ci.yml）

- [ ] **Step 6: Commit（绿色状态）**

```bash
git add scripts/check-agents-rules-sync.sh .claude/CLAUDE.md AGENTS.md
git commit -m "feat(docs): AGENTS.md 补齐硬规则摘要 + drift-guard 脚本

codex exec 纯任务提示词下只原生读 AGENTS.md 不读 CLAUDE.md（07-29 实测），
AGENTS.md 四个月未更新不含任何行为约束。新增同步 HARD_RULES 区块 +
check-agents-rules-sync.sh 防止两边漂移，接入既有 scripts/smoke/ glob。"
```

---

## Self-Review 记录

- **Spec coverage**：设计文档三点（摘要内容/AGENTS.md同步/drift-guard+CI）均有对应 task 覆盖；CI 接入复用现有 glob，不新增 job（比设计文档草稿更简单，已在 brainstorming 阶段的 Research Subagent 审批范围内——CI 接入方式属实现细节）
- **Placeholder scan**：Step 3 的"逐字复制"提示不是本计划的占位符缺陷——AGENTS.md 的实际内容必须与 Step 2 CLAUDE.md 里已经写全的 23 条文本逐字一致，执行者按 Step 2 的完整文本复制即可，无需自己编造
- **Type consistency**：`check-agents-rules-sync.sh` 的调用签名（`[file_a] [file_b]`，默认 `.claude/CLAUDE.md` `AGENTS.md`）在 smoke 脚本和实现脚本里保持一致
