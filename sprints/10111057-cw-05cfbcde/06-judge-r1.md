# 独立裁判（第 1 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r1.md
- 总评：I-1 至 I-5 的接口实现均有预览或本机真实 HTTP 证据支持，当前没有阻断需求满足的问题。需要修复 smoke 脚本在 guard 失败时 exit 0 的静默成功，否则验证闸门可能误报通过。

## 需求覆盖

### I-1
- 满足
- 依据：代码在 packages/brain/src/routes/runs-read.js 中以参数化查询返回 runs 全量字段，并支持单段 run_id、编码或裸冒号路径；T-1、T-2 在预览环境真实 POST 后 GET，均返回 200，字段、值及 cost/tokens 均被 jq 断言；T-9 也验证了新路由在带 token 时可用。

### I-2
- 满足
- 依据：代码在 runs-read.js 中对 include 参数支持重复参数、逗号拆分和 trim，并在只读事务中按 started_at、created_at、id 升序查询 spans；T-4 真实验证乱序 span 返回为 qa/a、qa/b，且不带 include 或 include=foo 时没有 spans；X-1 额外验证了重复 include、空格和 20 次并发读取。

### I-3
- 满足
- 依据：代码显式处理空值、超长值、404、参数化查询和 URIError；T-7 真实验证不存在、include=spans 和 SQL 注入式输入均为 404；T-8 真实验证空白、空路径、201 字符、恰好 200 字符和非法编码分别得到预期 400/404，未出现 500。

### I-4
- 满足
- 依据：代码每次 GET 直接查询数据库，include=spans 使用真实事务；触发器行为由 POST /api/brain/spans 驱动。T-1 验证 POST 后立即读到总记录，T-5、T-6 验证连续写入后的 cost_usd、outcome、header_source 汇总和重复上报去重，均为真实 HTTP 输出。

### I-5
- 满足
- 依据：server.js 将 createRunsReadRouter 挂在 run-definitions 和 run-reconciliation 之前，且新路由只匹配单段路径；T-9 在本分支与 origin/main 对比验证了原有 definition/reconciliation 路由的状态码和 error.code 一致，X-2 也真实验证了 reconciliation 仍返回 200。

## 问题

### J-1
- 类型：product
- 严重度：重要
- 对应：I-1、I-2、I-3、I-4、I-5
- 位置：packages/brain/scripts/smoke/runs-read-smoke.sh:8-10
- 说明：新增 smoke 脚本违反合同 S-4 对验证失败语义的要求。runs-read-smoke.sh 在 smoke-production-guard.mjs 返回失败时直接 exit 0，等价于静默跳过全部接口断言；因此在 guard 拦截、目标环境不符合 guard 条件或 guard 自身异常时，调用方会看到成功退出码，却没有验证 POST/GET、include、404 或 400。该行为会让 CI 或人工 smoke 产生虚假的通过结论，削弱本接口真实验证闸门。真人 QA 报告没有执行该 smoke 脚本，无法消除这一代码层面的风险。
