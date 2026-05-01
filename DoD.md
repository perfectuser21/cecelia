# DoD — smoke-runtime-tests PR 1/3

## 成功标准

- smoke-runtime.sh 存在且可执行
- 脚本包含 27 个 feature 的真实 API 端点断言
- 单元测试 smoke-runtime.test.js 全部通过（6/6）
- 本地连接真实 Brain（localhost:5221）执行 exit 0，PASS: 27

## DoD

- [x] [ARTIFACT] packages/brain/scripts/smoke/smoke-runtime.sh 存在且可执行
  Test: `node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/smoke/smoke-runtime.sh');if(!(s.mode&0o111))process.exit(1)"`

- [x] [BEHAVIOR] 脚本对 27 个 feature 的端点有真实断言（含 feature ID 字符串）
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/smoke-runtime.sh','utf8');['brain-health','brain-status','circuit-breaker','brain-status-full','circuit-breaker-reset','llm-caller','area-slot-config','model-profile','skills-registry','task-type-config','device-lock','agent-execution','executor-status','cluster-status','session-scan','session-kill','self-drive','tick-loop','tick-cleanup-zombie','recurring-tasks','tick-disable','tick-enable','tick-drain','tick-drain-cancel','tick-drain-status','tick-execute','tick-startup-errors'].forEach(f=>{if(!c.includes(f))throw new Error('missing: '+f)})"`

- [x] [BEHAVIOR] 单元测试通过（结构验证，不依赖运行中 Brain）
  Test: `tests/packages/brain/smoke-runtime.test.js`

- [x] [ARTIFACT] ok/fail/section 函数存在
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/smoke-runtime.sh','utf8');if(!c.includes('ok()'))process.exit(1);if(!c.includes('fail()'))process.exit(1);if(!c.includes('section()'))process.exit(1)"`
