---
branch: cp-03292009-sprint-contract
date: 2026-03-29
task: 升级 /dev Sprint Contract 机制：Evaluator Calibration + 双向协商 DoD
---

# Learning: Sprint Contract 机制升级

## 根本原因

原 /dev Pipeline 中 spec_review 存在"自我认证"漏洞：
1. 主 agent 自己写 DoD + Test 字段
2. spec_review 只检查 Test 字段格式是否合规，不独立验证测试方案是否有效
3. 结果：主 agent 可以写出循环自证的 Test（测试本质上只是"文件存在"而不是"功能运行"），spec_review 礼貌性通过

另外 code_review_gate 没有 calibration examples，Evaluator 的判断标准会随调用轮次漂移（有时过严，有时过宽）。

## 修复要点

### 1. spec_review Sprint Contract 协议（spec-review/SKILL.md v1.3.0）

GAN 式双向协商协议：
- Step 1：**遮蔽** Test 字段，只看 DoD 条目描述
- Step 2：**独立写**验证方案（不受主 agent Test 字段影响）
- Step 3：**比对**独立方案 vs 主 agent Test 字段
- Step 4：方向分歧 → `dimension="SC"` blocker；一致 → 通过

关键洞察：如果 Evaluator 先看了 Test 字段再倒推判断，就失去了独立性。遮蔽 → 独立 → 比对 是检测循环认证的唯一方法。

### 2. code_review_gate Evaluator Calibration（SKILL.md v1.6.0）

3 个定锚样例防止判断漂移：
- **FAIL 样例**：SQL 注入（维度 A blocker）→ Evaluator 看到此类 pattern 必须 FAIL
- **PASS 样例**：参数化查询 + 完整错误处理 → Evaluator 不应在无 blocker 时 FAIL
- **Boundary 样例**：只有 info 级问题（命名 + console.log）→ Evaluator 不应升级为 FAIL

### 3. 01-spec.md Sprint Contract 指令（v2.4.0）

在 spec_review subagent prompt 中新增 5 步执行要求，确保每次调用都执行 Sprint Contract 协议。

## 关键决策：[GATE] CI 测试项不能用 process.exit(0) 占位

spec_review 连续两次 FAIL 在这个点上：
- `process.exit(0)` hardcoded = 永远通过 = 假测试 → blocker
- 解决方案：直接删除 [GATE] CI 全部通过 这条 DoD（CI 通过由合并过程本身强制，不需要本地验证项）

规律：[GATE] 条目必须有真实 exit code 断言，不能是 `echo` 或 hardcoded `process.exit(0)`。

## 下次预防

- [ ] [GATE] 条目的 Test 字段必须有实际逻辑断言（不能 hardcoded process.exit(0)）
- [ ] 对于"CI 全部通过"这类元测试，直接省略该 DoD 条目，由合并流程强制
- [ ] packages/workflows/ 子树改动时，task card 需双写（root + packages/workflows/），`.prd-{branch}.md` 也需要创建
- [ ] spec_review 第一次 FAIL 时，读 root cause 再修，不要只改表面格式
- [ ] DoD 中 [BEHAVIOR] 条目要验证行为，不要全是 [ARTIFACT] 文件检查（CI L1 强制要求有 [BEHAVIOR]）
