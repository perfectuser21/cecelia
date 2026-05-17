# Learning — Harness v5 Sprint C: CI 硬校验上线

### 根本原因

Sprint A/B 把 v5.0 的合同纪律（DoD 分家 / 测试真实 / Red-Green 两次 commit）写进 SKILL.md 提示词——靠 LLM 自觉。自觉不可靠，必须靠 CI 机器强规则。

Sprint C 把 4 条核心纪律落成 CI 检查：

1. **dod-structure-purity**（check-dod-purity.cjs）
   - contract-dod-ws{N}.md **禁** [BEHAVIOR] 条目
   - Test 字段白名单 manual:/tests//contract:/node/npm/curl/bash/psql
2. **test-coverage-for-behavior**（check-test-coverage.cjs）
   - 合同 `## Test Contract` 表必须有，声明的 Test File 必须存在
   - BEHAVIOR 覆盖项名必须在 `.test.ts` 有对应 `it()`
3. **tdd-commit-order**（check-tdd-commit-order.sh）
   - commit 1 只含 tests/ + DoD.md + contract-dod-ws
   - commit 2+ 必须含实现代码，测试文件不许改
   - message 标签 (Red) / (Green) 或 test( / feat( 前缀
4. **tests-actually-pass**（inline workflow 里跑 vitest）
   - PR diff 里新增的 sprints/*/tests/*.test.ts 必须真实 PASS

### 软门禁 1 周观察期（关键设计选择）

所有 4 个 job 初始 `continue-on-error: true`——**检查会跑，但失败不阻塞 PR**。

这样做的理由：
- 脚本本身可能有 bug（误杀正常 PR）
- 存量合同可能不完全符合新规则（老 sprint 还没归档）
- 给 1 周时间收集 false positive，再决定切硬

切硬门禁的触发条件（写进本 Learning 的 TODO）：
- 至少 3 个真实 harness PR 跑过，4 个 check 全绿
- 无误杀记录
- 老 sprint 归档 PR（Sprint C-b）已合并

### 为什么 Sprint C 不做老 sprint 归档

按 spec Section 5.3：归档 PR **单独 1 个 PR**，不和 CI 改动混。理由：

- 归档是纯 `git mv`，改动大但无风险
- 如果和 CI 改动混：CI 新 check 扫到老 sprint 数据可能误报；排障时混淆
- 拆成 Sprint C-b 独立 PR：先合 CI（本次），后合归档

### 工程洞察

**prompt + CI 双层防御**（v5.0 的完整形态）：

| 层 | 作用 | 违反代价 |
|---|---|---|
| SKILL.md prompt（Sprint A/B） | 指导 LLM 该怎么做 | LLM 可能不听 |
| 结构测试（all sprints） | 保证 SKILL.md 含必需章节 | prompt 退化抓不到 |
| CI 硬规则（Sprint C） | 保证 LLM 输出落到 commit 上符合纪律 | **机器抓到就 fail PR** |

前两层是"软约束"，第三层才是"硬约束"。Sprint C 是让 v5.0 从"设计"变成"强制"的关键一步。

### 下次预防

- [ ] Sprint C-b（独立 PR）：归档老 sprint 到 `sprints/archive/`，CI 新 check 排除 archive/
- [ ] 观察期结束（~1 周）：根据 false positive 率决定切硬门禁 + 移除 continue-on-error
- [ ] 监控每个 check 的 P95 执行时间，若某个超过 60s 优化
- [ ] 观察期内如有 3 次连续误杀同一 check → 该 check 脚本有 bug，修完重新计时
- [ ] check-dod-purity 暂未校验 BEHAVIOR 索引 header 与测试文件 it() 的交叉匹配（为 test-coverage 负责）——不要重复校验
- [ ] 发生真实的 fail PR 时，日志必须清晰指出**哪行违规 + 怎么修**（check-dod-purity 已做到；test-coverage / tdd-commit-order 需要真实使用中验证提示清晰度）

### 关键事实

- **Sprint A/B 已合并**：Proposer v5.0 / Reviewer v5.0 / Generator v5.0
- **Sprint C 本次**：4 CI checks + 软门禁 1 周观察期
- **Sprint C-b 后续**：老 sprint 归档
- **切硬时机**：观察期结束 + 归档后 + 无误杀

### 为什么 check-test-coverage 用"子串匹配"判断 it 名

合同里的"BEHAVIOR 覆盖项名"是人类可读摘要（如 `retries 3 times`），而 `.test.ts` 里 it() 名是代码（如 `it('retries 3 times on transient failure')`）。严格相等匹配会过严失败。改成**子串双向匹配**（任一方含另一方）更贴近真实意图。

副作用：可能漏报（两者完全无关但巧合同字符）。观察期会暴露这类情况。
