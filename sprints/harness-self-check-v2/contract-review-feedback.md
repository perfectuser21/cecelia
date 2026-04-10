# Contract Review Feedback (Round 3)

**判决**: REVISION

> Round 3 草案相比 R2 有显著改进：废弃了纯计数验证和 accessSync，引入了块级拆分和结构性断言检查。但 9 条命令中仍有 6 条可被"最懒假实现"绕过——核心弱点是**长度阈值 ≠ 内容有效性**以及**三元组格式检查 ≠ 关联性验证**。

---

## 对抗证伪分析（三元组）

---

### 三元组 1 — Feature 1 验证 1: Feature 块内容实质性校验

命令：`node -e` 拆分 `## Feature N` → 验证描述文本>=50字符 + bash块>=30字符

最懒假实现：写4个 `## Feature N` 标题，每个下放一段>=50字符的无意义填充文本（"这是一段填充文本用于通过字符长度检查..."），加一个 `echo "三十字符以上的假命令"` 的 bash 块

能否绕过：YES — 命令只做字符长度统计，不验证 bash 块内是否包含**实际验证工具调用**（`node -e`/`curl`/`bash`/`psql`）。一个 `echo` 假命令就能通过 >=30 字符阈值。

---

### 三元组 2 — Feature 1 验证 2: DoD [BEHAVIOR] 格式链验证

命令：`node -e` 检查 `- [ ] [BEHAVIOR]` 后紧跟 `Test: ` 且 >=10 字符

最懒假实现：写 `- [ ] [BEHAVIOR] 空描述\n  Test: echo "1234567890"` — Test 行用 echo 填充到 10 字符

能否绕过：YES — Test 行只做长度检查（>=10字符），不验证 Test 命令是否使用 CI 白名单工具（`node`/`npm`/`curl`/`bash`/`psql`）。随机字符串或 `echo` 均可通过。

---

### 三元组 3 — Feature 2 验证 1: 三元组数量+命令行实质内容

命令：`node -e` 按 `---` 分块 → 检查每块含 `命令：`+`最懒假实现：`+`能否绕过：` + 命令内容>=10字符

最懒假实现：写 N 个 `---` 块（N = ceil(草案bash块数 × 0.6)），每块填 `命令：echo hello world test\n最懒假实现：touch file\n能否绕过：YES 因为可以`

能否绕过：YES — "命令："字段只做长度检查（>=10字符），不验证该命令是否**与草案中某条实际 bash 命令对应**。完全编造的命令字符串即可通过。

---

### 三元组 4 — Feature 2 验证 2: 判决格式

命令：`node -e` 正则匹配前30行 `**判决**: REVISION|APPROVED`

最懒假实现：第一行写 `**判决**: REVISION`，其余内容为空

能否绕过：NO — 正则精确匹配 `**判决**` + 冒号 + 判决值，格式验证职责单一且准确。配合三元组验证命令形成组合覆盖。

---

### 三元组 5 — Feature 3 验证 1: bash块内无accessSync + 结构性断言>=4块

命令：`node -e` 提取 bash 块 → accessSync=0 + 含 `.match(`/`.test(`/`JSON.parse`/`.split(` 的块>=4

最懒假实现：写4个 bash 块，每块内 `node -e "x.split('a').match(/b/);JSON.parse('{}')"` — 含所有关键函数名但不做任何断言

能否绕过：YES — 只检查函数名**存在**，不验证函数名被用于**断言逻辑**。bash 块内调用 `.split().match()` 但不含 `throw`/`process.exit(1)` 的命令可通过。

---

### 三元组 6 — Feature 3 验证 2: git远端R2分支存在

命令：`node -e` + `git ls-remote --heads origin cp-harness-propose-r2-*`

最懒假实现：无法构造——git 远端状态不可本地伪造

能否绕过：NO — 二进制事实验证，强命令。

---

### 三元组 7 — Feature 4 验证 1: 最终合同内容完整性+YES=0+结构化NO

命令：`node -e` Feature 块描述>=50字符 + bash块>=30字符 + YES=0 + NO 在 `---` 块内与"命令："同现

最懒假实现：复用三元组 1 的假实现（填充文本+假bash块），加一个 `---\n命令：假命令超过十个字符\n能否绕过：NO\n---` 块

能否绕过：YES — 与三元组 1 同样的弱点（长度≠有效性），结构化NO检查也只验证格式（"命令："与"能否绕过：NO"同块），不验证 NO 对应的是实际证伪分析。

---

### 三元组 8 — Feature 4 验证 2: 反馈文件三元组+YES

命令：与 Feature 2 验证 1 完全相同的逻辑

最懒假实现：同三元组 3

能否绕过：YES — 理由同三元组 3（命令字段不验证与草案实际命令的关联性）

---

### 三元组 9 — WS1 DoD [ARTIFACT]: contract-draft.md 存在且内容完整

命令：`node -e` 拆分 Feature 块 → 描述>=50字符 + bash块>=30字符

最懒假实现：同三元组 1

能否绕过：YES — 同三元组 1

---

## 必须修改项

### 1. [命令太弱] Feature 1/4 — bash 块长度检查应升级为工具调用验证
**问题**: 多处验证 bash 块 >=30 字符长度，但 `echo "..."` 假命令即可通过
**影响**: 空壳草案/合同能通过所有 Feature 1 和 Feature 4 验证
**建议**: bash 块验证增加一条：块内必须包含 `node -e`、`curl`、`bash`、`psql` 或 `npm` 中至少一个（CI 白名单工具调用），而非仅检查字符长度。示例：
```javascript
const hasToolCall = /\bnode\s+-e\b|\bcurl\s|\bbash\s|\bpsql\s|\bnpm\s/.test(block);
if (!hasToolCall) throw new Error('FAIL: bash块无CI白名单工具调用');
```

### 2. [命令太弱] Feature 1 验证 2 — Test 行缺少白名单工具验证
**问题**: Test 行只检查 >=10 字符，`echo "xxxx"` 可通过
**影响**: DoD 条目可用无效测试命令蒙混
**建议**: Test 行正则增加白名单工具前缀检查：`/^Test:\s*(node|npm|curl|bash|psql|manual:)/`

### 3. [命令太弱] Feature 2/4 — 三元组"命令："字段应关联草案实际命令
**问题**: 三元组的"命令："只做 >=10 字符长度检查，编造命令可通过
**影响**: 证伪分析可能与草案命令完全无关，失去验证意义
**建议**: 提取草案中所有 bash 块的前 N 字符作为指纹集，验证三元组"命令："字段的内容能在指纹集中找到模糊匹配（如前20字符子串匹配）。示例：
```javascript
const draftCmdFingerprints = draftBashBlocks.map(b => b.replace(/```bash\n?|```/g,'').trim().slice(0,40));
// 三元组命令至少需匹配某个指纹的前20字符子串
```

### 4. [命令太弱] Feature 3 验证 1 — 结构性断言检查应同时要求失败路径
**问题**: bash 块含 `.match()`/`.split()` 但不含 `throw`/`process.exit(1)` 也能通过
**影响**: 假命令可调用断言函数但不做任何判断就退出码0
**建议**: 含结构性断言的 bash 块同时需包含 `throw` 或 `process.exit` 关键字

## 可选改进

- Feature 描述文本的 50 字符阈值偏低，建议提升到 100 字符以增加填充攻击难度
- 可考虑增加 Feature 间命令不重复的检查（当前 Feature 2 验证 2 和 Feature 4 验证 2 是完全相同的命令）
