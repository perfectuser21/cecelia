# Contract Draft — janitor 归位 Cecelia DevOps

**Sprint**: janitor-devops-homecoming
**Task ID**: 61f7a4dd-4635-4bbd-a80d-eae1e91cbbe5
**Journey ID**: 91c17939-225c-4491-92f3-67d8b0ace4d9
**环境**: local_api（本地 bash + localhost:5221）
**草稿日期**: 2026-08-10

---

## 范围确认

本合同覆盖以下交付物：

1. `scripts/ops/janitor.sh` — 从 zenithjoy-skills 迁入并修复五处失效
2. `scripts/ops/__tests__/janitor/` — 测试套件落位（CI 接入）
3. `packages/workflows/skills/janitor/` — 整目录删除（死化石）
4. CI 接入（engine-ci.yml 或等价 CI 配置）

---

## 行为合同（BEHAVIOR 条目）

### [BEHAVIOR-01] 步骤8 内联孤儿分支清理，无 branch-gc.sh 引用

**前提**：本地存在已合并到 main 的分支（`cp-xxx`），且无 open PR，且不被任何 worktree 引用

**断言**：
- janitor.sh 步骤8 输出"检测 N / 清理 M"（N>0 时 M>0）
- 清理动作为 `git branch -d` 直接内联，脚本中不调用 branch-gc.sh
- 三条件未全满足时（有 open PR / 有 worktree 引用 / 未合并）→ 不删，不记 FAIL

**验证方式**：grep 断言 + 行为模拟（见 contract-dod.md BEHAVIOR-01）

---

### [BEHAVIOR-02] 步骤9 孤儿 worktree 识别与清理，Guard A 三查保护活 worktree

**前提A（孤儿路径）**：`~/worktrees/cecelia/xxx` 或 `~/worktrees/zenithjoy/xxx` 目录存在，但 `git worktree list --porcelain` 中无对应条目，mtime > 24h，且无 open PR

**断言A**：步骤9 识别该孤儿并删除，输出"检测 1 / 清理 1"，退出码 0

**前提B（Guard A 保护）**：worktree 目录满足以下任一：git worktree list 在册 / 目录有未提交改动 / 含 .dev-lock* 文件

**断言B**：步骤9 识别但不删除，不记 FAIL，退出码 0

**验证方式**：构造测试目录 + mock git worktree list（见 contract-dod.md BEHAVIOR-02）

---

### [BEHAVIOR-03] 检测到残留（N>0 但 M=0）时显式 FAIL + 退出码非零

**前提**：某步骤检测到 N>0 个残留，但清理执行后 M=0（清理失败）

**断言**：
- 日志输出包含 `FAIL` 字样及步骤号
- 脚本最终退出码为非零（FAILED_STEPS 变量非空）
- 不允许 warning 降级处理

**验证方式**：构造强制 M=0 场景验证退出行为（见 contract-dod.md BEHAVIOR-03）

---

### [BEHAVIOR-04] 磁盘超70%时 POST Brain 告警，description 非空且含磁盘水位

**前提**：宿主磁盘使用率超过 70%（或通过 DISK_PCT 环境变量注入模拟值）

**断言**：
- 向 `localhost:5221/api/brain/tasks` POST 告警任务
- POST body 中 `description` 字段非空字符串
- `description` 包含磁盘百分比数字（如 `75%` 或 `75`）
- Brain 不可达时降级为本地 log，不阻断主流程（退出码仍为正常值）

**验证方式**：mock curl + 捕获 POST body 断言（见 contract-dod.md BEHAVIOR-04）

---

### [BEHAVIOR-05] --dry-run 模式仅输出检测数，不执行清理，退出码 0

**前提**：调用 `janitor.sh --dry-run` 或 `janitor.sh --mode daily --dry-run`

**断言**：
- 所有步骤输出"检测 N / 清理 0"（清理数始终为 0）
- 不实际删除任何文件、分支、worktree
- 退出码为 0（即使 N>0）

**验证方式**：dry-run 模式 smoke 测试（见 contract-dod.md BEHAVIOR-05）

---

### [BEHAVIOR-06] 运行结束追加一行到 ~/logs/janitor-ledger.csv

**前提**：任一模式运行完成（日志目录不存在时自动创建）

**断言**：
- `~/logs/janitor-ledger.csv` 追加恰好一行
- 格式符合：`ts,used_pct,avail_gb,orphan_worktrees,stale_images,failed_steps`
- 台账写入失败不影响主流程退出码

**验证方式**：运行前后行数差断言（见 contract-dod.md BEHAVIOR-06）

---

### [BEHAVIOR-07] packages/workflows/skills/janitor/ 目录不存在（死化石清除）

**前提**：本 PR 合并后

**断言**：
- `packages/workflows/skills/janitor/` 目录在 git 中不存在
- `git ls-files packages/workflows/skills/janitor/` 输出为空

**验证方式**：repo 状态断言（见 contract-dod.md BEHAVIOR-07）

---

### [BEHAVIOR-08] CI smoke：--mode daily --dry-run 在沙箱中退出码 0

**前提**：CI 环境（GitHub Actions）执行

**断言**：
- `bash scripts/ops/janitor.sh --mode daily --dry-run` 退出码为 0
- 无 bash 语法错误（`bash -n scripts/ops/janitor.sh` 通过）

**验证方式**：CI job 步骤（见 contract-dod.md BEHAVIOR-08）

