# Sprint Contract Draft (Round 1)

> **被测对象**: Initiative B1 基础脚手架 — `initiatives/b1/`
> **PRD 来源**: `sprints/sprint-prd.md`
> **目标**: 把"配置 → 入口 → 行为 → 验收"链路立起来；脚手架不引入业务逻辑

---

## Feature 1: Initiative B1 入口启动行为

**行为描述**:
开发者在仓库根目录执行 Initiative B1 入口命令（不带参数），进程以 0 退出码结束，stdout 输出可识别的启动横幅，且横幅内容包含一个能在外部辨认出"这是 Initiative B1"的字面量。重复执行同一命令时退出码与 stdout 一致，无副作用残留（脚手架阶段不要求并发互斥）。

**硬阈值**:
- 入口退出码 == 0
- stdout 中匹配 `/Initiative B1/` 至少 1 次（横幅字面量）
- 第二次执行的退出码 == 第一次（== 0）
- 第二次执行的 stdout 与第一次完全一致（byte-equal）

**BEHAVIOR 覆盖**（落在 `tests/ws1/entry.test.ts`）:
- `it('exits with code 0 when invoked with no arguments')`
- `it('prints recognizable Initiative B1 banner to stdout')`
- `it('produces identical exit code and stdout on repeated invocation')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- 入口模块文件 `initiatives/b1/entry.js` 存在
- 入口模块通过相对路径 `config/default.json` 加载默认配置（源码引用，非运行行为）

---

## Feature 2: 默认配置加载与回显

**行为描述**:
入口启动时读取仓库内默认配置文件，把配置中一个可观察字段（约定为 `banner`）的字面值回显到 stdout 启动日志中。当默认配置文件被移除或字段缺失时，入口必须立即以非零退出码退出，并通过 stderr/stdout 输出可读、含有"配置/config"语义的错误提示，**严禁**用空配置静默继续启动。

**硬阈值**:
- `config/default.json` 含 `banner` 字段，且为非空字符串
- 入口 stdout 含 `config.banner` 的字面量值（字符串包含）
- 配置文件缺失时退出码 != 0；错误信息匹配 `/config|配置/i`
- `banner` 字段缺失时退出码 != 0

**BEHAVIOR 覆盖**（落在 `tests/ws1/entry.test.ts`）:
- `it('echoes config.banner field value into stdout on startup')`
- `it('exits non-zero with readable error when default config file is missing')`
- `it('exits non-zero with readable error when banner field is missing from config')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- 配置文件 `initiatives/b1/config/default.json` 存在
- 配置内容为合法 JSON 且含 `banner` 字段（字段值非空字符串）

---

## Feature 3: 验收脚本闭环

**行为描述**:
开发者运行验收脚本 `initiatives/b1/scripts/verify.sh`，脚本逐项断言 PRD 验收场景 1/2/3：入口能启动、配置能加载、错误路径能拦截。**任一断言失败**必须返回非零退出码并打印失败原因。脚手架健康时脚本 stdout 输出 `PASS` 字面量并以 0 退出。当入口或配置被破坏时（实现 bug、字段被删除、入口文件不可读）脚本必须感知并以非零退出码报告。

**硬阈值**:
- 健康路径：verify.sh 退出码 == 0，stdout 含字面量 `PASS`
- 入口被替换为 `process.exit(7)`：verify.sh 退出码 != 0
- 配置 `banner` 字段被删除：verify.sh 退出码 != 0
- 入口文件被 chmod 000（不可读）：verify.sh 退出码 != 0，且 stderr/stdout 含 `entry|入口|permission|权限|读取` 之一，**不得**只输出未捕获的 node stack frame（如 `at Object.<anonymous>`）

