# 独立裁判（第 3 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r3.md
- 总评：正常路径的三条需求均有真实 HTTP 操作证据，其中默认写入和合法值查回可以确认成立；I-1 的约束读取失败路径仍不完整。另有全局 CI 门禁与 made_by 约束的范围扩展，以及可能错误显示通过的固化 smoke，当前不建议合并。

## 需求覆盖

### I-1
- 未满足
- 依据：T-1 真实输出 workflow_bogus 返回 400、非空 allowed_categories、无数据库原文，GET 返回 data=[]；T-2、X-1、X-2 验证了类型、超长、空格和并发输入。strategic-decisions.js:60-73 实现了正常路径预检，:162-164 实现了约束错误转译。但读取约束失败时预检放行，兜底允许返回空列表；超长输入还可能进入未被转译的数据库长度错误路径。这些失败分支没有预览环境实测证据。

### I-2
- 满足
- 依据：T-3 的两条真实 POST 分别返回 201，data.category=general，topic 与请求一致，随后 GET 匹配到两条；X-2 的 category:null 也返回 201/general。strategic-decisions.js:61 保留缺省、空串和 null 的默认处理，原 INSERT 默认值未改；迁移 545:18-35 将 general 加入现有 category 集合。合同 S-2、Q-3 覆盖该需求。

### I-3
- 满足
- 依据：T-4 真实 POST decision 返回 201 和 id=66c587ff-7390-4949-a028-83243b76e010，随后 GET 对 id、topic、category 的联合断言输出 true、ALL_OK；T-5 另验证 judgment 写入和查询。strategic-decisions.js:67-70 放行合法值，:150-159 保留原参数化 INSERT 和 201 响应，GET 未改。合同 S-1、Q-4、Q-5 覆盖合法写入与查回。

## 问题

### J-1
- 类型：product
- 严重度：重要
- 对应：I-1
- 位置：packages/brain/src/routes/strategic-decisions.js:60-73、162-165；packages/brain/src/routes/__tests__/strategic-decisions-category.test.js:120-135；S-1；T-2
- 说明：约束读取失败时，loadAllowedCategories 返回 null，checkCategory 对字符串直接放行。普通非法值撞 category CHECK 后虽然转为 400，但再次读取失败就返回 error='category 非法'、allowed_categories=[]，调用方仍不知道允许值；新增单测明确断言了这一结果。更严重的是，5000 字符等超长非法 category 在该路径进入 INSERT 后可先触发 varchar 长度错误 22001，而 catch 只转译 23514，最终仍返回 500 和数据库错误原文。规格 S-1 的失败语义主动允许空列表和放行，未完整覆盖 I-1；T-2 只在约束读取成功的路径验证了超长输入。

### J-2
- 类型：product
- 严重度：重要
- 对应：I-1
- 位置：packages/brain/scripts/ci/contract-exists.mjs:19-22；packages/brain/src/__tests__/ci-defense.test.ts:70-75；packages/brain/scripts/ci/__tests__/fixtures/diff-coding-workflow-full.txt
- 说明：PR 修改了全局 contract-exists 门禁，把更多评审、QA、裁判文件认作无需 harness 合同的产物。这会改变其他 PR 的合同检查结果，与三个 category 接口需求均无关。新增 fixture 和 ci-defense 测试只能证明新的豁免会生效，不能使该门禁政策变更成为本任务范围；Q-1 至 Q-5 也未验收这种全局影响。应拆出独立变更。

### J-3
- 类型：product
- 严重度：重要
- 对应：I-3
- 位置：packages/brain/migrations/546_decisions_made_by_allow_ai.sql:18-34；packages/brain/src/__tests__/migration-546-decisions-made-by-ai.test.js:23-28；T-5
- 说明：迁移 546 额外扩大 made_by 的数据库允许值并重建该字段约束，修复的是 made_by='ai' 的独立存量问题，超出了 category 合法写入保持不变的需求。新增迁移测试还明确说明 main 已把真实调用方改成 made_by='system'，因此 T-5 使用 ai 的旧请求形状不能证明当前调用方需要这项数据库变更。应更新真实调用方场景，并把 made_by 约束扩展拆出独立需求和验收。

### J-4
- 类型：product
- 严重度：重要
- 对应：I-1
- 位置：packages/brain/scripts/smoke/cw-bd2b1556-qa-smoke.sh:13、26
- 说明：固化 QA 脚本的 Q-1 GET 地址被单引号包围，实际传给 curl 的是包含字面量 "$BRAIN_URL" 的地址，变量不会展开，无法查询预览接口。同时 Q-1 的断言串使用 &&，没有最终失败退出；其失败不会被 set -e 可靠终止，后续场景仍可继续并最终打印 PASS。因此这一新增 smoke 可以在未完成非法请求不写库验证、甚至 Q-1 断言失败时显示通过。真人 T-1 的正确命令能证明本轮结果，但不能证明提交的回归脚本有效。