---

## 累积 FR 守护（不得回退）

本 sprint 为首次 sprint（journey 91c17939 golden-paths 为空），无历史 FR 守护要求。

---

## Invariant 守护

| Invariant | 验证点 |
|-----------|--------|
| 禁写死路径/hostname | grep 断言脚本无 `/Users/administrator` 硬编码 |
| FAIL 显式化 | BEHAVIOR-03 覆盖 |
| Guard A 三查 | BEHAVIOR-02B 覆盖 |
| 告警 description 非空 | BEHAVIOR-04 断言 |
| 合同验证命令实跑 | 所有 manual:bash 命令均在本地执行过 |

---

## E2E 验收

```bash
#!/usr/bin/env bash
# E2E 验收脚本 — janitor-devops-homecoming
# 执行环境: 本地（local_api），需要 localhost:5221 可达
# 使用方式: bash sprints/08101632-janitor-devops-homecoming/tests/e2e-acceptance.sh

set -euo pipefail

PASS=0
FAIL=0
JANITOR="scripts/ops/janitor.sh"

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

# ── E2E-1: 脚本存在且可执行 ──────────────────────────────────────────────────
[ -f "$JANITOR" ] && ok "janitor.sh 存在于 scripts/ops/" || fail "janitor.sh 不存在"
[ -x "$JANITOR" ] && ok "janitor.sh 可执行" || fail "janitor.sh 不可执行"

# ── E2E-2: 无 branch-gc.sh 引用 ──────────────────────────────────────────────
if ! grep -q "branch-gc.sh" "$JANITOR"; then
  ok "步骤8 无 branch-gc.sh 引用（内联实现）"
else
  fail "步骤8 仍引用 branch-gc.sh，违反 PRD"
fi

# ── E2E-3: 无硬编码路径 ──────────────────────────────────────────────────────
if ! grep -qE '/Users/administrator|/home/[a-z]+/cecelia' "$JANITOR"; then
  ok "脚本无硬编码用户路径"
else
  fail "脚本含硬编码路径（违反 Invariant: 禁写死环境假设）"
fi

# ── E2E-4: Guard A 三查关键词存在 ────────────────────────────────────────────
if grep -q "git status" "$JANITOR" && grep -q ".dev-lock" "$JANITOR"; then
  ok "Guard A 三查实现存在（git status + .dev-lock 检查）"
else
  fail "Guard A 三查实现不完整"
fi

# ── E2E-5: FAIL 显式化关键词存在 ─────────────────────────────────────────────
if grep -q "FAILED_STEPS" "$JANITOR" || grep -q "FAIL" "$JANITOR"; then
  ok "FAIL 显式化变量存在"
else
  fail "FAIL 显式化变量缺失"
fi

# ── E2E-6: 台账 ledger 写入存在 ──────────────────────────────────────────────
if grep -q "janitor-ledger.csv" "$JANITOR"; then
  ok "台账 janitor-ledger.csv 写入逻辑存在"
else
  fail "台账写入逻辑缺失"
fi

# ── E2E-7: 告警 description 非空断言 ─────────────────────────────────────────
if grep -q '"description"' "$JANITOR" || grep -q "'description'" "$JANITOR"; then
  ok "Brain 告警 description 字段赋值存在"
else
  fail "Brain 告警 description 字段缺失"
fi

# ── E2E-8: dry-run 模式 ───────────────────────────────────────────────────────
if grep -q "dry.run\|dry_run\|DRY_RUN" "$JANITOR"; then
  ok "dry-run 模式实现存在"
else
  fail "dry-run 模式实现缺失"
fi

# ── E2E-9: 死化石目录已删除 ──────────────────────────────────────────────────
if [ ! -d "packages/workflows/skills/janitor" ] || \
   ! git -C . ls-files packages/workflows/skills/janitor/ | grep -q .; then
  ok "packages/workflows/skills/janitor/ 已从 git 中删除（死化石清除）"
else
  fail "packages/workflows/skills/janitor/ 仍存在于 git（未清除死化石）"
fi

# ── E2E-10: 语法检查 ──────────────────────────────────────────────────────────
if bash -n "$JANITOR" 2>/dev/null; then
  ok "janitor.sh bash 语法检查通过"
else
  fail "janitor.sh 存在 bash 语法错误"
fi

echo ""
echo "═══════════════════════════════════"
echo "E2E 结果: $PASS 通过 / $FAIL 失败"
echo "═══════════════════════════════════"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

---

## 假设确认

- [ASSUMPTION: gh auth 在 CI 沙箱中已配置，步骤8 `gh pr list` 调用可用] → 若 gh auth 不可用，步骤8 跳过孤儿分支清理并记 WARN（不记 FAIL）
- [ASSUMPTION: 源文件从 zenithjoy-skills 获取，版本 v4.0 约 26KB] → 实际迁入后以 `scripts/ops/janitor.sh` 为 SSOT，版本号更新
- [ASSUMPTION: `~/logs/` 路径在宿主机存在或可创建] → 不存在时自动 mkdir -p，不影响主流程

---

## 不在范围内（明确排除）

- preview-reaper.sh（PR#4759 已修，勿动）
- cron 调度时间变更
- `~/bin/janitor.sh` 软链切换（合并后宿主动作）
- zenithjoy-skills 旧目录删除（合并后跟进）
- memory_stream 保留策略
