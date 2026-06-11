# Learning — Contract Gate 行级规则按物理行扫描，多行 pipeline / 状态码 oracle 误报

**分支**: cp-06120224-gate-logical-lines
**日期**: 2026-06-12
**关联**: #3348（Contract Gate 起点）/ #3350 / #3351；生产 run c0e2546b（notion-mapping-fix）

## 现象

GAN run c0e2546b 的合同（sprints/06112202-notion-mapping-fix）实际正确，却被 Contract Gate
反复打回 3+ 轮无法收敛，烧 evaluator 轮次。命中点是 `weak-oracle/curl-no-jq`，但对应行
其实都有合法 oracle。

## 根本原因

Contract Gate 的行级规则（`detect(line)`）把合同**按物理行**逐行判定，而 shell 验收脚本里
一条逻辑语句常被反斜杠续行拆成多个物理行：

- **盲区 A**：`curl ... \`（首行）续 `| jq -e ...`（次行）是同一条 pipeline。按物理行扫描只
  看见首行的 curl、看不见续行的 `jq -e` → 误判"取响应却无 jq -e 校验"。
- **盲区 B**：`HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ...)` 刻意丢弃 body、只取
  HTTP 状态码做 oracle（后续 `[ "$HTTP_CODE" = "200" ]`）。jq 取字段值在此根本不适用，
  curl-no-jq 规则却一刀切要求 jq -e → 误报。

两者本质同源：**行级规则在做语义判定前，没有先把物理行归一成逻辑语句**；curl-no-jq 又
缺一个"状态码 oracle 也是合法 oracle"的例外。

## 修复

1. 新增 `buildLogicalLines(lines, isCommand)` 预处理：扫描前把反斜杠续行合并为单条逻辑语句，
   **保留起始物理行号**用于报告定位。所有行级规则（curl-no-jq / or-true / file-existence /
   tautology / db-window / env-missing）都改在完整逻辑语句上判定 → 盲区 A 自然消除，且作弊者
   拆词绕过的词会被重新拼回（归一是更严，不是更松）。只对命令行启动归一，散文行不吞并命令行。
2. 新增 `isStatusCodeOracle(line)`（`-w`/`--write-out` + `%{http_code}`，引号变体兼容），
   curl-no-jq 命中前先放行状态码 oracle → 盲区 B 消除；仍无任何 oracle 的裸 curl 照抓。
3. `formatGateReport` 报告头部加一行通用提示：确属误报可用 `gate-allow: <rule-id> <理由>`
   单条豁免留痕（proposer 此前不知道这个逃生口）。
4. 三个生产实证 fixture（multiline-curl-jq / status-code-oracle / multiline-negative）+ 单测，
   既有全部 fixtures（含 #3351 的 7 个）回归不松动。

## 下次预防

- **行级规则必须先做逻辑行归一**：任何按行扫描 shell/脚本的确定性规则，第一步先合并续行
  （以及未来可能的引号跨行），再跑 detect。新增行级规则时套用 `buildLogicalLines`，不要直接
  对物理行写正则。
- **新规则上线首周收集生产误报做 fixture 库**：Contract Gate 这类拦在 GAN 前的硬门禁，一旦
  误报就直接烧轮次/卡收敛。规则上线后第一周主动盯生产 run 的 gate 命中，把"合同其实正确却被
  抓"的样例固化成永久 fixture（修复前命中、修复后放行），形成回归网。
- **oracle 不止一种形态**：字段值（jq -e）、状态码（http_code）、DB 计数（带时间窗）都是合法
  oracle。规则不能假设只有一种正确写法。

### checklist

- [x] 复现盲区 A/B 的 failing fixture（修复前命中、修复后放行）
- [x] 既有全部 fixtures/单测回归绿（含 #3351 的 7 个）
- [x] wiring / converge / fallback 测试绿
- [x] DoD BEHAVIOR 命令本地按 CI eval 循环实跑通过
- [x] formatGateReport 逃生口提示头部已加
- [ ] merge 后观察 run c0e2546b 下一轮是否收敛（brain 重启后生效）
