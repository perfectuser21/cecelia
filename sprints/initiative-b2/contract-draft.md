# Sprint Contract Draft (Round 1)

读取 PRD：`sprints/sprint-prd.md`（Initiative B2：建立 Initiative 标识与发现入口）

---

## Feature 1: Initiative B2 标识清单（数据）

**行为描述**:
仓库提供一份 Initiative B2 的"参考身份"清单，是一个结构化数据文件（JSON），包含 `initiative_id`、`title`、`description`、`status` 四个字段。这份清单是回归测试与 Brain 调度可以稳定引用的锚点；无论谁拿到它，都能复刻出与 PRD 描述一致的 Initiative 元数据。

**硬阈值**:
- 文件路径：`sprints/initiative-b2/manifest.json`
- 字段集合：必须同时包含 `initiative_id`、`title`、`description`、`status` 四个键
- `status` 字段值必须是字符串 `"active"`
- `description` 字段是字符串，长度（按 JS 字符串 `.length`，等价于 UTF-16 code units）≥ 60
- `initiative_id` 字段必须是非空字符串，且包含子串 `B2`（不区分大小写）

**BEHAVIOR 覆盖**（在 `tests/ws1/` 里落成真实 it() 块）:
- 无（这一项是纯静态产物，全部由 ARTIFACT 覆盖）

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md`）:
- `sprints/initiative-b2/manifest.json` 文件存在
- `manifest.json` 是合法 JSON
- `manifest.json` 含 4 个必备字段（`initiative_id`/`title`/`description`/`status`）
- `manifest.json.status === "active"`
- `manifest.json.description.length >= 60`
- `manifest.json.initiative_id` 含 `B2`（不区分大小写）

---

## Feature 2: 发现入口（discover）

**行为描述**:
仓库提供一段可被 Node 代码直接 `import` 调用的 ESM 模块，对外导出一个具名函数 `discoverInitiativeB2`。该函数无参数、纯读取 manifest.json，返回与 manifest 等价的结构化对象（`initiative_id` / `title` / `description` / `status`）。多次调用幂等、无副作用，且返回的 `status` 始终为 `"active"`，描述长度始终 ≥ 60。即使在 manifest 内容刚被修改但模块缓存仍存在的情况下，调用也不应抛出异常或污染调用方进程状态。

**硬阈值**:
- 模块路径：`sprints/initiative-b2/discover.mjs`
- 必须导出具名函数 `discoverInitiativeB2`
- 调用一次返回的对象必须包含 4 个必备字段，类型分别为 string / string / string / string
- 返回对象的 `status === "active"`
- 返回对象的 `description.length >= 60`
- 连续调用两次，返回值必须 deeply equal（幂等）
- 调用不能向 FS 写入或修改任何文件（无副作用）
- 不引入新依赖：discover.mjs 必须只 import Node 内置模块（`node:fs` / `node:path` / `node:url` 等）

**BEHAVIOR 覆盖**（在 `tests/ws1/` 里落成真实 it() 块）:
- `it('exports a named function discoverInitiativeB2')`
- `it('returns an object with all four required fields as strings')`
- `it('returns status equal to "active"')`
- `it('returns description with length >= 60')`
- `it('returns initiative_id containing "B2" (case-insensitive)')`
- `it('is idempotent — two consecutive calls return deeply equal objects')`
- `it('has no filesystem side effects on call')`

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md`）:
- `sprints/initiative-b2/discover.mjs` 文件存在
- `discover.mjs` 源码包含 `export ... discoverInitiativeB2`
- `discover.mjs` 仅 import `node:` 前缀的内置模块（不引入新依赖）

---

## Feature 3: 文档索引登记

**行为描述**:
仓库的"文档索引"——`docs/current/README.md`——里追加了一条指向 Initiative B2 标识清单的稳定链接。新接手的开发者打开索引、检索关键词 "Initiative B2"，至少能命中一条结果，并通过该结果跳转到 `sprints/initiative-b2/manifest.json`（或其所在目录）。重复条目不构成错误，但索引中关于 Initiative B2 的命中数必须 ≥ 1。

**硬阈值**:
- `docs/current/README.md` 中"Initiative B2"关键词命中行数 ≥ 1
- 该命中行同时包含到 `sprints/initiative-b2/` 的相对路径（即 `sprints/initiative-b2` 子串）

