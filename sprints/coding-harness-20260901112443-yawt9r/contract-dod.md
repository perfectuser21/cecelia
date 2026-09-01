---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标中文文档是唯一产品交付文件，产品代码无变更
  Test: bash -c 'BASE=d4ae8c6d2b777f5762c4cd88a8e8d56004c66750; test "$(git diff --name-only "$BASE"...HEAD -- docs/current | sort)" = "docs/current/attempt-run-bridge-guide.md"; test -z "$(git diff --name-only "$BASE"...HEAD -- packages apps scripts .github)"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 说明两个端点的用途
  动作: 打开 attempt-run 桥接使用说明，阅读创建与查询章节
  预期观察: 中文文档明确 POST 用于创建并派发，GET 用于按 id 查询状态
  等待预算: 0s
  留证: 文档内容断言的命令输出
  Test: manual:bash -c 'D=docs/current/attempt-run-bridge-guide.md; grep -q "[一-龥]" "$D"; grep -Fq "POST /api/brain/harness/attempt-run" "$D"; grep -Fq "GET /api/brain/harness/attempt-run/:id" "$D"; grep -Eq "创建.*派发|派发.*创建" "$D"; grep -Eq "按.*id.*查询|查询.*状态" "$D"'

- [ ] [BEHAVIOR] [L1] B-02: 说明宿主或远端 Bearer 鉴权
  动作: 阅读鉴权章节并复制环境变量形式的 Authorization 示例
  预期观察: 两端点标明 internalAuthOrLoopback，宿主机或远端必须携带 Bearer CECELIA_INTERNAL_TOKEN，且无真实 token
  等待预算: 0s
  留证: 鉴权关键词与凭据反向扫描输出
  Test: manual:bash -c 'D=docs/current/attempt-run-bridge-guide.md; grep -Fq "internalAuthOrLoopback" "$D"; grep -Fq "Authorization: Bearer \$CECELIA_INTERNAL_TOKEN" "$D"; grep -Eq "宿主.*远端|远端.*宿主" "$D"; ! grep -Eq "Bearer[[:space:]]+[A-Za-z0-9_-]{24,}" "$D"'

- [ ] [BEHAVIOR] [L1] B-03: 列出九项角色白名单
  动作: 阅读角色白名单章节并逐项核对角色名称
  预期观察: planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、judge、reporter 九项全部出现
  等待预算: 0s
  留证: Node 内容解析 exit code
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');const r=['"'"'planner'"'"','"'"'proposer'"'"','"'"'critic'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-fix'"'"','"'"'judge'"'"','"'"'reporter'"'"'];if(!r.every(x=>s.includes('"'"'`'"'"'+x+'"'"'`'"'"')))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 说明 payload 必填字段和 base_sha 省略语义
  动作: 按 payload 章节构造创建请求
  预期观察: sprint_dir、base_repo、branch 均标为必填，base_sha 标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Node 字段语义解析 exit code
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"'].every(x=>new RegExp('"'"'(?:'"'"'+x+'"'"'.{0,40}必填|必填.{0,80}'"'"'+x+'"'"')'"'"','"'"'s'"'"').test(s)))process.exit(1);if(!/base_sha.{0,40}(可省略|可选)/s.test(s)||!/生产 Brain.{0,40}自解析/s.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-05: 说明派发失败自动回滚三对象终态
  动作: 阅读失败处理章节并核对 run、session、task 三个对象
  预期观察: 派发失败自动回滚同时写明 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Node 状态链解析 exit code
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const [a,b] of [['"'"'run'"'"','"'"'failed'"'"'],['"'"'session'"'"','"'"'closed'"'"'],['"'"'task'"'"','"'"'cancelled'"'"']])if(!new RegExp(a+'"'"'\\s*(?:→|->)\\s*'"'"'+b).test(s))process.exit(1);if(!/派发失败.{0,160}自动回滚/s.test(s)&&!/自动回滚.{0,160}派发失败/s.test(s))process.exit(1)"'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 凭据安全，不硬编码 Bearer token
  动作: 扫描文档中的 Bearer 示例
  预期观察: 只出现环境变量引用，不出现长度至少 24 的疑似真实 token
  等待预算: 0s
  留证: grep 反向扫描 exit code
  Test: manual:bash -c 'D=docs/current/attempt-run-bridge-guide.md; grep -Fq "Bearer \$CECELIA_INTERNAL_TOKEN" "$D"; ! grep -Eq "Bearer[[:space:]]+[A-Za-z0-9_-]{24,}" "$D"'

- [ ] [BEHAVIOR] [L1] INV-2: 端点鉴权描述不回退
  动作: 核对两个端点所在文档的鉴权声明
  预期观察: 文档明确两端点采用 internalAuthOrLoopback，远端不被描述成匿名可访问
  等待预算: 0s
  留证: 鉴权章节内容断言输出
  Test: manual:bash -c 'D=docs/current/attempt-run-bridge-guide.md; grep -Fq "internalAuthOrLoopback" "$D"; grep -Eq "宿主.*远端|远端.*宿主" "$D"; ! grep -Eq "远端.{0,20}(无需|免).{0,10}(鉴权|token)" "$D"'

- [ ] [BEHAVIOR] [L1] INV-3: 环境假设不写死
  动作: 检查鉴权示例的 token 来源
  预期观察: token 由 CECELIA_INTERNAL_TOKEN 环境变量提供
  等待预算: 0s
  留证: 环境变量字面断言输出
  Test: manual:bash -c 'grep -Fq "Authorization: Bearer \$CECELIA_INTERNAL_TOKEN" docs/current/attempt-run-bridge-guide.md'

- [ ] [BEHAVIOR] [L1] INV-4: Planner 分支行为不受影响
  动作: 检查实现基线后的产品代码差异
  预期观察: packages、apps、scripts 与 workflow 均无变更，因此 Planner 分支逻辑未被触及
  等待预算: 0s
  留证: git diff 路径输出
  Test: manual:bash -c 'test -z "$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750...HEAD -- packages apps scripts .github)"'
