# Sprint PRD: 刀0 — 文档正本落地 + 三方对账闸 + docs 目录登记闸（六型制地基）

TASK_ID: f1cd8a2e-476e-4827-a26c-5e44293d018b
SPRINT_DIR: sprints/08041554-doc-foundation-knife0
日期: 2026-08-04

---

## 背景（已由主理人拍板，勿重新论证）

决策 6020bb14（本机文档六型制）与 078b314a（两问判据）已 active。九次文档治理考古证明：无机器咬合的文档平均寿命 <2 周。本刀把六型制的①约束正本和判定链的 CI 闸从纸面变成机器闸。

---

## Invariant 约束

**I-1 KERNEL_CONTEXT.md 是唯一正本，品牌文件是镜像**
`packages/workflows/KERNEL_CONTEXT.md` 为三家 AI 约束的唯一正本；`AGENTS.md` 和 `.claude/CLAUDE.md` 的同名区块是镜像副本。改规则只改正本，镜像由 CI 对账闸验证一致性（不自动同步，不一致则 CI 红）。

**I-2 正本必须保留 HARD_RULES:BEGIN/END marker 结构**
`KERNEL_CONTEXT.md` 内的规则区块必须以 `<!-- HARD_RULES:BEGIN -->` 开始、`<!-- HARD_RULES:END -->` 结束。缺失任一 marker → 对账脚本 exit 1（loud-fail，禁静默跳过）。

**I-3 三方对账，任一不等 exit 1**
`scripts/check-agents-rules-sync.sh` 升级为三方对账：正本区块 == AGENTS.md 区块 == `.claude/CLAUDE.md` 区块，任一不等打印首个差异行后 exit 1。正本文件缺失或缺 marker 同样 exit 1。

**I-4 docs/ 一级子目录必须登记，未登记新目录触发 CI 红**
`scripts/smoke/check-docs-dir-registry-smoke.sh` 列出 docs/ 下全部一级子目录，每个目录须满足其一：a) 出现在 `docs/current/README.md` 文本中；b) 出现在基线文件 `docs/current/docs-dir-baseline.txt` 中。未登记则 exit 1。

**I-5 基线文件祖父条款——存量不拦，只拦新增**
`docs/current/docs-dir-baseline.txt` 在本 PR 中一次性写入当前全部已存在一级子目录（祖父条款）。后续新目录须先走路由表登记，再 push，否则 CI 红。基线文件头注释须说明"此清单只减不增：新目录必须走路由表登记，从基线删除目录=已完成归并/归档"。

**I-6 smoke 脚本放 scripts/smoke/ 即自动接线，禁止新建 workflow**
ci.yml 已有 `scripts/smoke/*-smoke.sh` glob，本刀所有新 smoke 脚本放此目录即自动被每 PR 跑。绝对禁止新建 workflow 文件。

**I-7 本刀零依赖——不碰 Kernel/orchestrator，不改品牌文件区块内容**
品牌文件（AGENTS.md、`.claude/CLAUDE.md`）的 HARD_RULES 区块内容此刻与正本天然一致（因正本就是从它们复制的），本刀不修改区块内容本身，只新建正本文件和升级对账脚本逻辑。

---

## 累积 FR

**FR-1 新建约束正本 packages/workflows/KERNEL_CONTEXT.md**
- 内容 = 当前 origin/main 的 AGENTS.md 中 `<!-- HARD_RULES:BEGIN -->` 到 `<!-- HARD_RULES:END -->` 区块逐字复制（含 23 条规则）
- 文件头加说明注释：
  - 本文件是三家 AI 约束的唯一正本
  - 品牌文件 AGENTS.md / .claude/CLAUDE.md 的同名区块是镜像
  - 改规则只改这里，镜像同步后由 CI 对账
- 必须保留 `<!-- HARD_RULES:BEGIN -->` 和 `<!-- HARD_RULES:END -->` marker
- 文件路径：`packages/workflows/KERNEL_CONTEXT.md`

**FR-2 升级三方对账脚本 scripts/check-agents-rules-sync.sh**
- 现有脚本对账 `.claude/CLAUDE.md` 与 `AGENTS.md` 两方
- 升级为三方：新增提取 `packages/workflows/KERNEL_CONTEXT.md` 的 HARD_RULES 区块
- 对账逻辑：正本区块 == AGENTS.md 区块 == `.claude/CLAUDE.md` 区块
  - 任一不等：打印首个差异行，exit 1
  - 正本文件不存在：打印 `❌ 正本文件不存在: packages/workflows/KERNEL_CONTEXT.md`，exit 1
  - 正本缺 marker：打印 `❌ 正本缺少 HARD_RULES marker`，exit 1
- 保持原有参数接口（`$1` `$2` 可覆盖两个品牌文件路径），正本路径硬编码为 `packages/workflows/KERNEL_CONTEXT.md`
- 全部通过时输出 `✅ 三方（正本/AGENTS/CLAUDE）硬规则摘要一致`

