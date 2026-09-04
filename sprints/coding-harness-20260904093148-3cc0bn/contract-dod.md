---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash: 541dc1728c1cd6aed31701812cd4e8bdc2a35773bcaf39af521e12d23c1c7b7d

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；实现基线固定为 `2721277993f33d00b8a4c2d94fdec5b1ac4f7f32`。

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在且包含四个独立主题标题
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const h of ['端点与用途','鉴权','角色白名单','Payload','派发失败自动回滚'])if(!s.includes(h))process.exit(1);if(!/[一-龥]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] 产品范围相对冻结实现基线恰好只有目标文档
  Test: manual:bash -c 'BASE_SHA=2721277993f33d00b8a4c2d94fdec5b1ac4f7f32; test "$(git diff --name-only "$BASE_SHA" HEAD -- . ":(exclude)sprints/coding-harness-20260904093148-3cc0bn/**" | sort)" = "docs/current/attempt-run-bridge-guide.md"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能区分两个端点用途
  动作: 打开说明并阅读端点与用途一节。
  预期观察: POST 被说明为创建，GET 被说明为按 id 查询。
  等待预算: 0s
  留证: Vitest 输出中的“两个端点用途与鉴权说明完整”结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与鉴权说明完整" && node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(/POST[^\\n]*(查询)|GET[^\\n]*(创建)/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 读者不会把宿主或远端误判为免鉴权
  动作: 阅读本机与宿主/远端的鉴权差异。
  预期观察: 正文出现 internalAuthOrLoopback，且宿主/远端明确必须带 Bearer CECELIA_INTERNAL_TOKEN。
  等待预算: 0s
  留证: node 断言退出码与 stdout。
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!s.includes('"'"'internalAuthOrLoopback'"'"')||!s.includes('"'"'Bearer CECELIA_INTERNAL_TOKEN'"'"'))process.exit(1);if(/(宿主|远端)[^\\n]*(免鉴权|无需鉴权|不需要.*Bearer)/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: 九项角色白名单恰好逐项列出
  动作: 逐项核对白名单，不接受“等角色”省略。
  预期观察: 生产白名单九项各出现一次且无省略表达。
  等待预算: 0s
  留证: Vitest 输出中的“九项角色白名单恰好逐项列出”结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "九项角色白名单恰好逐项列出" && node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(/等角色/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: payload 三项必填与 base_sha 省略语义明确
  动作: 按说明构造 payload 字段清单。
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 输出中的 payload 测试结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "payload 三项必填且 base_sha 明确可省略并由生产 Brain 自解析" && node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(/`base_sha`[^\\n]*必填/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-05: 派发失败三类资源回滚终态可判定
  动作: 阅读派发失败自动回滚一节并逐资源核对。
  预期观察: run→failed、session→closed、task→cancelled 三对终态完整且无相反终态。
  等待预算: 0s
  留证: Vitest 输出中的回滚测试结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三类资源终态完整" && node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(/run→(done|completed)|session→active|task→(queued|in_progress)/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-1 分支归属 N/A：合同角色已在服务端签发的 propose 分支，不要求产品文档改变分支。
  动作: 核对当前分支名。
  预期观察: 当前分支为 cp-harness-propose-r1-6f54a5f2-rca88c706-a1。
  等待预算: 0s
  留证: git branch 输出。
  Test: manual:bash -c 'test "$(git branch --show-current)" = "cp-harness-propose-r1-6f54a5f2-rca88c706-a1"'

- [ ] [BEHAVIOR] [L1] INV-2 实现基线不被工作区 SHA 替换
  动作: 运行冻结 BASE_SHA 的范围 oracle。
  预期观察: oracle 使用字面量 2721277993f33d00b8a4c2d94fdec5b1ac4f7f32 并仅允许目标文档。
  等待预算: 0s
  留证: git diff 路径输出。
  Test: manual:bash -c 'BASE_SHA=2721277993f33d00b8a4c2d94fdec5b1ac4f7f32; test "$(git diff --name-only "$BASE_SHA" HEAD -- . ":(exclude)sprints/coding-harness-20260904093148-3cc0bn/**" | sort)" = "docs/current/attempt-run-bridge-guide.md"'

- [ ] [BEHAVIOR] [L1] INV-3 凭据安全
  动作: 检查文档只写环境变量名，未写实际 Bearer 值。
  预期观察: 不存在形如 Bearer 后跟非环境变量 token 的文本。
  等待预算: 0s
  留证: node 断言退出码。
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(/Bearer (?!CECELIA_INTERNAL_TOKEN)[A-Za-z0-9_.-]{12,}/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-4 端点鉴权说明未缺失
  动作: 核对两个端点所在说明与鉴权章节。
  预期观察: internalAuthOrLoopback 与 Bearer CECELIA_INTERNAL_TOKEN 均存在。
  等待预算: 0s
  留证: node 断言退出码。
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'internalAuthOrLoopback'"'"','"'"'Bearer CECELIA_INTERNAL_TOKEN'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-5 真环境验证 N/A：本 Sprint 只交付静态说明，不声称生产派发已执行
  动作: 检查文档没有宣称本 Sprint 已完成生产调用验证。
  预期观察: 无“生产派发验证通过”一类虚假完成声明。
  等待预算: 0s
  留证: node 断言退出码。
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(/生产派发(已)?验证通过/.test(s))process.exit(1)"'

## 断言自洽声明

每个 PRD 正向义务均有同条 Test 内的负向拒绝：用途完整/用途互换、鉴权存在/远端免鉴权、九项存在/省略表达、payload 正确/`base_sha` 必填误述、回滚完整/相反终态。范围则以目标路径正匹配与额外产品路径为零成对约束。所有条目未预勾，目标文档未实现时冻结 Vitest 必为 RED。
