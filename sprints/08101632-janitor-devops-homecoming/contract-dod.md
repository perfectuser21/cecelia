# Contract DoD — janitor 归位 Cecelia DevOps

**Sprint**: janitor-devops-homecoming
**Task ID**: 61f7a4dd-4635-4bbd-a80d-eae1e91cbbe5
**环境**: local_api
**日期**: 2026-08-10

---

## DoD 条目

### [BEHAVIOR-01] 步骤8 内联孤儿分支清理，无 branch-gc.sh 引用

**验收类型**: `static:grep + unit:bash`

```manual:bash
# 静态检查：确认无 branch-gc.sh 引用
grep -n "branch-gc.sh" scripts/ops/janitor.sh && echo "FAIL: 仍有 branch-gc.sh 引用" || echo "PASS: 无 branch-gc.sh 引用"

# 静态检查：步骤8 含内联分支清理逻辑
grep -n "git branch -d\|git branch --delete" scripts/ops/janitor.sh && echo "PASS: 内联 git branch 删除" || echo "FAIL: 缺少内联分支删除"

# 单元：构造三条件孤儿分支场景（需在有 git 的工作目录运行）
bash scripts/ops/__tests__/janitor/test-step8-branch.sh
```

**通过标准**：
- grep branch-gc.sh 无输出（exit 1 → ok）
- git branch -d 存在
- 单元测试 exit 0

---

### [BEHAVIOR-02] 步骤9 孤儿 worktree 识别与 Guard A 三查保护

**验收类型**: `unit:bash`

```manual:bash
# 单元：孤儿 worktree 被识别并清理
bash scripts/ops/__tests__/janitor/test-step9-orphan-worktree.sh

# 单元：Guard A 三查逐一保护
bash scripts/ops/__tests__/janitor/test-step9-guard-a.sh
```

**通过标准**：
- 孤儿场景：步骤9 清理目录，退出码 0
- Guard A 场景：三种保护条件各自生效，不删目录，退出码 0

---

### [BEHAVIOR-03] 检测残留 N>0 但 M=0 时显式 FAIL + 退出码非零

**验收类型**: `unit:bash`

```manual:bash
# 单元：强制 M=0 场景下的退出行为
bash scripts/ops/__tests__/janitor/test-fail-explicit.sh

# 静态：FAILED_STEPS 变量存在
grep -n "FAILED_STEPS" scripts/ops/janitor.sh && echo "PASS: FAILED_STEPS 变量存在" || echo "FAIL: 缺失"
```

**通过标准**：
- 日志含 `FAIL` 字样及步骤号
- 退出码为非零
- FAILED_STEPS 变量在脚本中定义

---

### [BEHAVIOR-04] 磁盘超70%时 POST Brain 告警，description 非空且含磁盘水位

**验收类型**: `unit:bash`

```manual:bash
# 单元：mock curl 捕获 POST body 并断言 description
bash scripts/ops/__tests__/janitor/test-brain-alert.sh

# 静态：description 赋值存在且含磁盘百分比引用
grep -n '"description"' scripts/ops/janitor.sh | head -5
grep -n 'used_pct\|disk_pct\|DISK_PCT\|used%' scripts/ops/janitor.sh | head -5
```

**通过标准**：
- POST body 中 description 非空
- description 含磁盘百分比数字（如 "75%" 或 "used: 75"）
- Brain 不可达时脚本不崩溃，退出码正常

---

### [BEHAVIOR-05] --dry-run 模式不执行清理，退出码 0

**验收类型**: `smoke:bash`

```manual:bash
# Smoke：dry-run 模式不删除任何内容，退出码 0
DISK_PCT=60 bash scripts/ops/janitor.sh --mode daily --dry-run
echo "exit code: $?"

# 验证 dry-run 输出含 "清理 0"（或等价）
DISK_PCT=60 bash scripts/ops/janitor.sh --mode daily --dry-run 2>&1 | grep -E "清理\s*0|dry.run" | head -5
```

