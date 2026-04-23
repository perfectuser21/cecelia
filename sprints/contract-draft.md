# Sprint Contract Draft (Round 11)

> **PRD 来源**：`sprints/sprint-prd.md`（Initiative：Brain 时间端点 — 单一 `GET /api/brain/time` 返回 iso/timezone/unix 三字段）
>
> **Round 10 → Round 11 变更（基于 Reviewer Round 10 REVISION 反馈 — 1 个 Major 必修，含两条修法同时落地）**：
>
> **Reviewer Round 10 的 Major risk（必修）**：
> - **B2 字面外注入缝隙**：Round 10 B2 正则 `await\s+import\s*\(\s*[^)]*routes\/time\.js` 用 `[^)]*` 贪婪匹配 paren 内任意非-`)` 字符；`routes/time.js` 字面**可以位于注释内、变量名内、字符串拼接的非 target 部分内**。例如 `await import(someVar /* routes/time.js */)`、`const path='routes/time.js';await import(other)` 等 mutation 仍假绿 —— Round 10 的"target 路径锁定"只锁到了 `(...)` 区间，**未真正锁到字符串字面 target 内**。Reviewer 提出两条修法（任一即可）：(1) 收紧 B2 正则到 `/await\s+import\s*\(\s*['"\`][^'"\`]*routes\/time\.js[^'"\`]*['"\`]\s*\)/`（paren 内必须是字符串字面，字面体内含 `routes/time.js`，paren 立即闭合）；(2) 保留现 B2 同时**新增 B4** = 计算所有 `await\s+import\s*\(\s*['"\`][^'"\`]*['"\`]\s*\)` 的命中，至少一条 target 字面含 `routes/time.js`。Reviewer 也提到第 (3) 条更彻底的 AST 路线，但**明文超出 Round 10 范围**。
>
> **Round 11 修法（采纳 Reviewer 建议路径 1+2 同时落地，结构性收紧 + 集合性兜底，防御纵深）**：
>
> 1. **B2 收紧（路径 1）**：B2 正则升级为 `await\s+import\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:"[^"]*routes/time\.js[^"]*"|<反引号>[^<反引号>]*routes/time\.js[^<反引号>]*<反引号>|'[^']*routes/time\.js[^']*')\s*\)`。语义：paren 内**只允许**：可选 `/* ... */` 注释（兼容当前测试文件的 `/* @vite-ignore */` 形态）+ 一个**完整字符串字面**（双引号 / 反引号 / 单引号三选一），字面体内**显式包含** `routes/time.js`，字面闭合后 `\s*\)` 立即闭合。Mutation 锁定：注释/变量/拼接里的 `routes/time.js` 全部失效，因为它们不在字面体内。命令实体位于 DoD · B2（SSOT，Round 10 单源原则保留）。
> 2. **新增 B4 防御纵深（路径 2）**：枚举测试文件中所有 `await import(<字符串字面>)` 调用（`(?:"([^"]*)"|<反引号>([^<反引号>]*)<反引号>|'([^']*)')`，三种字面变体），**至少一条**字面体内含 `routes/time.js`。失败码语义化：exit 1 = 0 条字面 import 调用（mutation probe 完全缺失）；exit 2 = 字面 import 存在但无一条 target 命中 routes/time.js（target 漂移）。命令实体位于 DoD · B4（Round 11 新增 SSOT，沿用 Round 10 单源原则）。
>
> **Round 11 Mutation 自检（Proposer 本地已验）**：
> - **mutant-A** `await import(someVar /* routes/time.js */)`：旧 R10 B2 误放 → 新 B2 拒绝（routes/time.js 在注释里，不算字面体内）；B4 拒绝（无字面 import）
> - **mutant-B** `await import('fs')`：旧 R10 B2 拒绝（paren 内不含字面 routes/time.js）→ 新 B2/B4 同样拒绝
> - **当前合法测试文件**（`time-intl-caching.test.ts:59-61`）：``await import(/* @vite-ignore */ `../../../packages/brain/src/routes/time.js?rev7intl=${Date.now()}`)`` —— 反引号字面体内含 `routes/time.js` → 新 B2 PASS / B4 PASS（matches.length===1, ok===true）/ 旧 R10 B2 同样 PASS（向下兼容，未破坏现有 Green 状态）
>
> **Round 11 不动的部分**：
> - 测试文件 0 改动：`time.test.ts` 12 条 + `time-intl-caching.test.ts` 1 条 + `routes-aggregator.test.ts` 2 条 = **15 条 `it()`**（与 Round 6–10 完全一致）。Round 11 仅改 DoD ARTIFACT 文本（B2 命令收紧 + B4 命令新增）+ 本草案的 ID 索引表 + changelog —— 0 行测试代码、0 行 E2E 脚本、0 个 it() 数量变化。
> - SSOT 单源原则保留：B4 命令文本只在 `contract-dod-ws1.md` 落定；本草案仅按稳定 ID 引用（沿用 Round 10 结构性原则）
> - Round 10 的命令 1 差异化 exit 码（exit 1/2/3/4）保留不动
>
> **Reviewer Round 10 旁支观察（Reviewer 自陈 "和本轮无关，提一下"，Round 11 不处理但记录在案）**：
> - **A2 计数 `^\s*it\s*\(`** — 当前文件清洁；理论上 `it(` 嵌入描述字符串（`'\nit(...'`）或反向缩进可干扰计数。**Round 11 不动**（与 Reviewer Round 10 反馈范围对齐；若后续真有干扰诉求，下轮可改用 AST 计数 / 计 vitest list 输出 / 计 collect 后的 numTotalTests）
> - **索引表 ID ↔ DoD ARTIFACT 对应关系仍是人工映射**（无 self-check）—— ID 增删时可能漂移。**Round 11 不动**（同上，下轮顺手议题；当前 7 条 ID 表 + 7 条 DoD 条目人工对账成本低）
>
> ---
>
> **Round 9 → Round 10 变更（基于 Reviewer Round 9 REVISION 反馈 — 2 个 major risk 必修 + 1 条 minor 采纳）**：
>
> **Reviewer Round 9 的 2 个 major risk（必修）**：
> - **Major-A（Reviewer Round 8 Risk 4 未闭合 — 三重锁链 B1/B2 有缝隙）**：
>   - **B1 缝隙**：Round 9 正则 `^\s*import\s+[^;]*from\s+['"][^'"]*routes\/time\.js['"]` 只匹配 `import X from '...'` 形式，**漏了 side-effect import `import '...routes/time.js'`**（无 `from` 子句，但同样会在 `vi.spyOn` 之前触发模块顶层求值 → mutation probe 失效）。
>   - **B2 缝隙**：Round 9 正则 `await\s+import\s*\(` 匹配**任意** `await import(` 调用，target 路径完全开放；即使测试文件里的 `await import(...)` 指向 `'fs'`/`'path'` 等无关模块，也能假绿该 ARTIFACT，契约语义漂移。
>   - **Round 10 修法（两条正则同步收紧，统一放在 DoD B1/B2）**：
>     - B1 → `^\s*import\s+(?:[^;]*from\s+)?['"][^'"]*routes\/time\.js['"]`（把 `from` 子句改为可选组，side-effect 和 named 两种形式都命中）
>     - B2 → `await\s+import\s*\(\s*[^)]*routes\/time\.js`（paren 内强制含 `routes/time.js` 字面，target 锁定）
>   - B3 原样保留（Reviewer Round 9 确认 `vi.spyOn(Intl, 'DateTimeFormat')` regex 的 bash 转义和语义正确）
> - **Major-B（Reviewer Round 8 Risk 2 的 Round 9 修补本身制造新风险）**：Round 9 把 `contract-dod-ws1.md` 的 Round 8/9 ARTIFACT `node -e ...` 命令**原样粘贴**进本草案的 `### ARTIFACT 原文粘贴` 区块，意图让 Reviewer 无需跨文件对齐。Reviewer Round 9 指出这反而把原本 1 处的命令定义变成 2 处 —— 任一处修改若未同步，两份出现语义漂移；"粘贴+同步纪律"是**工程性兜底**而非**结构性解法**。
>   - **Round 10 根治（结构性单源）**：
>     - `contract-dod-ws1.md` 永久作为 ARTIFACT 命令的 **SSOT**；每条 Round 8+9+10 新增 ARTIFACT 赋予**稳定 ID**（`A1 / A2 / A3 / A4 / B1 / B2 / B3`）
>     - 本合同草案**彻底删除**原 `### ARTIFACT 原文粘贴` 区块（Round 9 遗留）
>     - 本合同草案**只通过稳定 ID 引用** DoD 里的 ARTIFACT（例如："见 DoD · A1 / A4 / B1 / B2 / B3"），**不重复命令文本**
>     - 改命令文本时只改 DoD 一个地方 → 无双源 → 无漂移；ID 本身短且稳定，即使 DoD 文本行变更也不影响引用
>
> **Reviewer Round 9 的 minor 采纳**：
> - **命令 1 exit 码差异化** — 原 Round 9 命令 1 用 exit 1（collect miss）和 exit 2（wrong red/green state），Reviewer 建议按"文件缺失 / JSON 解析异常 / collect miss"三种失败路径分别区分 exit 码以便肉眼 triage。Round 10 采纳：文件缺失 `exit 3` / JSON 解析异常 `exit 1` / collect miss (`numTotalTests !== 1`) `exit 4` / 错误红绿态 `exit 2`。
>
> **Round 10 不触达测试文件**：`time.test.ts` 12 条 + `time-intl-caching.test.ts` 1 条 + `routes-aggregator.test.ts` 2 条 = **15 条 `it()`**（与 Round 6–9 完全一致）。Round 10 只改合同草案本文 + DoD ARTIFACT 正则文本 + 命令 1 exit 码 —— 0 行测试代码变化。
>
> ---
>
> **Round 8 → Round 9 变更（基于 Reviewer Round 8 REVISION 反馈）**：
>
> **Reviewer Round 8 识别出 4 个 Risk**（按 VERDICT: REVISION，≥ 2 Risk 即须回 Proposer；本轮一次性处理）：
> - **Risk 1（major）**：Round 8 `## Test Collect Sanity` 命令 1 用 `grep -Eq "Tests[[:space:]]+1" /tmp/ws1-intl-list.log` 判定 collect 计数，**依赖 vitest 文本报告格式字符串**。vitest 2.x/3.x 若修改 summary 行格式（例如 `Test Files 1` → `Files 1` / `Tests: 1`），合同判定会误红/漏红。**Round 9 对策**：改用 `npx vitest run ... --reporter=json --outputFile=/tmp/ws1-intl-json.json` + node 解析 JSON 对象的 `numTotalTests` 字段（schema 稳定，跨版本兼容）；也保留了仓库当前实测行：vitest 1.6.1 下 JSON reporter 输出 `{"numTotalTests":1,"numFailedTests":1,...}`，Green 阶段 `{"numTotalTests":1,"numPassedTests":1,...}`。
> - **Risk 2（major）**：Round 8 合同草案 `## Test Collect Sanity` 章节描述了新增 ARTIFACT 的**语义**，但**未把 `contract-dod-ws1.md` 里 ARTIFACT 的具体 `node -e ...` 命令行**贴进来，Reviewer 读合同草案时需要跨文件对齐（风险：两份文件词句不同步，或 Reviewer 看漏 DoD 细节）。**Round 9 对策**：在 `## Test Collect Sanity` 章节最后新增 `### ARTIFACT 原文粘贴（契约硬化 — Reviewer Round 8 Risk 2）`，把所有 Round 8+Round 9 新增 ARTIFACT 条目的 `node -e ...` 命令**原样粘贴**进合同草案（任何后续 DoD 字句变更须同步）；Reviewer 可直接在合同草案内核对，无需跨文件查阅。
> - **Risk 3（major）**：Round 8 `## Test Collect Sanity` 命令 3（仓库根 vitest.config include 登记校验）**仅用 `echo "[root config] ..."` 打印**，不做 exit 判定 —— 若 Reviewer / CI 直接 source 这段 bash 做 gate，遇到不合规 config 只会打印"未覆盖"而 exit 0，gate 脚本实际退化为 echo。**Round 9 对策**：命令 3 加 `FAILED=0` 记账变量 + 末尾 `[ "$FAILED" -eq 0 ] || exit 1` 硬判定；每条违规分支写 `FAILED=1`。确保"gate 脚本直接 bash 执行时，不合规 config 必定非 0 退出"。
> - **Risk 4（边界条件）**：Round 7 把 `it(11)` 搬到独立文件 `time-intl-caching.test.ts` 时，测试文件用 `await import(/* @vite-ignore */ \`...routes/time.js?rev=${Date.now()}\`)` 动态引用目标模块。**但 Round 8 合同未显式化"该文件不得 top-level static import `routes/time.js`"这一关键约束** —— 若未来有人（Generator 或后续修订）把动态 import 改成 `import timeRouter from '.../routes/time.js'`，模块顶层会在 `vi.spyOn(Intl, 'DateTimeFormat')` 尚未安装 spy 时就完成解析 → 顶层 `const CACHED_TZ = Intl.DateTimeFormat()...` 这类 mutation 不再被 spy 拦住 → 测试假绿（看似通过，实则 mutation probe 已失效）。**Round 9 对策**：`contract-dod-ws1.md` 新增 3 条 ARTIFACT：<br/>   (a) **禁止** static top-level `import ... from '.../routes/time.js'`（grep 正则匹配即 fail）；<br/>   (b) 必须至少出现一次 `await import(` （证明走动态引用）；<br/>   (c) 必须至少出现一次 `vi.spyOn(Intl, 'DateTimeFormat')`（证明 Intl spy 机制存在，和 (a)+(b) 形成三重锁链）。<br/>三条同步进 `## Test Collect Sanity` 的 ARTIFACT 原文粘贴区，Reviewer 可直接核对。
>
> **it 计数稳定**：Round 9 不改动任何 .test.ts 文件内容 / 数量 / 结构。`time.test.ts` 12 条 + `time-intl-caching.test.ts` 1 条 + `routes-aggregator.test.ts` 2 条 = **15 条 `it()`**（与 Round 6/7/8 一致）。Round 9 **只改**合同文本（本草案 + DoD）+ 追加 DoD ARTIFACT 条目。测试文件完全不动。
>
> **设计立场递进**（Round 8 → Round 9）：
> - Round 8 把 collect 层契约显式化（文件存在 / it 恰好 1 条 / include 登记）—— 关切从"测试断言强度"扩展到"测试 collect 机制可观测性"
> - Round 9 把"可观测性"再推一步到"**不可绕过性**"：collect 命令本身的文本格式依赖被消除（JSON schema 锁定），gate 脚本 echo-only 的软兜底被硬化（exit 1），测试文件的动态 import 约束被显式规约（禁止静态 import + 必须含 await import + 必须含 vi.spyOn Intl）。每一条都是"未来编辑可能不经意破坏" 的静默退化路径 —— Round 9 合同把这些路径逐一堵上
>
> ---
>
> **Round 7 → Round 8 变更（基于 Reviewer Round 7 REVISION 反馈）**：
>
> **Reviewer Round 7 的关切**（不构成 spec 本体漏洞，聚焦**测试 collect 机制的可观测性**）：
> - **(a)** Proposer 必须在 Test Contract 的"预期红证据"列显式加上一条：`npx vitest list sprints/tests/ws1/time-intl-caching.test.ts` 能 collect 到该文件且其中 `it()` 计数 == 1（脚本形式可用 `vitest list` 输出 grep "Tests 1" 判定）。**动机**：Round 7 把 Intl caching probe 拆到独立测试文件后，若该文件因某种原因（include 列表未覆盖、路径不匹配、扩展名被 glob 漏掉）没被 vitest collect 到，Reviewer 会看到"0 passed"假绿而非真正的 FAIL —— 这是 spec 之外的验证 pipeline 风险，必须显式落到合同里以供 Reviewer 核验。
> - **(b)** 同步要求 Generator（在 Workstream 1 范围内明文规约）：若项目 vitest.config（`packages/brain/vitest.config.js` 或仓库根/被用于执行 sprints 合同测试的 config）使用**字面量 include 列表**，且该 include 列表不能匹配 `sprints/tests/ws1/time-intl-caching.test.ts`，Generator 必须将该路径或等价 glob 登记进 include。**动机**：Harness v6 evaluator 直接 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` 时，vitest 对显式传入文件的处理因版本/config 略有差异；防御性登记消除不确定性。
> - **(c)** 在 Test Contract 的"预期红证据"列显式加一条：在 `sprints/tests/ws1/time-intl-caching.test.ts` 文件尚不存在（或假设"未交付"）的前提下，`npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` **必须** fail 于 "No test files found"；若输出 "No tests run" 或 "0 passed" 都说明 collect 机制本身没生效（区别于"文件存在、it() 也能 collect、但断言 fail"的真 red 状态）。
>
> **Reviewer Round 7 的其它观察（不构成 Risk，Round 8 保留现状）**：
> - 原则规则 `400 ≤ code < 600` 处理 Reviewer Round 6 Risk 1/2 合理 — 3xx（重定向）/ 2xx 非 200（204/202）在 `/api/brain/time` 场景均属不合理返回，排除逻辑无漏洞。
> - `routes-aggregator.test.ts` it(14)/it(15) 反 catch-all 断言保留 — Round 5 开的口子封得稳。
>
> **Round 8 对策（一次性解决 (a)+(b)+(c)）**：
>
> 1. **新增 "## Test Collect Sanity" 章节**：列出两条显式可执行命令 + 预期输出：
>    - **预期红（文件尚未交付的状态）**：`npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` → 退出非 0，stdout/stderr 含子串 `No test files found`（不接受 "No tests run" 或 "0 passed"，这两种输出反而证明 collect 机制出错）
>    - **预期就绪（Round 7 已交付文件后的状态）**：`npx vitest list sprints/tests/ws1/time-intl-caching.test.ts` 2>&1 → 输出含子串 `Tests 1`（即 1 条 it() 被 collect）；或等价替代：`npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` 输出含 `Test Files  1` + `Tests  1`（可以是 failed 也可以是 passed，关键是"1"）
> 2. **Test Contract 表第二行（`time-intl-caching.test.ts`）的"预期红证据"列扩写**：明确区分"文件缺失红"（`No test files found`，exit != 0）与"文件存在但实现模块缺失红"（`ERR_MODULE_NOT_FOUND`/`Failed to load url`，exit != 0，`Tests 1 failed (1)`）—— 两种红状态必须明文分开，避免 Reviewer 把"0 tests" 当成"一切正常"。
> 3. **Workstream 1 范围描述里明文写入 include 登记规约**：Generator 在实现开始时必须执行一次 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts`，看到 "No test files found" 之外的 collect 成功输出（如 `Tests 1 failed (1)`）方可继续；否则必须排查并修正 vitest.config 的 include 列表，让该文件被 collect。
> 4. **新增 ARTIFACT 条目到 `contract-dod-ws1.md`**：
>    - 条件性 ARTIFACT：若任意 vitest.config（brain/quality/engine/dashboard/api 或新建根 config）使用字面量 include 列表且该 config 会被用来运行合同测试，必须覆盖 `sprints/tests/ws1/time-intl-caching.test.ts`；
>    - 无条件 ARTIFACT：`sprints/tests/ws1/time-intl-caching.test.ts` 文件存在且含恰好 1 个 `it(` 顶层调用（与 `vitest list` 预期输出 "Tests 1" 强同构）。
>
> **it 计数稳定**：Round 8 不改动测试文件数量/结构。`time.test.ts` 12 条 + `time-intl-caching.test.ts` 1 条 + `routes-aggregator.test.ts` 2 条 = **15 条 `it()`**（与 Round 6/7 一致）。Round 8 完全不触达 .test.ts 文件内容，**只改合同文本 + DoD 清单 + 新增 Test Collect Sanity 章节** —— 证据：合同里新增的 ARTIFACT 用 `grep -c` 直接数 `sprints/tests/ws1/time-intl-caching.test.ts` 的 `^\s*it(` 命中次数来保证 "恰好 1 条" 的硬约束。
>
> ---
>
> **Round 6 → Round 7 变更（基于 Reviewer Round 6 REVISION 反馈）**：
>
> **Reviewer Round 6 的 3 个 Risk**：
> - **Risk 1（major）**：Round 6 E2E step 8 非 GET 状态码**相对化到 8 码枚举集合** `ACCEPTABLE_NOT_FOUND_STATUS = {401,403,404,405,415,422,429,500}`。Reviewer 指出**集合本身是枚举而非规则**——合法 Brain 实现若引入枚举外的状态码（410 Gone / 426 Upgrade Required / 451 Unavailable For Legal Reasons / 502 Bad Gateway / 503 Service Unavailable / 504 Gateway Timeout 等），step 8 会误杀；同时 step 7.5 的 baseline 校验与 step 8 的目标校验**共用同一集合**，覆盖面对称风险被放大——任何新增合法错误码必须两处同步维护。
> - **Risk 2（major）**：step 7.5 baseline 覆盖面与 step 8 不对称。Round 6 由于枚举写死，baseline 合法状态空间与 step 8 合法状态空间"应当同一"的约束需要枚举维护，任何一侧漏改就有误杀/漏判。
> - **Risk 3（major）**：Round 6 把 `it(11)`（模块顶层 Intl 缓存 mutation probe）抽到 `time.test.ts` **同文件**独立 describe 块 + `afterAll(vi.restoreAllMocks)` 兜底。Reviewer 指出该隔离方案"依赖未明文约束的假设"：afterAll 若自身抛错、describe 块执行顺序被后续修改打乱，或 vitest 池配置变更（threads ↔ forks），都可能让 Intl spy 污染同文件其它 describe 块。推荐路线 (b)：把 `it(11)` 搬到**独立测试文件**，利用 vitest 默认 file-per-worker 的进程/线程级隔离做为主防线。
>
> **Reviewer Round 6 的 minor 建议**：
> - E2E step 8 body key 检查当前"grep 命中才跑 jq"——可被 JSON 格式变体（空白/编码/键顺序）漏检。补无条件 jq 判定很便宜，应当补。
> - HEAD/OPTIONS 方法未测：Express 默认对 GET 路由自动响应 HEAD，风险小，可以不补。（Round 7 **不补**，遵循 Reviewer 判定。）
>
> **Round 7 对策（按 Reviewer 推荐路线一次性解决 Risk 1+2+3 + 吸收 minor）**：
>
> 1. **Risk 1 & Risk 2 → E2E 状态码改原则规则（放弃枚举）**：
>    - 在 `tests/e2e/brain-time.sh` 用 bash 函数 `is_http_error_status(code)` 替代 `ACCEPTABLE_NOT_FOUND_STATUS` 字符串枚举，规则为 **`400 ≤ code < 600`**（任何 HTTP 4xx 或 5xx）
>      - 200 自动排除（< 400）—— 任何"handler 被错误执行并返回 200"的 mutation 都被拒
>      - 000（curl 不通/超时）自动排除（非数字）
>      - 1xx/3xx（信息/重定向）自动排除（< 400）
>      - 6xx+ 非标准扩展排除（≥ 600）
>    - **step 7.5 与 step 8 共用同一函数**（覆盖面天然对称；Reviewer Round 6 Risk 2 由此闭合）
>    - 未来 Brain 新增鉴权返回 401/403、新增限流返回 429、故障返回 503/504 —— 脚本**零改动**自动接纳
>    - 真正的 mutation「POST /time 也返回 200」仍被抓住（200 < 400 → 规则拒绝）
>
> 2. **Risk 3 → `it(11)` 搬到独立测试文件 `time-intl-caching.test.ts`**：
>    - 新建 `sprints/tests/ws1/time-intl-caching.test.ts`，专门承载"模块顶层 Intl 缓存 mutation probe"
>    - `time.test.ts` 主 describe 块减为 12 条 it()（移除了原同文件独立 describe 块的 1 条）
>    - vitest 默认每个 test file 跑在独立 worker 里（threads 池 = 独立 thread，forks 池 = 独立 child process），`Intl.DateTimeFormat` 的 spy + ESM module cache 在 OS/VM 层级都不可能跨文件泄漏
>    - 新文件内保留 `afterAll(vi.restoreAllMocks)` 作为保险（非主防线）
>    - 主 describe 块内的 `it(7)`「timezone 是有效 IANA 名」不再可能受到该 probe 的 spy 溢出影响
>
> 3. **Minor → E2E step 8 body key 检查无条件 jq 判定**：
>    - Round 6 该检查 gated on `grep -Eq '"(iso|unix|timezone)"[[:space:]]*:'` 命中，若 mutation 用非常规 JSON 编码则漏检
>    - Round 7 改为先 `jq -e . "$FILE" >/dev/null 2>&1` 判定 body 是否可解析为 JSON，若是则直接 `jq -e 'has("iso") or has("unix") or has("timezone")'` 硬判；不可解析 JSON（如 HTML 错误页）仍走字面量 not-contain 的兜底
>
> **it 计数稳定**：Round 7 `time.test.ts` **12 条 it()** + `time-intl-caching.test.ts` **1 条 it()** + `routes-aggregator.test.ts` **2 条 it()** = **15 条**，与 Round 6 总数一致（只是 it(11) 从同文件独立 describe 搬到独立文件；物理位置更换，数量不变）。
>
> **设计原则演进**（Round 1 → Round 7）：
> - Round 1-3：以 BEHAVIOR 测试硬断言为主，ARTIFACT 为辅
> - Round 4：遇到「Generator 能通过测试但实现方式绕过静态正则」的问题，曾尝试收紧 ARTIFACT
> - Round 5：Reviewer 明确诊断「ARTIFACT 静态正则在本合同里已被反复证明是猫鼠游戏」，一次性切到行为层——凡是「正则匹配代码文本」的兜底，全部改为「动态 import + mock + supertest」的行为 probe
> - Round 6：行为路线的「过严等式」回调成「合理集合」——E2E step 8 不再用 `== baseline` 硬等式，改用 8 码枚举集合
> - **Round 7**：集合升级为**原则规则**（`400 ≤ code < 600`）—— 合法未命中/错误状态空间开放式全覆盖，放弃枚举维护成本，step 7.5 与 step 8 共用同一函数，覆盖面天然对称；同时把 Intl caching mutation probe 搬到独立测试文件，改"同文件 afterAll 兜底"为"file-per-worker OS 级隔离"。

