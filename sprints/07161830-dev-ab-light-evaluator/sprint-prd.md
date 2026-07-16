# Sprint PRD — 建制W5: /dev 轻量 Evaluator——改行为必有真跑复核

- task_id: 4950d174-cfcd-4a81-b078-0d695a78f103
- sprint_dir: sprints/07161830-dev-ab-light-evaluator
- 挂靠决策: 145014a4③（改行为必有 evaluator 真跑复核）
- 日期: 2026-07-16

---

## Invariant 约束

| ID | 约束 |
|----|------|
| INV-01 | 纯文档/配置改动（DoD 无 `[BEHAVIOR]` 条目）必须豁免并留痕 skip 原因，不得阻断 push |
| INV-02 | 轻量验收步不 spawn 独立 session、不调 judge，只原地真跑命令 |
| INV-03 | 每条 `[BEHAVIOR]` 的 `manual:`/`tests/` 命令必须逐条真执行，记录 exit_code + 输出尾 5 行 |
| INV-04 | 任一命令 exit_code ≠ 0 → 整步 FAIL，阻断 push，不允许忽略或继续 |
| INV-05 | 记录文件写入 `.dev-mode/` 或 sprint 目录内的 `verify-record.json`，不写标准输出即消失 |
| INV-06 | engine 版本 bump 必须 5 文件同步（package.json / CHANGELOG / SKILL.md / feature-registry / 版本声明文件）|
| INV-07 | devgate `check-dod-purity.cjs` 脚本须能识别新步骤存在（兼容，不报误错）|
| INV-08 | 新步骤文件必须被主 `SKILL.md` 引用（grep 断言可验证）|

---

## 累积 FR

**前置已有（不重新实现）：**
- FR-BASE-01: `check-dod-purity.cjs` 已支持 `[BEHAVIOR]` 条目识别
- FR-BASE-02: `/dev` SKILL.md 现有 12 步结构（push 前有 DevGate 卡点）

**本 sprint 新增：**
- **FR-01**：新增 step 文件 `packages/engine/skills/dev/steps/light-evaluator.md`，描述轻量验收步骤定义、豁免规则、记录格式
- **FR-02**：轻量验收逻辑——扫描当前 sprint 的 `contract-dod-ws*.md`，提取所有 `[BEHAVIOR]` 条目的 `Test:` 字段命令，逐条执行，记录 `{cmd, exit_code, tail5, timestamp}` 到 `verify-record.json`
- **FR-03**：豁免路径——若 DoD 文件不含任何 `[BEHAVIOR]` 条目，写 `{skipped: true, reason: "no [BEHAVIOR] entries", files: [...]}` 到记录文件并通过
- **FR-04**：`SKILL.md` 在 push 前步骤中插入轻量验收引用（第 11 步附近，git push 之前）
- **FR-05**：engine 版本从 `19.4.4` → `19.5.0`，5 文件同步 bump
- **FR-06**：feature-registry changelog 新增本次能力条目
- **FR-07**：`check-dod-purity.cjs`（或同目录新脚本）增加对新步骤存在性的检测（能 grep 到 `light-evaluator.md` 被 SKILL.md 引用）
- **FR-08**：本 sprint 自身吃狗粮——本 sprint DoD 的 `[BEHAVIOR]` 条目按新规矩真跑一遍，留 `verify-record.json` 证据

---

## NFR 约束

- 执行耗时：单条 `manual:` 命令超时 60s 自动 FAIL（不卡死 push 流程）
- 记录文件：JSON 格式，UTF-8，追加到 sprint 目录，不进 git（加 .gitignore）
- 可观测：FAIL 时终端输出命令名 + exit_code + tail5，让用户一眼知道哪条断言挂了
- 兼容性：不破坏现有 12 步结构，只插入新步，步骤编号可顺延

---

## Golden Path（核心场景）

开发者从 [sprint 有 `[BEHAVIOR]` DoD 条目] → 经过 [push 前轻量验收步自动逐条真跑断言命令] → 到达 [全部 exit_code=0 才许 push，留 verify-record.json 证据]

具体：
1. 开发者运行 `/dev`，改动包含行为断言（DoD `[BEHAVIOR]` 条目）
2. push 前步骤扫描 sprint 下所有 `contract-dod-ws*.md`，提取 `[BEHAVIOR]` 条目 `Test:` 字段
3. 逐条执行命令，实时打印进度，记录 exit_code + 输出尾 5 行
4. 全部通过 → 写 verify-record.json，继续 push
5. 任一失败 → 终端报告哪条命令 FAIL，阻断 push，开发者修复后重跑

---

## 验收标准（[BEHAVIOR]）

- [BEHAVIOR] `packages/engine/skills/dev/steps/light-evaluator.md` 文件存在
  Test: manual:bash -c "test -f /workspace/packages/engine/skills/dev/steps/light-evaluator.md && echo PASS"
- [BEHAVIOR] SKILL.md 引用了新步骤文件（grep 断言）
  Test: manual:bash -c "grep -q 'light-evaluator' /workspace/packages/engine/skills/dev/SKILL.md && echo PASS"
- [BEHAVIOR] engine package.json 版本为 19.5.0
  Test: manual:bash -c "node -e \"const p=require('./packages/engine/package.json');process.exit(p.version==='19.5.0'?0:1)\""

---

journey_type: config
target_environment: local
