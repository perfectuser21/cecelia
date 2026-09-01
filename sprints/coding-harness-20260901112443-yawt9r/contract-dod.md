---
skeleton: false
journey_type: autonomous
target_environment: mac_web
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档，不改代码、配置或既有文档。
**大小**: S

## Invariant 映射

- [凭据安全] 由 B-02、B-05 验证只展示 `$CECELIA_INTERNAL_TOKEN` 占位且无疑似真实 Bearer 值。
- [端点鉴权] 由 B-02 验证两个端点说明 `internalAuthOrLoopback` 及远端 Bearer 要求。
- [禁止写死环境] 由 B-02 验证 token 只从环境变量引用，不写死值。
- [Planner 分支] N/A：本 sprint 不改变 Planner 派发或分支行为。

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一产品交付文件是 `docs/current/attempt-run-bridge-guide.md`
  Test: bash -c 'D=$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750...HEAD -- docs/current); [ "$D" = "docs/current/attempt-run-bridge-guide.md" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 两个端点及用途完整
  动作: 读取桥接说明的端点章节，按说明区分创建派发入口和按 id 查询入口
  预期观察: POST 被说明为创建并派发 attempt，GET 被说明为按 id 查询 attempt-run 状态
  等待预算: 0s
  留证: Node 断言输出与退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!/POST \/api\/brain\/harness\/attempt-run/.test(s)||!/创建并派发/.test(s)||!/GET \/api\/brain\/harness\/attempt-run\/:id/.test(s)||!/查询/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-02: 鉴权与九项角色白名单完整
  动作: 读取鉴权和角色章节，并据此构造远端 Authorization header 与合法角色选择
  预期观察: 文档要求宿主/远端携带 Bearer 环境变量，并逐项声明九项冻结角色为白名单
  等待预算: 0s
  留证: Node 断言输出与退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');const r=['"'"'planner'"'"','"'"'proposer'"'"','"'"'critic'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-fix'"'"','"'"'judge'"'"','"'"'reporter'"'"'];if(!s.includes('"'"'internalAuthOrLoopback'"'"')||!s.includes('"'"'Authorization: Bearer $CECELIA_INTERNAL_TOKEN'"'"')||!r.every(x=>s.includes('"'"'`'"'"'+x+'"'"'`'"'"'))||!/九项角色白名单/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-03: payload 必填与 base_sha 缺省语义完整
  动作: 按 payload 章节识别必填字段，并检查不提供 base_sha 时的处理方式
  预期观察: sprint_dir、base_repo、branch 均明确为必填，base_sha 明确可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Node 断言输出与退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const k of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"'])if(!new RegExp('"'"'`'"'"'+k+'"'"'`.{0,40}必填'"'"','"'"'s'"'"').test(s))process.exit(1);if(!/`base_sha`.{0,40}可省略.{0,80}生产 Brain.{0,30}自解析/s.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败三对象自动回滚完整
  动作: 阅读派发失败章节并逐项核对 run、session、task 的最终状态
  预期观察: 同一自动回滚合同中可见 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Node 断言输出与退出码
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"').replace(/\\s/g,'"'"''"'"');if(!['"'"'run→failed'"'"','"'"'session→closed'"'"','"'"'task→cancelled'"'"'].every(x=>s.includes(x))||!s.includes('"'"'派发失败'"'"')||!s.includes('"'"'自动回滚'"'"'))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] B-05: 中文文档且无真实 token
  动作: 对最终文档执行中文密度与凭据泄露检查
  预期观察: 文档包含连续中文说明，只使用 `$CECELIA_INTERNAL_TOKEN` 占位且没有疑似真实 Bearer 值
  等待预算: 0s
  留证: Node 断言输出与退出码
  Test: manual:bash -c 'node -e "let s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!/[\\u4e00-\\u9fff]{20}/.test(s))process.exit(1);s=s.replaceAll('"'"'Bearer $CECELIA_INTERNAL_TOKEN'"'"','"'"''"'"');if(/Bearer\\s+[A-Za-z0-9_.-]{24,}/.test(s))process.exit(1)"'