---

## Feature 1: `GET /api/brain/time` 返回单一聚合 JSON（iso + timezone + unix）

**行为描述**:

对该 URL 发出 GET 请求时，服务以 HTTP 200 返回 Content-Type 为 JSON 的响应体，对象**恰好**含三个字段 `iso`、`timezone`、`unix`，不混入其它字段。

- `iso` 是代表当前服务器时刻的**严格 ISO 8601 UTC instant 字符串**，**必须以 `Z` 结尾**（对应 Node `Date.prototype.toISOString()` 产物，形如 `2026-04-23T12:34:56.789Z`）。**不允许 `±HH:MM` 本地偏移后缀**、`new Date().toString()` 非标准字符串、无后缀 naive 字符串。`iso` 表达的是 UTC 绝对时刻，与 `timezone` 字段**语义解耦**。
- `timezone` 是**有效 IANA 名字字符串**（`new Intl.DateTimeFormat('en-US', { timeZone })` 不得抛 `RangeError`），正常环境下反映 `Intl.DateTimeFormat().resolvedOptions().timeZone` 实际解析值（不得硬编码为 `'UTC'`），仅当 Intl 返回空/undefined 时才回落 `'UTC'`。`timezone` 为服务器本地时区元信息。**`Intl.DateTimeFormat` 的调用必须发生在每次 GET /time 请求的 handler 执行时刻**（即不可在模块加载时缓存；Round 5 起由动态 import + 双 mock 切换行为 probe 验证；Round 7 该 probe 搬到**独立测试文件**，文件级 worker 隔离为主防线）。
- `unix` 是**整数秒**（非毫秒、非字符串、非浮点），即 `Math.floor(Date.now()/1000)`。

