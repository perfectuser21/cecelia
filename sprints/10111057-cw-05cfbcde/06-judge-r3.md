# 独立裁判（第 3 轮）

- 裁决：**PASS**
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r3.md
- 总评：通过。I-1 至 I-5 均有代码实现、合同覆盖及真实 HTTP 操作输出支持；前轮 smoke 静默成功问题已改为守卫拒绝时退出 1，控制字符问题也已修复并经预览实测。未发现需求外改动或有证据支持的安全、数据破坏问题。

## 需求覆盖

### I-1
- 满足
- 依据：packages/brain/src/routes/runs-read.js:36-46 使用 Express 解码后的 run_id 做参数化查询，并在响应顶层返回 runs 全量列。预览环境 T-1、T-2 均真实验证编码冒号地址返回 200，所需十个字段齐全，run_id、时间、outcome、费用及 tokens 值正确；T-3 验证裸冒号地址返回 200，且响应与编码地址完全一致。T-4 在配置 token 的本机分支 Brain 上验证正确 token 返回 200，缺失或错误 token 返回 401 且不泄露记录。合同 S-1、Q-1、Q-2 覆盖；系统生成的 run_id 范围及裸保留字排除已由 commander 裁决明确。

### I-2
- 满足
- 依据：packages/brain/src/routes/runs-read.js:16-29、42-44 解析 include 参数，在 REPEATABLE READ READ ONLY 事务中读取总记录及 spans，按 started_at、created_at、id 升序返回；不带 include 时直接返回 runs 行，不添加 spans。预览环境 T-5 真实乱序写入两条 span 后返回 qa/a、qa/b，字段齐全、顶层 cost_usd 为 0.300000；不带 include 及 include=foo 均输出 200 false，证明没有 spans 键。X-3 验证重复 include、逗号及空格写法均能附明细。合同 S-2、Q-3 覆盖。

### I-3
- 满足
- 依据：packages/brain/src/routes/runs-read.js:35-40、45、52-54 显式处理空值、超过 200 字符、控制字符、不存在记录及非法 URL 编码。预览环境 T-8 的不存在记录、带 include=spans 的不存在记录及注入式输入均返回 404 和可读 error；T-9 验证空白、两个空路径、201 字符及非法编码均返回 400，恰好 200 字符返回 404。X-2 验证 %00、%1F、%7F、%0A 均返回 400 和明确的控制字符提示，修复了前轮发现的问题；200/201 个汉字也分别返回 404/400。合同 S-1、Q-5、Q-6 及 commander 补充裁决覆盖。

### I-4
- 满足
- 依据：packages/brain/src/routes/runs-read.js:25-26、42-44 每次请求直接查询数据库，没有缓存；PR 未修改 spans 写入逻辑、触发器或迁移。预览环境 T-1、T-2 均证明新 run 写入前为 404，POST 返回 inserted=1 后立即 GET 得到 200 和触发器汇总值。T-6、T-7 两次真实验证连续写入后的 pass/0.1/spans → fail/0.15 → pass/0.16/owner，以及重复上报 inserted=0 后费用和终态保持不变，证明读到的是更新后的数据库记录。合同 S-3、S-4、Q-1、Q-4 覆盖。

### I-5
- 满足
- 依据：packages/brain/server.js:475-477 将新读路由挂在原有两个路由之前；packages/brain/src/routes/runs-read.js:35-36 仅注册根路径和单段 GET，原路由文件未修改。T-10 在相同数据库及环境变量的本机分支与 main 上真实逐项比较：无 token 的三个旧接口均为 401 UNAUTHORIZED；带 token 的 GET definition 均为 404 RUN_DEFINITION_UNKNOWN，GET reconciliation 均为 200 且含 evidence_status，POST definition 空 body 均为 422 RELEASE_INPUT_INVALID；同时新读接口在分支返回 200 和正确 run_id。合同 S-3、Q-7 覆盖，基线比较方式符合约定。

## 问题

（无）
