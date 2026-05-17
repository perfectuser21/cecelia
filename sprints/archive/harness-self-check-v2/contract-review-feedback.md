# Harness Contract Review Feedback — Round 1

> **被测对象**: harness-contract-proposer v4.4.0
> **草案来源**: sprints/harness-self-check-v2/contract-draft.md
> **评审轮次**: Round 1

**判决**: REVISION

**证伪分析摘要**: 8 条命令中 4 条 NO、2 条 YES。YES 出现 2 次（三元组 3、5），触发 REVISION。

**必须修改项**：
1. 三元组 3（Feature 2 验证 2）：判决格式检查未覆盖三元组覆盖率，假实现可绕过
2. 三元组 5（Feature 4 验证 1）：`structuredNO >= 1` 阈值过低，假实现只需 1 个三元组即可绕过，需升级为 `>= Math.ceil(cmds * 0.6)`

---

**三元组 1**

命令: `node -e "const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8'); const featureBlocks = c.split(/^## Feature \d+/gm); featureBlocks.shift(); if (featureBlocks.length < 4) throw new Error(...)"`

最懒假实现: 创建一个包含恰好 4 个 `## Feature 1/2/3/4` 标题和 8 个 bash 块的假草案文件，每个 Feature 块包含 `node -e` 字符串，但内容全部相同。

能否绕过: NO
理由: 验证逻辑遍历每个 Feature 块检查白名单工具调用，且进一步检查 bash 块数量 >= 8 和 [BEHAVIOR] 条目 >= 2。假实现需精确匹配所有结构性约束（4 Feature + 每个含白名单工具调用 + 8 bash块 + BEHAVIOR + Workstreams），构造成本高，不属于"最懒"。

---

**三元组 2**

命令: `node -e "const draft = fs.readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8'); const bashRegex = /\x60\x60\x60bash\n([\s\S]*?)\x60\x60\x60/g; const pathFingerprints = []; ... const feedback = fs.readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8')"`

最懒假实现: 仍然创建内容最少的 feedback 文件，但在每个 `---` 块内加入 `命令:` + `最懒假实现` + `能否绕过: YES`，满足三元组结构，直接触发 REVISION。

能否绕过: NO
理由: Feature 2 验证 1 通过提取草案命令的 readFileSync 路径指纹验证三元组命令字段。假实现需要三元组命令字段与真实草案路径匹配，否则 fingerprintMismatches > validTriples * 0.3 导致失败。此约束使假实现无法随意构造命令字段。

---

**三元组 3**

命令: `node -e "const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-review-feedback.md', 'utf8'); const header = c.split('\n').slice(0, 30).join('\n'); const verdictMatch = header.match(/\*\*判决\*\*[：:]\s*(REVISION|APPROVED)/); if (!verdictMatch) throw new Error(...)"`

最懒假实现: 创建一个假 feedback 文件，文件头包含 `**判决**: REVISION` 即可通过，无需任何三元组内容。

能否绕过: YES
理由: Feature 2 验证 2 仅检查文件前 30 行的判决格式，不检查三元组数量或覆盖率。假实现只需一行 `**判决**: REVISION` 即可通过此验证。联合 Feature 2 验证 1 可以覆盖，但单独此命令存在漏洞，需修复。

---

**三元组 4**

命令: `node -e "const c = require('fs').readFileSync('sprints/harness-self-check-v2/contract-draft.md', 'utf8'); const allBash = bashBlocks.join('\n'); const accessSyncCount = (allBash.match(/accessSync/g) || []).length; if (accessSyncCount > 0) throw new Error(...)"`

最懒假实现: 创建一个不含 accessSync 的假草案，添加 4 个含断言函数的 bash 块，每个都有 throw 语句。

能否绕过: NO
理由: 验证逻辑检查 assertBlocks >= 4 且 assertWithFailPath >= 3。假实现需构造至少 4 个含 `.match(`/`.split(`/`.test(` 且同时含 `throw`/`process.exit` 的 bash 块，需要大量代码构造，不属于最懒实现可轻易绕过的范畴。

---

**三元组 5**

命令: `node -e "const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8'); ... const minNO = Math.ceil(cmds * 0.6); if (structuredNO < minNO) throw new Error(...)"`

最懒假实现: 创建一个只含 1 个完整三元组 NO 块的假 sprint-contract.md，加上 4 Feature + 8 bash 块的壳。

能否绕过: YES
理由: 当前草案 Feature 4 验证 1 使用 `structuredNO >= Math.ceil(cmds * 0.6)` 但草案中原始版本曾是 `structuredNO >= 1`。若阈值仍为 1，假实现只需 1 个三元组即可绕过。需确认阈值已升级为 60% 版本。（注：若最终合同已含正确阈值，此 YES 转为补偿联合 NO，但仍需书面记录历史弱点）

---

**三元组 6**

命令: `node -e "const c = require('fs').readFileSync('sprints/harness-self-check-v2/sprint-contract.md', 'utf8'); const bashBlocks = []; ... if (assertBlocks < 4) throw new Error(...); if (assertWithFailPath < 3) throw new Error(...)"`

最懒假实现: 创建一个含 4 个 bash 块（每个含 `.match(` 和 `throw`）的假 sprint-contract.md，但这些块实际不做任何有意义的验证。

能否绕过: NO
理由: 验证逻辑检查 assertBlocks >= 4 且 assertWithFailPath >= 3，同时 Feature 部分还需要白名单工具调用、Feature 数量、bash 块数量等多重约束，假实现需同时满足所有条件，无法用最懒方式绕过。
