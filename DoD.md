# DoD — h14 账号池回归测试对齐 account1 已回池

**范围**: 改 tests/brain/h14-remove-account3.test.js 的 account-usage.js 断言为 [account1,account2]（禁 account3）。纯测试对齐，不改 src。
**大小**: XS

## ARTIFACT 条目

- [x] [ARTIFACT] 旧 stale describe 标题「= [account2]」已移除，header 记录 account1 凭据恢复
  Test: manual:node -e "const c=require('fs').readFileSync('tests/brain/h14-remove-account3.test.js','utf8');if(c.includes('ACCOUNTS 数组 = [account2]（account3 org 禁用已移出）'))process.exit(1);if(!c.includes('account1 凭据已恢复'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 守护不变量为禁 account3：account-usage.js 断言含 account1+account2、不含 account3（brain-unit CI --changed 实跑此测试验证）
  Test: manual:node -e "const c=require('fs').readFileSync('tests/brain/h14-remove-account3.test.js','utf8');const i=c.indexOf('account-usage.js 调度池');const seg=c.slice(i,i+500);if(!seg.includes(\"toContain('account1')\")||!seg.includes(\"toContain('account2')\")||!seg.includes(\"not.toContain('account3')\"))process.exit(1);console.log('OK')"
