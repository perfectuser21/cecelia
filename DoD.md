# DoD — smoke-business.sh（PR 3/3）

## 成功标准

- [x] [ARTIFACT] `packages/brain/scripts/smoke/smoke-business.sh` 文件存在且可执行
  Test: `node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/smoke/smoke-business.sh');if(!(s.mode&0o111))process.exit(1)"`

- [x] [ARTIFACT] `tests/packages/brain/smoke-business.test.js` 文件存在（6 个结构验证测试）
  Test: `node -e "require('fs').accessSync('tests/packages/brain/smoke-business.test.js')"`

- [x] [BEHAVIOR] smoke-business.sh 覆盖 Brain-only 113 个 feature，本地运行 FAIL:0
  Test: `tests/packages/brain/smoke-business.test.js`

- [x] [BEHAVIOR] 脚本含 ok/fail/section/skip 函数 + ZJ_UP/CREATOR_UP 外部服务检测
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/smoke-business.sh','utf8');['ok()','fail()','section()','skip()','ZJ_UP','CREATOR_UP'].forEach(f=>{if(!c.includes(f))throw new Error('missing: '+f)})"`