端点不依赖 DB、不依赖鉴权、不依赖外部服务。query 参数一律被**忽略**。**非 GET 方法**（POST/PUT/PATCH/DELETE）不触发该 handler，合同 BEHAVIOR it(11)（原 it(12)）在 supertest 挂接 timeRouter 的场景下断言状态 ∈ `{404, 405}`；真机 E2E（step 8）则**用原则规则 `is_http_error_status` 判定**（Round 7 — 放弃 Round 6 的 8 码枚举，改 `400 ≤ code < 600` 原则规则；200 天然被排除）。POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 不会污染输出（handler 根本不执行，**且原始响应正文 `res.text` 不得含 `evil` 或 `Fake/Zone` 字面量**）。三个字段取自**同一次** `Date.now()`（同次请求内，`new Date(iso).getTime()` 与 `unix * 1000` 之间差值 ≤ 2000ms）。

**聚合挂接行为判据**（Round 5 新增 — Risk 1）：
从 `packages/brain/src/routes.js` 导出的 aggregator 默认 export 被 `app.use('/api/brain', aggregator)` 挂接后，`GET /api/brain/time` 必须返回合规三字段 body；同时 `GET /api/brain/__nope__` 不得返回 200（防 `app.all('*')` 骗过）。

**硬阈值**:

