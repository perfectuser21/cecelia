# Learning — Harness v5 Sprint B: Generator × Superpowers 融合

### 根本原因

Sprint A 把合同升级为"真实测试文件"，但 Generator v4.3 还是按老办法执行——读 DoD，写代码，push——既没有 Red-Green 两次 commit 的 TDD 纪律，也没有调用 4 个 superpowers（test-driven-development / verification-before-completion / systematic-debugging / requesting-code-review）。

风险：
- Generator 能偷偷改合同里的测试让它们"变绿"
- Generator 可以不跑 `npm test` 就声称完成
- Mode 2 修 CI 失败时没有系统化调试流程

Sprint B 的修法：
1. **TDD 两次 commit 纪律**：commit 1 只含 `sprints/*/tests/**/*.test.ts` + `DoD.md`（Red），commit 2+ 才能含实现（Green）。CI 在 Sprint C 会强校验 git log 顺序 + 测试文件 commit 1 后不可改
2. **融入 4 个 superpowers**：
   - `test-driven-development` — Red-Green-Refactor 铁律
   - `verification-before-completion` — push 前实跑并贴 Test Evidence
   - `systematic-debugging` — Mode 2 CI 失败修复的系统化流程
   - `requesting-code-review` — push 前调 subagent 审 diff
3. **红旗章节**：5 种"想要违反纪律"的心态（改测试/跳 TDD/跳验证/加合同外功能/省略测试）+ 反制

### Reviewer 心态复用到 Generator（关键设计选择）

Sprint A 的 Reviewer 有"picky 心态非协商"章节。Sprint B 对 Generator 加了对称的"红旗章节"——5 种常见越界心态 + 显式反制。原理一样：**靠 AI 自觉不可靠，写进 SKILL.md 才是纪律**。

### 为什么不加 code-review-gate

保持 Sprint A 的决策：code-review-gate 的 simplify 功能已被 TDD "GREEN - Minimal Code" + "REFACTOR" 覆盖，requesting-code-review 的 subagent 也会 flag 冗余。双审查增加延迟没收益。

### 为什么测试文件 commit 1 后不可改

防止 Generator 在实现遇阻时"悄悄改测试让它通过"。CI 强校验（Sprint C 实装）：

```bash
# git log: commit 1 touch 的文件必须全是 tests/ + DoD.md
# commit 2+ touch 的文件 diff 中 tests/*.test.ts 必须为空
```

测试是合同一部分，改测试 = 改合同 = 重走 GAN。

### 下次预防

- [ ] Sprint C 必须实装 CI 校验：测试文件 commit 1 后 diff 为空 + commit 1 只含 tests/DoD + commit 2+ 含实现
- [ ] Generator 上线后观察：有没有 Generator 违反红旗心态的案例，若有要在 Sprint D 加更多显式反制
- [ ] 监控 Generator Mode 2 (harness_fix) 调试质量，确认 systematic-debugging 真起作用而不是只是 prompt 装饰
- [ ] 合并后做 dogfood 验证（像 Sprint A 那样派真实任务），核对 Generator 是否真按 TDD 两次 commit 执行

### 关键事实

**版本对齐**：
- Proposer v5.0 / Reviewer v5.0（Sprint A 已合并）
- Generator v5.0（Sprint B 本次）
- sprint-generator v3.1 保留（老 flow 不 deprecated，因还可能有依赖；新任务都走 harness-generator）

**CI 强校验放在 Sprint C**：
- Sprint B 只改 SKILL.md prompt，不动 CI workflow。
- 如果 Sprint C 迟迟不上，Generator 可能靠"自觉"跑 TDD，没 CI 兜底。这是已知风险。

### 工程洞察

**prompt engineering 的唯一自动化防护 = 结构测试 + CI 强规则**：

- 结构测试（vitest 读 SKILL.md）保证 prompt 里含必需章节——但不保证 LLM 真的照做
- CI 强规则（git log / file diff）保证 LLM 行为落到 commit 上——但必须等 Sprint C 实装
- Sprint A dogfood 已证明 Reviewer 对 Proposer 输出能做 mutation 挑战，同样的机制将在 Generator 上验证（post-merge）