**BEHAVIOR 覆盖**（落在 `tests/ws2/verify.test.ts`）:
- `it('exits 0 and prints PASS when scaffold is healthy')`
- `it('exits non-zero when entry script is replaced with process.exit(7)')`
- `it('exits non-zero when banner field is removed from default config')`
- `it('prints readable failure when entry file is unreadable, no raw stack frame')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws2.md`）:
- 验收脚本 `initiatives/b1/scripts/verify.sh` 存在且 mode 包含执行位
- 脚本源码含字面量 `PASS`（用于成功路径）
- 脚本源码含 `set -e` 或显式非零 `exit` 语句（确保失败传播）

---

## Feature 4: README 使用说明

**行为描述**:
`initiatives/b1/README.md` 必须显式列出"如何运行入口"和"如何运行验收"两条可复制粘贴执行的命令；新人按 README 复制粘贴即可在干净环境跑通。

**硬阈值**:
- README 含字面命令 `node initiatives/b1/entry.js`
- README 含字面命令 `bash initiatives/b1/scripts/verify.sh`

**BEHAVIOR 覆盖**（落在 `tests/ws2/verify.test.ts`）:
- `it('README documents both entry and verify run commands as copy-pasteable lines')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws2.md`）:
- README 文件 `initiatives/b1/README.md` 存在
- README 文件大小 > 0 字节

---

## Feature 5: 脚手架 LOC 预算 + git 追踪完整性

**行为描述**:
整个 `initiatives/b1/` 目录新增代码量必须落在脚手架预算内（PRD SC-003: < 400 LOC，符合 capacity-budget hard 阈值）。所有文件必须被 `git ls-files` 列出，无未追踪残留（PRD SC-004）。

**硬阈值**:
- `initiatives/b1/` 下所有被 git 追踪的文件总行数 < 400
- `git ls-files initiatives/b1/` 列出的文件数与 `find initiatives/b1/ -type f -not -path '*/\.*'` 列出的文件数一致（无未追踪残留）

**ARTIFACT 覆盖**（落在 `contract-dod-ws2.md`，验收侧承担）:
- `initiatives/b1/` 目录存在
- 目录下所有文件均被 git 追踪（无 untracked）
- 所有被追踪文件总行数 < 400

---

## Workstreams

workstream_count: 2

### Workstream 1: Initiative B1 入口模块 + 默认配置

**范围**:
- 新建 `initiatives/b1/entry.js`：node 入口，加载 `config/default.json`、回显 `banner`、错误时非零退出
- 新建 `initiatives/b1/config/default.json`：含 `banner` 字段的默认配置
- 不涉及 verify.sh 与 README

**大小**: S（预估 < 80 LOC）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/entry.test.ts`

### Workstream 2: 验收脚本 + README + 预算/追踪验收

**范围**:
- 新建 `initiatives/b1/scripts/verify.sh`：bash 脚本，串起场景 1/2/3，失败传播
- 新建 `initiatives/b1/README.md`：含"运行入口""运行验收"两条命令
- 包含 LOC 预算 + git 追踪完整性的合同性约束（在 ARTIFACT 中校验）
- 依赖 WS1 的入口与配置已就位

**大小**: S（预估 < 100 LOC）
**依赖**: Workstream 1 完成后（验收脚本与测试都需要 entry.js + default.json 真实存在）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws2/verify.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/entry.test.ts` | exit 0 / banner / config.banner 回显 / 配置缺失非零退出 / banner 字段缺失非零退出 / 重复启动等价 | `npx vitest run sprints/tests/ws1/` → 6 failures（entry.js 不存在，所有 spawnSync 拿不到预期 status/stdout） |
| WS2 | `sprints/tests/ws2/verify.test.ts` | verify.sh PASS 路径 / entry 被破坏失败 / banner 字段缺失失败 / 入口不可读时可读错误 / README 命令存在 | `npx vitest run sprints/tests/ws2/` → 5 failures（verify.sh 不存在 + README 不存在，所有断言失败） |

**测试运行约定**: 在仓库根目录执行 `npx vitest run sprints/tests/wsN/ --reporter=verbose`。tests 通过 `child_process.spawnSync` 直接调用 `node`/`bash`，不依赖任何包内 vitest 配置；vitest 自身按默认 include 规则匹配 `*.test.ts`。