- HTTP status = `200`（GET 请求）
- `Content-Type` 头含 `application/json`
- `Object.keys(body).sort()` 严格等于 `['iso', 'timezone', 'unix']`
- `body.iso` 必须匹配正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/`
- `body.iso.endsWith('Z')` 为真
- `new Date(body.iso).getTime()` 为有限数且与请求时刻偏差 ≤ 2000ms
- `Number.isInteger(body.unix)` 为真；`body.unix > 0`；`String(body.unix).length <= 10`（秒，不是毫秒）
- `body.timezone` 为非空字符串，且 `new Intl.DateTimeFormat('en-US', { timeZone: body.timezone })` 不抛错
- `Math.abs(new Date(body.iso).getTime() - body.unix * 1000) <= 2000`
- 当 `Intl.DateTimeFormat().resolvedOptions().timeZone` 返回空字符串/undefined 时，`body.timezone === 'UTC'`
- **Round 5 替换原「Intl 切片 ARTIFACT」**：先 mock Intl → `Asia/Tokyo` 动态 import → GET 拿到 `Asia/Tokyo`；**不重载**，切换 mock → `America/New_York`；GET 必须拿到 `America/New_York`（若顶层缓存则仍返回 `Asia/Tokyo`，测试 fail）。**Round 7：该 probe 搬到独立文件 `time-intl-caching.test.ts`，file-per-worker 进程/线程级隔离为主防线**。
- **Round 5 替换原「mount-expression 正则 ARTIFACT」**：从真实 `routes.js` 聚合器挂接后，`GET /api/brain/time` 返回 200 + 三字段合规；`GET /api/brain/__nope__` 非 200
- 传 `?iso=evil&unix=1&timezone=Fake%2FZone` 不改变 body 中三字段的类型约束且值仍为"当前服务器时间"
- **POST/PUT/PATCH/DELETE 到 `/api/brain/time`**：supertest 场景（BEHAVIOR it(11)）状态 ∈ `{404, 405}`；E2E 真机场景（step 8）**状态满足 `is_http_error_status`（`400 ≤ code < 600`）**（Round 7 — 放弃 Round 6 的 8 码枚举，改原则规则；Reviewer Round 6 Risk 1/2；step 7.5 baseline 用同一规则，覆盖面天然对称）
- **POST JSON body `{iso:"evil",unix:1,timezone:"Fake/Zone"}` 到 `/api/brain/time`**：`res.text` 原始正文不得出现 `evil` / `Fake/Zone` 字面；若响应可解析为 JSON 对象则**无条件**断言不含 `iso`/`unix`/`timezone` 任一 key（Round 7 — Reviewer Round 6 minor，解耦 grep 预筛选）

**BEHAVIOR 覆盖**（Round 7 = **12 + 1 + 2 = 15 条 `it()`**；`time.test.ts` 12 条 + `time-intl-caching.test.ts` 1 条 + `routes-aggregator.test.ts` 2 条）:

#### `time.test.ts`（Round 7 = 12 条 — 主 describe 全部 12 条，原独立 describe 块的 Intl caching probe 已移出到独立文件）

1. `it('GET /api/brain/time responds with HTTP 200 and application/json content type')`
2. `it('response body contains exactly the three keys iso, timezone, unix — no others')`
3. `it('iso is a string parseable as a Date within 2 seconds of request time')`
4. `it('iso matches strict ISO 8601 UTC instant format (Z suffix only, no ±HH:MM)')`
5. `it('unix is a positive integer in seconds (at most 10 digits), not milliseconds')`
6. `it('timezone is a non-empty string')`
7. `it('timezone is a valid IANA zone name (accepted by Intl.DateTimeFormat constructor)')`
8. `it('new Date(iso).getTime() and unix * 1000 agree within 2000ms')`
9. `it('ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)')`
10. `it('timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined')`
11. `it('non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys')`
12. `it('POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals')`

#### `time-intl-caching.test.ts`（Round 7 新增独立文件 — Reviewer Round 6 Risk 3）

13. **`it('timezone re-resolves per request — NOT cached at module top level (mutation: const CACHED_TZ = Intl.DateTimeFormat()...)')`（Round 5 行为重写 — 动态 import + 双 mock 切换；Round 6 曾在 `time.test.ts` 同文件独立 describe + afterAll；Round 7 —— Risk 3：搬到独立测试文件，vitest file-per-worker 的 OS/VM 级隔离做主防线，afterAll 仅作保险）**

#### `routes-aggregator.test.ts`（Round 5 新增 2 条 — Risk 1：聚合挂接行为判据）

14. `it('GET /api/brain/time via the REAL routes.js aggregator returns 200 with exact {iso, timezone, unix} body')`
15. `it('non-existent aggregator path /api/brain/__nope__ returns non-2xx — proving the aggregator is not a catch-all')`

**ARTIFACT 覆盖**（Round 5 起瘦身版，行为判据为主；详见 `contract-dod-ws1.md`）:

源码类（保留的必要性约束）：
- `packages/brain/src/routes/time.js` 文件存在
- `routes/time.js` 定义 `router.get('/time', ...)` 路由
- `routes/time.js` 默认导出 Express Router 实例
- `routes/time.js` 不 import 任何 DB 或外部服务模块
- `routes/time.js` 不 import 任何 LLM SDK
- `routes/time.js` 使用 `toISOString()` 生成 iso（保证 UTC Z 后缀）
- `routes/time.js` 文件长度 < 60 行
- `packages/brain/src/routes.js` 含 `import timeRouter from './routes/time.js'`（必要条件；充分性由 BEHAVIOR 14/15 承担）
- **已删除**（Round 5）：mount-expression 正则 ARTIFACT — 移交行为测试
- **已删除**（Round 5）：`Intl.DateTimeFormat` 切片位置 ARTIFACT — 移交行为 probe
- **已删除**（Round 5）：`Intl.DateTimeFormat` + `'UTC'` 字面量 ARTIFACT — 移交 it(10) 行为测试

E2E 脚本类：
- `tests/e2e/brain-time.sh` 文件存在且可执行
- 脚本调用 `/api/brain/time` 端点
- 脚本含字段白名单断言（`Object.keys` 等价 + `jq keys | sort`）
- 脚本含 `.unix | type == "number"` 断言
- 脚本含 unix 字符串 `length <= 10` 断言
- 脚本含 `iso↔unix 差值 <= 2000ms` 断言
- 脚本含严格 ISO 8601 **Z-only** 正则断言
- 脚本含 query 污染免疫断言（`iso=evil` + `Fake`）
- 脚本含非 GET 方法轮询（POST/PUT/PATCH/DELETE 四方法）+ body 注入污染免疫断言
- 脚本含 sanity baseline 步骤（step 7.5） — Round 5 引入
- **脚本定义原则性规则函数 `is_http_error_status`**（`400 ≤ code < 600`）— Round 7 — Reviewer Round 6 Risk 1/2（替代 Round 6 的 8 码枚举）
- **脚本 step 7.5 与 step 8 共用同一原则规则函数**（覆盖面对称 — Reviewer Round 6 Risk 2）
- **脚本 step 8 非 GET 状态码用原则规则判定**（自动排除 200）— Round 7 — Reviewer Round 6 Risk 1
- **脚本 step 8 body key 检查无条件 jq 判定**（解耦 grep 预筛选）— Round 7 — Reviewer Round 6 minor

---

## Workstreams

workstream_count: 1

### Workstream 1: `/api/brain/time` 路由模块 + 聚合器挂接 + 真机 E2E 脚本

**范围**:
- 新增 `packages/brain/src/routes/time.js`（约 20 行）：Express Router，定义 `GET /time` 返回 `{ iso, timezone, unix }`，`iso` 使用 `new Date().toISOString()`（UTC Z 后缀），**`Intl.DateTimeFormat` 调用在 handler 回调体内**（不可缓存在模块顶层；Round 5 起由行为 probe 验证；Round 7 把该 probe 搬到独立测试文件，文件级 worker 隔离为主防线）
- 修改 `packages/brain/src/routes.js`：新增 `import timeRouter from './routes/time.js'`，并**真实聚合挂接**（具体语法形式不限 — 行为判据由 Round 5 新增的 `routes-aggregator.test.ts` 承担）
- 更新 `tests/e2e/brain-time.sh`：Round 7 把 step 7.5/step 8 的状态码判定从 8 码枚举升级为原则规则 `is_http_error_status`（`400 ≤ code < 600`，两处共用）；step 8 body key 检查无条件 jq 判定
- **Round 8 新增（Reviewer Round 7 (b)）— vitest collect 登记硬纪律**：Generator 在实现 `routes/time.js` 前必须从仓库根执行一次 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts`（或等价 `/workspace/node_modules/.bin/vitest run sprints/tests/ws1/time-intl-caching.test.ts`）作为 **collect pre-flight**：若输出含 `No test files found` → 说明 vitest config 把该文件 filter 掉了，必须检查 `packages/brain/vitest.config.js` / `packages/quality/vitest.config.ts` / `packages/engine/vitest.config.ts` / 仓库根（如存在）的字面量 `include` 数组，**显式追加** 能覆盖该路径的 glob（推荐 `sprints/tests/ws1/**/*.{test,spec}.{ts,tsx,js,mjs,cjs}` 或直接 `sprints/tests/ws1/time-intl-caching.test.ts`），并重跑 collect pre-flight 直到看到 `Test Files  1 failed (1)` + `Tests  1 failed (1)` 的红姿态（目标模块 `routes/time.js` 此时尚未实现，红是预期）；**禁止**在看到 `0 tests run` / `0 passed` / `No test files found` 的状态下继续写 Green 实现——那是 collect 机制失效，绿了也不代表 it(13) 真跑过。Round 8 之所以把这条做成"范围内动作"而非"可选建议"，是为了闭合 Reviewer Round 7 的 (a)(b)(c) 三连关切一次到位。
- **不**改 `server.js`、**不**改 DB、**不**新增依赖、**不**动 middleware

**大小**: S（Brain 源码预计 <30 行净新增 + 1 行 import + 1 处聚合挂接；E2E 脚本 ~180 行 bash 已 Proposer 侧交付）