**通过标准**：
- 退出码 0
- 不实际删除文件或分支
- 输出明确标示 dry-run 模式

---

### [BEHAVIOR-06] 运行结束追加一行到 ~/logs/janitor-ledger.csv

**验收类型**: `unit:bash`

```manual:bash
# 单元：台账追加行数验证
bash scripts/ops/__tests__/janitor/test-ledger.sh
```

**通过标准**：
- 运行后 ledger.csv 行数恰好 +1
- 新行格式匹配 `ts,used_pct,avail_gb,orphan_worktrees,stale_images,failed_steps`
- 日志目录不存在时自动创建

---

### [BEHAVIOR-07] packages/workflows/skills/janitor/ 目录不存在于 git

**验收类型**: `repo:bash`

```manual:bash
# Repo 断言：死化石目录已从 git 中移除
git ls-files packages/workflows/skills/janitor/ | wc -l
# 期望输出: 0

# 文件系统层面也应不存在
[ -d "packages/workflows/skills/janitor" ] && echo "FAIL: 目录仍存在" || echo "PASS: 目录已删除"
```

**通过标准**：
- `git ls-files` 输出为空（行数 = 0）
- 目录不存在于文件系统

---

### [BEHAVIOR-08] CI smoke：bash -n 语法检查 + dry-run 退出码 0

**验收类型**: `ci:bash`

```manual:bash
# 本地预运行（等价 CI 步骤）
bash -n scripts/ops/janitor.sh && echo "PASS: 语法无误" || echo "FAIL: 语法错误"

DISK_PCT=50 bash scripts/ops/janitor.sh --mode daily --dry-run; echo "exit: $?"

# 测试套件全绿
bash scripts/ops/__tests__/janitor/run-all.sh
```

**通过标准**：
- bash -n 通过（exit 0）
- dry-run 退出码 0
- 所有 janitor 测试通过

---

### [BEHAVIOR-09] 既有测试迁入后全绿（回归守护）

**验收类型**: `regression:bash`

```manual:bash
# 迁入后运行迁移的旧测试（etime / 常驻豁免 / audiomxd 相关）
bash scripts/ops/__tests__/janitor/janitor_orphan.test.sh
echo "迁移旧测试 exit: $?"
```

**通过标准**：
- 迁移自 `packages/workflows/skills/janitor/__tests__/janitor_orphan.test.sh` 的测试在新路径通过

---

### [BEHAVIOR-10] Invariant：脚本无硬编码路径/hostname

**验收类型**: `static:grep`

```manual:bash
# 静态检查：无硬编码用户路径
grep -nE '/Users/administrator|/home/[a-z]+/(cecelia|zenithjoy|perfect21)' scripts/ops/janitor.sh \
  && echo "FAIL: 存在硬编码路径" || echo "PASS: 无硬编码路径"

# 静态检查：无硬编码 hostname
grep -n "xian-m4\|mac-mini\|administrator@" scripts/ops/janitor.sh \
  && echo "FAIL: 存在硬编码 hostname" || echo "PASS: 无硬编码 hostname"
```

**通过标准**：两项 grep 均无输出（exit 1 = ok）

---

## 汇总通过标准

| # | 条目 | 类型 | 优先级 |
|---|------|------|--------|
| 01 | 步骤8 无 branch-gc.sh 引用 | static + unit | P0 |
| 02 | 步骤9 孤儿识别 + Guard A | unit | P0 |
| 03 | FAIL 显式化 + 非零退出 | unit | P0 |
| 04 | Brain 告警 description 非空 | unit | P0 |
| 05 | dry-run 不清理退出0 | smoke | P1 |
| 06 | ledger.csv 追加一行 | unit | P1 |
| 07 | janitor 死化石目录删除 | repo | P0 |
| 08 | CI 语法 + dry-run 通过 | ci | P1 |
| 09 | 既有测试迁入全绿 | regression | P1 |
| 10 | 无硬编码路径/hostname | static | P0 |

**BEHAVIOR 条目总计**: 10 条（≥4 满足）