**FR-3 新建 docs 目录登记 smoke 脚本 scripts/smoke/check-docs-dir-registry-smoke.sh**
- 脚本逻辑：
  1. 列出 `docs/` 下全部一级子目录（`find docs -maxdepth 1 -mindepth 1 -type d`）
  2. 若 docs/ 不存在或列表为空 → exit 1（防 glob 静默空转）
  3. 读取 `docs/current/README.md` 和 `docs/current/docs-dir-baseline.txt`
  4. 对每个子目录：检查目录名是否出现在 README.md 文本中 OR 出现在 baseline.txt 中
  5. 未登记目录累积报错：打印 `❌ 未登记目录: docs/<dirname>`
  6. 有任何未登记目录 → exit 1；全部登记 → exit 0 + 打印总数
- 脚本须可执行（`chmod +x`）

**FR-4 生成基线文件 docs/current/docs-dir-baseline.txt**
- 内容 = 当前 docs/ 下全部一级子目录名，每行一个（仅目录名，不含路径前缀）
- 文件头注释（`# 开头的注释行`）：
  ```
  # docs 目录登记基线（祖父条款）
  # 此清单只减不增：新目录必须走路由表登记后才能出现在此清单
  # 从此清单删除目录 = 该目录已完成归并/归档
  # 生成时间：2026-08-04
  ```
- 用于 smoke 脚本的二查（存量目录免重新登记 README）

**FR-5 新建回归契约测试 packages/engine/tests/integrity/doc-foundation-contract.test.sh**
- 四条静态断言：
  1. `packages/workflows/KERNEL_CONTEXT.md` 存在且含 `HARD_RULES:BEGIN` 与 `HARD_RULES:END` marker
  2. `scripts/check-agents-rules-sync.sh` 内容含对正本路径 `packages/workflows/KERNEL_CONTEXT.md` 的引用（证明已升级为三方）
  3. `scripts/smoke/check-docs-dir-registry-smoke.sh` 存在且可执行
  4. `docs/current/docs-dir-baseline.txt` 存在且非空
- TDD 红阶段（commit-1）：对照未改仓库应 PASS=0 FAIL=4
- TDD 绿阶段（commit-2）：实现后应 PASS=4 FAIL=0
- 格式参照 `packages/engine/tests/integrity/ci-blindspot-contract.test.sh`

**FR-6 proven-to-fire 验火（验收必做，结果写入 PR body）**
- 三方对账闸验火：
  1. 本地临时改动正本一行（如末尾加一个空格或字符）
  2. 运行 `bash scripts/check-agents-rules-sync.sh`
  3. 亲眼看到 exit 1 与差异行输出
  4. 还原（不提交破坏态）
- 目录登记闸验火：
  1. 本地临时 `mkdir docs/zzz-firecheck`
  2. 运行 `bash scripts/smoke/check-docs-dir-registry-smoke.sh`
  3. 亲眼看到 `❌ 未登记目录: docs/zzz-firecheck` 与 exit 1
  4. 删除 `docs/zzz-firecheck`（不提交）
- 两次验火的命令与输出摘录写入 PR body 留证

---

## NFR

**NFR-1 对账脚本执行时间**：本地运行 `bash scripts/check-agents-rules-sync.sh` ≤ 2s（纯文本对比，无网络/DB 依赖）。

**NFR-2 smoke 脚本执行时间**：本地运行 `bash scripts/smoke/check-docs-dir-registry-smoke.sh` ≤ 3s（纯 fs 操作）。

**NFR-3 脚本幂等性**：两次连续运行同一 smoke 脚本，输出一致、退出码一致。

**NFR-4 无外部依赖**：所有新脚本只用 bash 内建命令 + grep/sed/find/diff，禁止引入 node/python/jq 依赖（CI 裸机环境）。

---

## Regression Test 计划（TDD 先红后绿）

**commit-1（TDD 红）**：先提交 `doc-foundation-contract.test.sh`，不提交任何实现文件。对照当前仓库状态，4 条断言全部 FAIL（PASS=0 FAIL=4）。

**commit-2（TDD 绿）**：提交全部实现（FR-1 ~ FR-4），4 条断言全部 PASS（PASS=4 FAIL=0）。

两个 commit 独立（lint-tdd-commit-order 硬检查）。

---

## 验收标准（Final E2E）

- [ ] 契约测试先红后绿，两个独立 commit
- [ ] 两个闸各自 proven-to-fire 证据在 PR body
- [ ] CI 全绿（改动含 scripts/ 会触发 smoke glob 与全量；已知偶发假红：brain-integration 报 terminating connection 属已知竞态，重跑即可）
- [ ] 合并后主仓 main 上直接运行两个 smoke 脚本均 exit 0

---

## 不包含（刀0.5 另案，禁扩 scope）

- 不清理任何僵尸文档（write-current-state cron/skills-index/CURRENT_STATE/PATROL 幻觉引用/25 孤儿目录归并）
- 不动 Notion 任何同步链
- 不改 Kernel/orchestrator 任何代码（那是刀1）
- 不修改品牌文件 HARD_RULES 区块内容本身

---

journey_type: feature
target_environment: local_api