**BEHAVIOR 覆盖**:
- 无（静态文档登记，全部由 ARTIFACT 覆盖）

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md`）:
- `docs/current/README.md` 含 ≥ 1 行同时出现 `Initiative B2` 与 `sprints/initiative-b2`

---

## Feature 4: 协同自动化检查

**行为描述**:
仓库提供一个最小自动化检查脚本 `check.mjs`，负责把 Feature 1 / 2 / 3 串起来跑一遍：(a) 通过 discover 拿到 manifest 元数据并校验 4 个字段、status、description 长度、id 含 B2；(b) 校验文档索引含 Initiative B2 条目。整个流程在干净仓库 checkout 后单次执行 exit code = 0。当 manifest 或文档索引被破坏（如 manifest 文件被删除、status 被改、文档索引未登记），check.mjs 必须 exit code ≠ 0 并把错误信息打到 stderr，明确指出缺失的产物，而不是静默通过。

**硬阈值**:
- 脚本路径：`sprints/initiative-b2/check.mjs`
- 在干净仓库根目录运行 `node sprints/initiative-b2/check.mjs`，exit code = 0
- 当 `sprints/initiative-b2/manifest.json` 被删除时，运行 `node sprints/initiative-b2/check.mjs`，exit code ≠ 0，且 stderr 含与 "manifest" 相关的提示子串
- 不引入新依赖：check.mjs 仅 import Node 内置模块或 sibling 的 `discover.mjs`

**BEHAVIOR 覆盖**（在 `tests/ws1/` 里落成真实 it() 块）:
- `it('exits with code 0 in a clean checkout')`
- `it('exits with non-zero code and reports manifest error when manifest.json is missing')`

**ARTIFACT 覆盖**（写进 `contract-dod-ws1.md`）:
- `sprints/initiative-b2/check.mjs` 文件存在
- `check.mjs` 源码包含 `import` `discover.mjs`（验证从代码层面引用了 Feature 2，避免实现成"复制粘贴 manifest 校验逻辑"绕过 discover）
- `check.mjs` 仅 import `node:` 前缀模块或 `./discover.mjs`

---

## Workstreams

workstream_count: 1

### Workstream 1: 建立 Initiative B2 标识清单 + discover + check + 文档索引登记

**范围**:
- 新增 `sprints/initiative-b2/manifest.json`（4 个字段，status=active，description ≥ 60 字符，id 含 B2）
- 新增 `sprints/initiative-b2/discover.mjs`（导出 `discoverInitiativeB2`，纯读取，无副作用）
- 新增 `sprints/initiative-b2/check.mjs`（import discover.mjs，串起来跑，含失败路径）
- 修改 `docs/current/README.md`（追加 1 条指向 `sprints/initiative-b2` 的索引条目）

总改动 < 100 行 → S 大小，单一 workstream 即可（与其他 workstream 无交集）。

**大小**: S（< 100 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**:
- `sprints/initiative-b2/tests/ws1/discover.test.ts`（覆盖 Feature 2 的 7 个 it）
- `sprints/initiative-b2/tests/ws1/check.test.ts`（覆盖 Feature 4 的 2 个 it）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/initiative-b2/tests/ws1/discover.test.ts` | exports named function / returns 4-field object / status = active / description ≥ 60 / id contains B2 / idempotent / no FS side effects | `npx vitest run sprints/initiative-b2/tests/ws1/discover.test.ts` → 7 failures（discover.mjs 模块未实现，import 失败 → 全部 it 失败） |
| WS1 | `sprints/initiative-b2/tests/ws1/check.test.ts` | exits 0 in clean checkout / exits non-zero + reports manifest error when manifest missing | `npx vitest run sprints/initiative-b2/tests/ws1/check.test.ts` → 2 failures（check.mjs 不存在，spawn 报 ENOENT） |

合计：**WS1 → 9 个 BEHAVIOR it，预期 9 红**。

---

## 不在范围内（与 PRD 一致）

- 不创建新的 HTTP 端点
- 不修改 Brain 调度逻辑
- 不引入新依赖（manifest.json / discover.mjs / check.mjs 仅用 Node 内置模块）
- 不改 CI 工作流（仅在 sprints/initiative-b2/ 内追加测试文件，依靠仓库已有 vitest 调度）