**依赖**: 无（Brain 已有 express + Router 聚合架构；E2E 脚本只依赖 bash + curl + jq，环境已具备）

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/time.test.ts`（**Round 7 = 12 条 `it()`**）+ `sprints/tests/ws1/time-intl-caching.test.ts`（**Round 7 新增独立文件 = 1 条 `it()`**）+ `sprints/tests/ws1/routes-aggregator.test.ts`（**Round 5 引入 = 2 条 `it()`**）

**真机 E2E 脚本**: `tests/e2e/brain-time.sh`（Round 7 = 9 个断言步骤，step 7.5/step 8 共用 `is_http_error_status` 原则规则）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（it 描述） | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/time.test.ts` | **12 条**：1) 200+JSON / 2) 恰好三字段 / 3) iso 2s-of-now / 4) iso 严格 ISO 8601 UTC Z-only / 5) unix 整数秒 / 6) timezone 非空 / 7) timezone 是有效 IANA / 8) iso↔unix 一致 / 9) query 忽略 / 10) UTC fallback / 11) 非 GET 状态 ∈ {404,405} 且不泄漏三字段 key / 12) POST body 不污染 + res.text 原文不含 evil/Fake/Zone 字面 | 模块 `packages/brain/src/routes/time.js` 尚不存在 → vitest import 解析即失败（suite-level 加载错），12 条 it 均未进入 collect（`Tests no tests`）；Generator 按 `contract-dod-ws1.md` 实现后重跑应得 `Tests 12 passed (12)` |
| WS1 | `sprints/tests/ws1/time-intl-caching.test.ts` | **1 条**（Round 7 新增独立文件 — Reviewer Round 6 Risk 3）：13) **timezone 每次请求重新解析（动态 import + 双 mock 切换；文件级 worker 隔离抓顶层缓存）** | **两段红姿态必须严格区分（Round 8 — Reviewer Round 7 (a)+(c)）**：<br/>**① Collect-miss 假红**（禁止出现）：若 `npx vitest run sprints/tests/ws1/time-intl-caching.test.ts` 输出 `No test files found` / `0 tests run` / `Tests 0 (0)` → vitest config include 列表把该文件过滤掉了，collect 机制失效，**不构成合法红证据** — Generator 必须修正 config 并重跑；<br/>**② 模块缺失真红**（期望出现）：Round 7 文件已交付，目标模块 `routes/time.js` 尚未实现时，`Test Files  1 failed (1)` + `Tests  1 failed (1)`，报错信息含 `Failed to load url ../../../packages/brain/src/routes/time.js` 或 `ERR_MODULE_NOT_FOUND` — 这才是 TDD Red 的正确形态；<br/>**③ 就绪 collect 指纹**：`npx vitest list sprints/tests/ws1/time-intl-caching.test.ts` 2>&1 输出含 `Tests  1` 或等价单测 id 行（证明恰好 1 条 it() 被 collect，spy/mock helper 等没被误 collect 成独立 it()）；<br/>**④ Green 期望**：Generator 按 `contract-dod-ws1.md` 实现 `routes/time.js`（不在模块顶层缓存 `Intl.DateTimeFormat`）后重跑，应得 `Test Files  1 passed (1)` + `Tests  1 passed (1)` |
| WS1 | `sprints/tests/ws1/routes-aggregator.test.ts` | **2 条**：14) 真实 `routes.js` 聚合器挂接后 `GET /api/brain/time` 返回 200 + 三字段合规 / 15) `GET /api/brain/__nope__` 非 200（反 catch-all） | `routes/time.js` 尚不存在时，`routes.js` 虽然可动态 import（已 mock 其它子路由 + db/websocket），但 `import timeRouter from './routes/time.js'` 仍会解析失败 → suite 加载错误，2 条 it 均 fail；Generator 实现后重跑应得 `Tests 2 passed (2)` |
| WS1-E2E | `tests/e2e/brain-time.sh` | **9 步断言**（HTTP 200+JSON / 字段白名单 / unix type number / unix length ≤ 10 / ISO 8601 Z-only 正则 / iso↔unix 2s / timezone 非空+IANA 有效 / query 免疫 / **Round 7 step 7.5 baseline ∈ is_http_error_status** / **Round 7 step 8 非 GET 状态码 ∈ is_http_error_status（原则规则 `400 ≤ code < 600`） + body 注入免疫（jq 无条件判定）**） | 脚本存在且可执行；Generator 实现路由并启动 Brain 后真机跑应 `exit 0` 并打印 `[e2e] PASS — all 8 assertions met`；未实现或实现错误则按 step 编号 exit 1..8 或 10/11/75 |

---

## Test Collect Sanity（Round 8 新增 — Reviewer Round 7 (a)(b)(c)；Round 9 硬化 — Reviewer Round 8 Risk 1/2/3/4）

本章节独立于 Test Contract 表，单独列出 collect 层面的可观测契约，使 Reviewer 在不跑具体 it() 断言的情况下就能判定"合同测试是否真正被 vitest 看到 + 是否按预期动态引用目标模块"。覆盖 Reviewer Round 7 的 (a)(b)(c) 和 Reviewer Round 8 Risk 1/2/3/4 一次到位。

**命令 1（就绪指纹 — Round 7 文件已交付 after；对应 Reviewer Round 7 (a)；Round 9 — Reviewer Round 8 Risk 1：改用 JSON reporter 消除文本格式版本依赖；Round 10 — Reviewer Round 9 minor 采纳：三种失败路径 exit 码差异化）**:

```bash
# 从仓库根运行；改用 --reporter=json --outputFile=/tmp/ws1-intl-json.json 替代依赖 "Tests  1" 字符串匹配
# JSON schema 跨 vitest 1.x/2.x/3.x 稳定（numTotalTests/numFailedTests/numPassedTests 字段在 jest-compat JSON 输出里是长期契约）
# vitest 1.6.1 实测输出形如：{"numTotalTestSuites":2,"numPassedTestSuites":2,"numTotalTests":1,"numFailedTests":1,"numPassedTests":0,...}
npx vitest run sprints/tests/ws1/time-intl-caching.test.ts --reporter=json --outputFile=/tmp/ws1-intl-json.json 2>&1 || true

# ----- Round 10 新增：三种失败路径 exit 码差异化（Reviewer Round 9 minor 采纳）-----
# exit 3 = JSON reporter 文件未生成（文件缺失 — vitest 本身崩溃或权限问题）
# exit 1 = JSON 文件存在但解析异常（损坏 / 非 JSON）
# exit 4 = JSON 合法但 collect miss（numTotalTests !== 1 — config include 漏、路径错位、glob 失败）
# exit 2 = collect OK 但红绿态皆不对（既非 1 failed 也非 1 passed — 例如 vitest 跳过了该 it）
# exit 0 = PASS（Red 或 Green 有效状态之一）
# Round 7 后 / Green 前（Generator 未实现 routes/time.js）：numTotalTests === 1 && numFailedTests === 1
# Green 阶段（Generator 实现 routes/time.js）：numTotalTests === 1 && numPassedTests === 1
[ -f /tmp/ws1-intl-json.json ] || { echo "FAIL[exit=3]: JSON reporter 文件 /tmp/ws1-intl-json.json 未生成 — vitest 执行本身异常（权限/崩溃/未安装）"; exit 3; }

node -e '
  let j;
  try {
    j = require("/tmp/ws1-intl-json.json");
  } catch (e) {
    console.error("FAIL[exit=1]: /tmp/ws1-intl-json.json 解析异常 — " + e.message);
    process.exit(1);
  }
  if (j.numTotalTests !== 1) {
    console.error("FAIL[exit=4]: collect 机制异常 — 预期 numTotalTests=1，实际=" + j.numTotalTests);
    process.exit(4);
  }
  // Red 阶段：必须 1 个 failed（模块缺失 / Intl 缓存 mutation 被抓）
  // Green 阶段：必须 1 个 passed
  if (j.numFailedTests !== 1 && j.numPassedTests !== 1) {
    console.error("FAIL[exit=2]: 既非 Red (1 failed) 也非 Green (1 passed) — failed=" + j.numFailedTests + " passed=" + j.numPassedTests);
    process.exit(2);
  }
  console.log("PASS: numTotalTests=1 (failed=" + j.numFailedTests + ", passed=" + j.numPassedTests + ")");
' || exit $?
```

**命令 2（假设文件不存在 — Reviewer Round 7 (c)）**:

```bash
# 对照实验：若 Generator 不小心把 time-intl-caching.test.ts 删除（或路径错位），vitest 应明确报 "No test files found"
# 不是 "0 tests run" / "No tests found" / "Tests  0" — 这类输出都说明 collect 机制未正常拒绝，是假绿风险
#
# Reviewer 可通过临时 mv 模拟后跑（不是 Proposer 交付时的常态动作，只是作为"失败期望形状"的规约）：
#   mv sprints/tests/ws1/time-intl-caching.test.ts /tmp/__hold.test.ts
#   npx vitest run sprints/tests/ws1/time-intl-caching.test.ts --reporter=json --outputFile=/tmp/ws1-missing.json 2>&1 | grep -E "No test files found"   # stderr/stdout 必须命中
#   # 或等价：--reporter=json 失败时也能通过 jq 判定 testResults 长度为 0（numTotalTestSuites === 0）
#   mv /tmp/__hold.test.ts sprints/tests/ws1/time-intl-caching.test.ts
#
# Round 8/9 不要求 Proposer/Generator 实际执行 mv —— 只是在合同里显式规约"预期失败形状"。
```

**命令 3（include 登记确认 — Reviewer Round 7 (b)；Round 9 — Reviewer Round 8 Risk 3：echo 升级为 exit 1 硬判定）**:

```bash
# 仅检查"仓库根" vitest.config.{js,ts} —— Harness v6 evaluator 从仓库根执行
# `npx vitest run sprints/tests/ws1/<file>` 时被实际应用的 config 位置。
# packages/brain/vitest.config.js 的 include 仅覆盖 brain 自身 src/tests
# (PRD 范围限定要求合同测试不污染 brain-ci main 绿线 — RED_EVIDENCE.md:75 备注)，
# 故不纳入本命令范围。
#
# Round 9（Reviewer Round 8 Risk 3）：不合规必定 exit 1，不再 echo-only 软兜底
FAILED=0
for CFG in vitest.config.js vitest.config.ts ; do
  [ -f "$CFG" ] || continue
  # 抽取字面量 include 数组（若存在）
  INCLUDE_BLOCK=$(node -e "const c=require('fs').readFileSync('$CFG','utf8');const m=c.match(/include\s*:\s*\[[\s\S]*?\]/);process.stdout.write(m?m[0]:'')")
  if [ -z "$INCLUDE_BLOCK" ]; then
    echo "[root config OK] $CFG 无字面量 include — vitest 走默认 glob，合同测试能 collect 到 — pass"
    continue
  fi
  # 合法覆盖形式：显式含 sprints/tests / sprints/** / **/*.test.ts / **/sprints/** / 具体文件路径
  if echo "$INCLUDE_BLOCK" | grep -Eq 'sprints/tests|sprints/\*\*|\*\*/sprints|\*\*/\*\.test\.ts|time-intl-caching'; then
    echo "[root config OK] $CFG 字面量 include 能匹配 sprints/tests/ws1/time-intl-caching.test.ts — pass"
  else
    echo "[root config FAIL] $CFG 字面量 include 未覆盖 sprints/tests/ws1/time-intl-caching.test.ts"
    FAILED=1
  fi
done
# Round 9 硬判定（替代 Round 8 的 echo-only）
[ "$FAILED" -eq 0 ] || { echo "FAIL: 仓库根 vitest.config 字面量 include 未覆盖合同测试文件 — exit 1"; exit 1; }
# 当前 Round 9 环境：仓库根无 vitest.config —— Harness 从根跑 vitest 走默认 glob
# `**/*.{test,spec}.?(c|m)[jt]s?(x)`，能 collect 到 sprints/tests/ws1/*.test.ts，FAILED 保持 0 → exit 0
```

### ARTIFACT 稳定 ID 索引（Round 10 — 单源引用 · 闭合 Reviewer Round 9 Major-B "双源漂移面"；Round 11 扩展 B4 防御纵深）

> **结构性原则（Round 10 引入，Round 11 守约）**：
> `contract-dod-ws1.md` 是所有 ARTIFACT `node -e ...` 命令的 **SSOT**（Single Source of Truth）。本合同草案**只按稳定 ID 引用**，**不复制命令文本**。未来任何 ARTIFACT 命令文本修改只会动一处（DoD 文件），不存在"两份文件语义漂移"的风险面。Reviewer 审查本草案时，用 `grep -n '^- \[ \] \[ARTIFACT\] \*\*A[1-4]\*\*\|^- \[ \] \[ARTIFACT\] \*\*B[1-4]\*\*' sprints/contract-dod-ws1.md` 即可定位 8 条命令的确切位置（Round 11：B 系列从 B1–B3 扩展为 B1–B4）。
>
> **ID 表**（合同草案唯一跨文件引用形态；Round 11 新增 B4 行 + 更新 B2 关键正则列）：

| ID | 职责 | 目标文件 | 关键正则/动作 | DoD 原文锚点 |
|---|---|---|---|---|
| **A1** | 文件存在性 | `sprints/tests/ws1/time-intl-caching.test.ts` | `fs.accessSync(...)` | DoD "Round 8/9/10/11 新增 ARTIFACT" 区块第 1 条 |
| **A2** | 顶层 `it(` 恰好 1 个（与 vitest `Tests 1` 强同构） | 同上 | `^\s*it\s*\(` 全局计数 === 1 | DoD 同区块第 2 条 |
| **A3** | 顶层 `describe(` ≥ 1（非空测试文件语义） | 同上 | `^\s*describe\s*\(` 全局计数 ≥ 1 | DoD 同区块第 3 条 |
| **A4** | 仓库根 vitest.config include 登记（若存在字面量 include） | `vitest.config.{js,ts}` at repo root | 字面量 `include:` 必须含 `sprints/tests` / `sprints/**` / `**/sprints/**` / `**/*.test.ts` / 具体文件 | DoD 同区块第 4 条 |
| **B1** | **反面约束**：禁止 top-level static import `routes/time.js`（含 side-effect） — Round 10 修正版 | `sprints/tests/ws1/time-intl-caching.test.ts` | `^\s*import\s+(?:[^;]*from\s+)?['"][^'"]*routes/time\.js['"]` **不得命中** | DoD 同区块第 5 条 |
| **B2** | **正面结构约束**：必须至少一次**字符串字面 target 含 routes/time.js** 的 `await import(...)` — **Round 11 收紧版**（字面体内锁定，注释外注入失效） | 同上 | `await\s+import\s*\(\s*(?:\/\*...\*\/\s*)?(?:"[^"]*routes/time\.js[^"]*"\|<反引号>[^<反引号>]*routes/time\.js[^<反引号>]*<反引号>\|'[^']*routes/time\.js[^']*')\s*\)` **必须命中** | DoD 同区块第 6 条 |
| **B3** | **旁证约束**：必须至少一次 `vi.spyOn(Intl, 'DateTimeFormat')` | 同上 | `vi\s*\.spyOn\s*\(\s*Intl\s*,\s*['"]DateTimeFormat['"]` 必须命中 | DoD 同区块第 7 条 |
| **B4** | **集合性防御纵深**（**Round 11 新增** — Reviewer Round 10 路径 2）：所有 `await import(<字符串字面>)` 中**至少一条**字面体内含 `routes/time.js` | 同上 | `await\s+import\s*\(\s*(?:\/\*...\*\/\s*)?(?:"([^"]*)"\|<反引号>([^<反引号>]*)<反引号>\|'([^']*)')\s*\)` 全局枚举，至少一条捕获组含 `routes/time.js`；exit 1 = 0 条字面 import / exit 2 = target 漂移 | DoD 同区块第 8 条 |

**四重锁链的语义（Round 11 = B1+B2+B3+B4）**：
- **B1** = 反面静态禁令（禁止破坏动态 import 模式；Round 10 补上 side-effect import 缺口）
- **B2** = 正面结构约束（**Round 11 收紧**：动态 import 必须被执行，且 target **必须是字符串字面，字面体内含 routes/time.js**；注释/变量/拼接外注入失效）
- **B3** = 旁证机制约束（Intl spy 机制存在 —— 与 B2 的动态 import 时机结合，才能在模块顶层求值之前 spy 生效）
- **B4** = **Round 11 新增**集合性兜底（即便测试文件追加多条无关字面 import，仍硬保 routes/time.js 是其中之一 target）

**Round 10 → Round 11 的两条关键修补（命令文本仅在 DoD 落定，本处只列规则差异）**：
- **B2**（字面外注入缝隙闭合）：Round 10 正则 `[^)]*` 允许 `routes/time.js` 出现在 paren 内任意非-`)` 位置，包括注释/变量/拼接；**Round 11 改为三种字面变体的明确 alternation**（双引号/反引号/单引号），强制 `routes/time.js` 必须落在字面体内。`await import(someVar /* routes/time.js */)` 类 mutation 不再假绿
- **B4**（Round 11 新增防御纵深）：与 B2 互补 —— B2 验证"存在合规结构"，B4 验证"在所有合规字面 import 中至少一条 target 命中"。即便未来追加 `await import('vitest')` 等无关字面调用，B4 仍硬保 routes/time.js 是其中之一

**Round 8 / Round 9 / Round 10 / Round 11 硬约束总表**（Round 9 把"必须包含/不包含"从依赖文本字符串升级到依赖 JSON schema，与命令 1 同步；Round 10 差异化 exit 码 + B1/B2 正则收紧；Round 11 B2 进一步收紧到字面体内 + 新增 B4 防御纵深）:

| 状态 | vitest 命令 | JSON 报告期望（Round 9 主判据） | 文本输出期望（Round 8 兼容判据，仅参考） | Round 10 exit 码 | 原因 |
|---|---|---|---|---|---|
| Proposer 交付后、Generator 未实现前 | `vitest run sprints/tests/ws1/time-intl-caching.test.ts --reporter=json --outputFile=/tmp/ws1-intl-json.json` | `numTotalTests === 1` **且** `numFailedTests === 1`；stderr 含 `Failed to load url` 或 `ERR_MODULE_NOT_FOUND` | `Test Files  1 failed (1)` + `Tests  1 failed (1)` | `exit 0`（PASS — 合法 Red） | collect 正常 + 模块缺失真红 |
| Proposer 交付后、Generator 实现后 | 同上 | `numTotalTests === 1` **且** `numPassedTests === 1` | `Tests  1 passed (1)` | `exit 0`（PASS — 合法 Green） | TDD Green 阶段 |
| JSON reporter 文件未生成（vitest 本身异常） | 同上 | N/A | N/A | `exit 3` | Round 10 新增差异化 — 文件缺失 |
| JSON 文件解析异常（损坏/非 JSON） | 同上 | 抛异常 | N/A | `exit 1` | Round 10 新增差异化 — 解析失败 |
| 假设测试文件被误删 / 路径错位 → collect miss | 同上 | 退出非 0；`numTotalTests !== 1` 或 `numTotalTestSuites === 0`；stderr 含 `No test files found` | `No test files found` | `exit 4` | Round 10 新增差异化 — collect miss |
| collect OK 但既非 1 failed 也非 1 passed | 同上 | `numTotalTests === 1 && numFailedTests !== 1 && numPassedTests !== 1` | N/A | `exit 2` | vitest 把 it 跳过或其它异常 |
| Round 9 新增 / Round 10 修正：测试文件动态 import 契约破坏 | 静态 ARTIFACT B1/B2/B3（SSOT 位置：`contract-dod-ws1.md` 同名条目） | N/A — 不跑 vitest，直接 `node -e ...` ARTIFACT 判定 | N/A | ARTIFACT 自身 `process.exit(1)` | 测试文件语义完整性（静态 import / target 未绑定 → mutation probe 失效） |
| **Round 11 收紧**：B2 字面外注入 / B4 集合性兜底 | 静态 ARTIFACT B2（收紧）+ B4（新增；SSOT 位置：`contract-dod-ws1.md`） | N/A — 不跑 vitest，直接 `node -e ...` ARTIFACT 判定 | N/A | B2 命中失败 `exit 1`；B4 无字面 import `exit 1` / 字面 import 存在但无一条 target 命中 routes/time.js `exit 2` | 测试文件 import target 字面体内含 routes/time.js（注释/变量/拼接外注入失效，集合内至少一条 target 命中） |

---

## GAN 对抗要点（供 Reviewer 聚焦 Round 11 修订是否充分）

**Round 1 → Round 11 的 mutation 族是否已被一次性堵上**：

| # | Mutation 族 | 旧轮漏洞 | Round 9 堵法（或历代堵法） |
|---|---|---|---|
| 1 | **假 iso 格式**：返回 `new Date().toString()` | Round 1 `it(3)` 能混过 | Round 2 `it(4)` 正则 + Round 3 Z-only 收紧 |
| 2 | **假 iso 格式**：返回 `"2024-01-01T00:00:00"` 无后缀 | Round 1 能混过 | Round 2 `it(4)` 堵 + 保留 |
| 3 | **假 iso 格式**：返回本地偏移 `+08:00` | Round 2 `it(4)` **会 pass** | Round 3 `it(4)` 收紧 Z-only + 保留 |
| 4 | **假 unix（毫秒）** | 已被 `it(5)` 抓住 | 保留 + E2E 双重 |
| 5 | **假 timezone（任意非空字符串）** | Round 1 `it(6)` 能混过 | Round 2 `it(7)` 堵 + 保留 |
| 6 | **字段白名单破坏**：多加 `offset`/`version` | 已被 `it(2)` 抓住 | 保留 + E2E 双重 |
| 7 | **iso 与 unix 不同源** | 已被 `it(8)` 抓住 | 保留 + E2E 双重 |
| 8 | **被 query 污染** | 已被 `it(9)` 抓住 | 保留 + E2E step 7 |
| 9 | **timezone 未 fallback** | 已被 `it(10)` 抓住 | 保留 |
| 10 | **timezone 永远硬编码 UTC** | Round 1 能混过 | Round 2 反向 mock + 保留 |
| 11 | **只挂在单独路径而非聚合器** | Round 2-4 各种正则都能被绕过或误杀 | **Round 5 行为路线**：`routes-aggregator.test.ts` it(14)(15) |
| 12 | **SC-003 E2E 弱断言假阳性** | Round 1 无脚本 | Round 2-7 持续加厚 |
| 13 | **非 GET 方法触发 handler**（`router.all`） | Round 1/2 未规约 | Round 3 `it(11)` + E2E step 8 / Round 4 硬枚举 {404,405} / Round 5 相对化 baseline / Round 6 8 码枚举 / **Round 7 原则规则 `is_http_error_status`** |
| 14 | **POST body 污染** | Round 1/2 未覆盖 | Round 3 it(12) + E2E step 8 / Round 4 追加 `res.text` 字面量反向断言 / **Round 7 E2E body key 检查无条件 jq 判定** |
| 15 | **iso 误用 timezone 偏移** | Round 2 正则会 pass | Round 3 Z-only 正则 + 保留 |
| 16 | **模块顶层缓存 Intl 解析** | Round 2/3 `it(11)` 反向 mock 后 Intl 已缓存；Round 4 ARTIFACT 切片正则被别名绕过 | **Round 5 行为路线**：动态 import + 双 mock 切换；**Round 6 同文件独立 describe + afterAll**；**Round 7 — Risk 3：搬到独立测试文件 `time-intl-caching.test.ts`，vitest file-per-worker 的 OS/VM 级隔离做主防线** |
| 17 | **仅 import 不挂接的假实现** | Round 3 标识符 ≥ 2 次可被注释补齐；Round 4 mount-expression 正则被字符串绕过 | **Round 5 行为路线** — 与 #11 同 |
| 18 | **Brain 全局 middleware 把未命中路径改成 500/401 等**，Round 4 硬枚举会误杀 | Round 4 硬枚举会误杀 | Round 5 step 8 相对化 baseline；Round 6 8 码枚举；**Round 7 原则规则 `400 ≤ code < 600`**，自动接纳任何合法 4xx/5xx |
| 19 | **`app.all('*')` 骗过 routes-aggregator it(14) 的正向断言** | Round 5 it(14) 单独存在时会被骗 | Round 5 新增 it(15) 反向 anti-catch-all |
| 20 | **`== baseline` 等式误杀端点级 vs 全局级 middleware 布局不同的合法实现** | Round 5 step 8 等式硬绑 baseline | Round 6 → 8 码枚举；**Round 7 → 原则规则 `400 ≤ code < 600`**（任何合法 4xx/5xx 都放行） |
| 21 | **`it(11)` 的 Intl spy 泄漏到同文件其它 it** | Round 5 主 describe 块 afterEach 仅软兜底 | Round 6 同文件独立 describe + afterAll；**Round 7 — Reviewer Round 6 Risk 3：搬到独立测试文件，vitest file-per-worker 的 OS/VM 级隔离做主防线，消除 afterAll 不可靠假设** |
| 22 | **8 码枚举外的合法状态码误杀**（Round 6 新引入）：Brain 接入鉴权 → 401/403、限流 → 429（在枚举内）；但 Brain 将来引入 410 Gone、451 Unavailable For Legal Reasons、502 Bad Gateway、503 Service Unavailable、504 Gateway Timeout 等均**不在 8 码枚举内** → step 7.5/step 8 误杀合法实现 | Round 6 枚举固定 | **Round 7 原则规则 `400 ≤ code < 600`**：所有合法 HTTP 4xx/5xx 状态码一次性接纳，无需未来维护枚举；真正的 mutation「POST /time 也 200」仍被抓（200 < 400）；step 7.5 与 step 8 **共用同一函数** `is_http_error_status`，覆盖面天然对称 — Reviewer Round 6 Risk 1/2 同步闭合 |
| 23 | **E2E step 8 body key 检查 gated on grep 预筛选导致的漏检**（Round 6 minor）：若 mutation 以非常规 JSON 格式（字段间多空格/奇异 key 编码）回显三字段 key，`grep -Eq '"(iso\|unix\|timezone)"[[:space:]]*:'` 可能漏命中 | Round 6 先 grep 后 jq | **Round 7 改无条件 jq 判定**：先 `jq -e . "$FILE"` 确认 body 可解析为 JSON，若是则直接 `has("iso") or has("unix") or has("timezone")` 硬断言；不可解析 JSON 走字面量 not-contain 兜底 |
| 24 | **collect-miss 假绿：合同测试文件存在但被 vitest.config 字面量 include 列表 filter 掉** — evaluator 跑 `vitest run sprints/tests/ws1/time-intl-caching.test.ts` 得 `Tests  0` 或 `0 passed` 假绿，Reviewer 误判 Green | Round 7 仅交付独立文件但未规约 collect sanity，Reviewer 无可观测契约去区分"真绿"和"文件被吞假绿" | **Round 8 — Reviewer Round 7 (a)+(c)**：新增 `## Test Collect Sanity` 章节，明文规约两段红姿态（"No test files found" = collect miss 禁区；`Failed to load url routes/time.js` = TDD 真红）+ Round 7 后就绪指纹（`Tests  1`）；Test Contract 表第二行"预期红证据"列拆成 ①②③④ 四个硬子项 —— Reviewer 日后只需对照合同里列出的子串做 grep 就能判定 collect 机制是否正常 |
| 25 | **vitest.config 字面量 include 列表未登记新文件导致跨环境差异** — 本仓库当前 brain/quality/engine 各自有字面量 include 列表但 sprints/ 测试目录不在其中；若 Harness v6 evaluator 在某环境下误用带 include 的 config（而非仓库根默认），新文件不会被跑到 | Round 7 未约束 include 登记，依赖"vitest 默认显式文件路径优先于 include" 的行为假设 | **Round 8 — Reviewer Round 7 (b)**：Workstream 1 范围明文写入 collect pre-flight 纪律 —— Generator 在实现前必须跑一次 `vitest run sprints/tests/ws1/time-intl-caching.test.ts` 看到 `Test Files  1 failed (1)` 才继续；若看到 `No test files found` / `Tests  0` 必须修正 include 列表。`contract-dod-ws1.md` 追加条件性 ARTIFACT：任何字面量 include 的 vitest.config 若用于合同测试运行，必须覆盖该路径。防线从"假设默认行为"升级为"合同硬纪律 + 可观测 pre-flight" |
| 26 | **collect 命令依赖 vitest 文本报告字符串**（Reviewer Round 8 Risk 1）：Round 8 命令 1 用 `grep -Eq "Tests[[:space:]]+1"` 判定 collect 计数，若 vitest 2.x/3.x 修改 summary 行格式（`Test Files 1` → `Files 1` / `Tests: 1`），合同判定误红/漏红 | Round 8 grep `Tests 1` 对 vitest 1.6.1 有效，对未来版本脆弱 | **Round 9 改用 `--reporter=json --outputFile=/tmp/ws1-intl-json.json` + node 解析 `numTotalTests === 1`**：JSON schema 属 jest-compat 长期契约，跨版本稳定；同时保留 `numFailedTests`/`numPassedTests` 分别判定 Red/Green 阶段；文本输出仅作兼容参考（Round 8 兼容判据保留在硬约束表） |
| 27 | **合同草案与 DoD 跨文件漂移**（Reviewer Round 8 Risk 2）：Round 8 `## Test Collect Sanity` 章节描述新 ARTIFACT 的语义但未贴具体 `node -e` 命令行，Reviewer 需跨文件查阅；若两份文件后续词句变更不同步，契约与工具出现缝隙 | Round 8 跨文件指针引用 | **Round 9 `## Test Collect Sanity` 章节新增 `### ARTIFACT 原文粘贴`**：把 Round 8 所有 ARTIFACT（A1/A2/A3/A4）+ Round 9 新增 ARTIFACT（B1/B2/B3）的完整 `node -e ...` 命令原样粘贴进合同草案；任何 DoD 词句变更须同步合同草案。Reviewer 可在合同内核对，无需跨文件 |
| 28 | **gate 脚本 echo-only 软兜底**（Reviewer Round 8 Risk 3）：Round 8 命令 3 仅用 `echo "[root config] ..."` 打印 include 覆盖情况，不 exit；若 Reviewer/CI 直接 source 这段 bash 做 gate，不合规 config 仍返回 exit 0 | Round 8 echo-only | **Round 9 命令 3 加 `FAILED=0` 记账 + 末尾 `[ "$FAILED" -eq 0 ] || exit 1`**：每条违规分支写 `FAILED=1`；末尾硬判定。gate 脚本直接 bash 执行时不合规必定非 0 退出 |
| 29 | **测试文件动态 import 被破坏成静态 import → Intl 缓存 mutation probe 失效**（Reviewer Round 8 Risk 4）：`time-intl-caching.test.ts` 依赖"spyOn 在模块顶层代码执行之前安装 spy"这一时序，通过 `await import(\`...routes/time.js?rev=${Date.now()}\`)` 实现；若未来有人改为 `import timeRouter from '.../routes/time.js'` 顶层静态 import，模块顶层在 spy 未安装时就完成解析 → 顶层 `const CACHED_TZ = Intl.DateTimeFormat()...` mutation 不再被拦住 → 测试假绿 | Round 8 未规约测试文件的 import 形态 | **Round 9 在 `contract-dod-ws1.md` 新增 3 条 ARTIFACT（B1/B2/B3）**：B1 反面约束（禁止 `^\s*import\s+.*from\s+['"].*routes/time\.js['"]`）；B2 正面约束（必须含 `await import(`）；B3 旁证约束（必须含 `vi.spyOn(Intl, 'DateTimeFormat')`）。三条形成"正反+旁证"三重锁链，同步粘贴进合同草案 Test Collect Sanity 章节 |
| 30 | **B1 三重锁链反面约束的 regex 漏 side-effect import**（Reviewer Round 9 Major-A 其一）：Round 9 B1 正则 `^\s*import\s+[^;]*from\s+['"][^'"]*routes\/time\.js['"]` 要求 `from` 子句存在，`import '...routes/time.js'`（无 `from` 的 side-effect import，ESM 里合法）**不会**命中 → 测试文件被偷偷改成 side-effect import 后顶层代码仍会在 spy 未安装前执行 → mutation probe 失效（和整条 B1 缺失时的失效模式等价） | Round 9 正则默认 `from` 必在 | **Round 10 修正 B1 正则**：把 `from \s+` 子句改为可选组 `(?:[^;]*from\s+)?`，新正则 `^\s*import\s+(?:[^;]*from\s+)?['"][^'"]*routes\/time\.js['"]` 同时命中 `import X from '...'` 和 `import '...'` 两种形态。SSOT 位于 DoD · B1 |
| 31 | **B2 三重锁链正面约束的 regex 未绑定 target 路径**（Reviewer Round 9 Major-A 其二）：Round 9 B2 正则 `await\s+import\s*\(` 仅匹配 `await import(` 字面，**任意** target 都满足；测试文件若 Intl mutation probe 部分被删、但保留 `await import('fs')` 等无关行，B2 仍会假绿 → B2 作为"动态 import 契约"的语义失去效力 | Round 9 正则未绑定路径 | **Round 10 修正 B2 正则**：`await\s+import\s*\(\s*[^)]*routes\/time\.js`（`[^)]*` 贪婪匹配 paren 内任意内容直至 `)` 之前，要求其中含 `routes/time.js` 字面）。`await import('fs')` / `await import('path')` 等不再假绿。测试文件当前写法 ``await import(/* @vite-ignore */ `../../../packages/brain/src/routes/time.js?rev7intl=${Date.now()}`)`` 仍命中（paren 内包含 `routes/time.js`）。SSOT 位于 DoD · B2 |
| 32 | **Round 9 双源原文粘贴的漂移面**（Reviewer Round 9 Major-B）：Round 9 把 `contract-dod-ws1.md` 的 ARTIFACT `node -e ...` 原文复制到 `contract-draft.md` `### ARTIFACT 原文粘贴` 区，意图消除跨文件对齐。结果是：同一条命令出现在两个文件里，任一文件修改若未同步就语义漂移；"粘贴+同步纪律"是**工程性兜底**而非**结构性解法** | Round 9 原文粘贴 | **Round 10 根治：单源引用结构**。`contract-dod-ws1.md` 永久作为命令 SSOT；每条 Round 8+9+10 新增 ARTIFACT 赋予**稳定 ID**（A1/A2/A3/A4/B1/B2/B3）；`contract-draft.md` 删除粘贴区，改为按 ID 引用（无命令文本重复）。未来修改命令文本仅触达 DoD 一处，0 漂移风险面。索引表保留在合同草案 `### ARTIFACT 稳定 ID 索引` 章节（列 ID、职责、关键正则规则、DoD 原文锚点 4 列信息） |
| 33 | **命令 1 三种失败路径共用 exit 1 不便于 triage**（Reviewer Round 9 minor）：Round 9 命令 1 用 exit 1 覆盖 collect miss、JSON 解析错误等所有失败情况，Reviewer 肉眼很难快速判断"vitest 本身挂了"vs"合同契约不满足"vs"JSON 格式错" | Round 9 exit 1 归一 | **Round 10 按 Reviewer 建议采纳差异化 exit**：exit 3 = JSON reporter 文件未生成（vitest 执行挂了）/ exit 1 = JSON 解析异常（文件损坏）/ exit 4 = collect miss（`numTotalTests !== 1`）/ exit 2 = 合法 collect 但既非 1 failed 也非 1 passed / exit 0 = 合法 Red 或 Green。硬约束总表新增一列记录对应 exit 码 |
| 34 | **B2 字面外注入缝隙**（Reviewer Round 10 Major）：Round 10 B2 正则 `await\s+import\s*\(\s*[^)]*routes\/time\.js` 用 `[^)]*` 贪婪匹配 paren 内任意非-`)` 字符；`routes/time.js` 字面**可以位于注释内、变量名内、字符串拼接的非 target 部分内**；mutant `await import(someVar /* routes/time.js */)` 假绿。Round 10 的"target 路径锁定"只锁到了 `(...)` 区间，**未真正锁到字符串字面 target 内** | Round 10 `[^)]*` 贪婪 | **Round 11 收紧 B2 到字面体内**：新正则 `await\s+import\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:"[^"]*routes\/time\.js[^"]*"\|<反引号>[^<反引号>]*routes\/time\.js[^<反引号>]*<反引号>\|'[^']*routes\/time\.js[^']*')\s*\)`。语义：paren 内只允许"可选 `/* ... */` 注释 + 一个完整字符串字面（双引号/反引号/单引号三选一）+ 立即闭合 paren"；`routes/time.js` 必须落在字面体内。注释/变量/拼接里的 `routes/time.js` 全部不算。SSOT 位于 DoD · B2。Proposer 本地 mutation 自检：mutant-A `await import(someVar /* routes/time.js */)` 拒绝 / mutant-B `await import('fs')` 拒绝 / 当前合法实现 PASS |
| 35 | **B 系列对未来追加无关 await import 的兜底缺失**（Reviewer Round 10 建议路径 2，Round 11 主动采纳作为防御纵深）：即便 B2 收紧后，单个 `await import(<字面>)` 调用 target 字面体内含 `routes/time.js` 即可命中；若未来测试文件追加多条 `await import('vitest')`/`await import('node:fs')` 等无关字面调用，B2 仍然 PASS（因为它要求"至少一条命中"），但若有人**同时删掉了 routes/time.js 那条**只留下无关调用，B2 就会 fail —— 不过缺乏一条**显式列出"集合中至少一条 target 命中"** 的硬契约用于未来诊断 / 文档锚点 | Round 10 仅 B2 单条 ARTIFACT | **Round 11 新增 B4 防御纵深**：枚举测试文件中所有 `await\s+import\s*\(\s*(?:\/\*...\*\/\s*)?(?:"([^"]*)"\|<反引号>([^<反引号>]*)<反引号>\|'([^']*)')\s*\)` 命中（三种字面变体的捕获组），**至少一条**捕获组含 `routes/time.js`。失败码语义化：exit 1 = 0 条字面 import 调用（mutation probe 完全缺失）；exit 2 = 字面 import 存在但无一条 target 命中（target 漂移）；exit 0 = PASS（matches.length≥1 且至少一条命中）。SSOT 位于 DoD · B4。当前合法实现：1 条字面 import → 反引号字面体内含 routes/time.js → PASS（matches.length===1, ok===true）。与 B2 形成"结构 + 集合"双重锁定 |

## PRD 追溯性

| PRD 条目 | 覆盖位置 |
|---|---|
| FR-001（GET /api/brain/time，无鉴权无 DB） | WS1 route 实现 + ARTIFACT "不 import DB/LLM" |
| FR-002（响应体只含 iso/timezone/unix） | BEHAVIOR `it(2)` 字段白名单 + E2E step 1 + it(14) 聚合行为 |
| FR-003（iso=严格 ISO 8601） | BEHAVIOR `it(3)(4)` + E2E step 4 |
| FR-003（unix=整数秒） | BEHAVIOR `it(5)` + E2E step 2+3 |
| FR-003（timezone=非空且有效 IANA） | BEHAVIOR `it(6)(7)` + E2E step 6 |
| FR-004（挂接到现有聚合器） | **`routes-aggregator.test.ts` it(14)(15) 行为 probe** |
| SC-001（≥3 条单测） | 本合同含 **15 条** it() |
| SC-002（Supertest HTTP 集成） | `tests/ws1/time.test.ts` + `tests/ws1/time-intl-caching.test.ts` + `tests/ws1/routes-aggregator.test.ts` 全程使用 supertest |
| SC-003（真机 curl + jq） | `tests/e2e/brain-time.sh` 9 步断言强等价 BEHAVIOR 核心 it() |
| SC-004（brain-ci 全绿） | 由 CI 保证；合同测试位于 `sprints/tests/` 不进 brain-ci include |
| 边界: timezone Intl 回落 UTC | BEHAVIOR `it(10)` |
| 边界: timezone 非硬编码 / 非顶层缓存 | BEHAVIOR `time-intl-caching.test.ts` it(13) **（Round 7 — 搬到独立测试文件，Risk 3 闭合；file-per-worker 进程/线程级隔离为主防线）** |
| 边界: 忽略客户端输入（query） | BEHAVIOR `it(9)` + E2E step 7 |
| 边界: 忽略客户端输入（非 GET + body） | BEHAVIOR `it(11)(12)` + E2E step 7.5+8 **（Round 7 — 原则规则 `is_http_error_status`，Risk 1/2 闭合）** |
