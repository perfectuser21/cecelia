# DoD — lint-test-pairing v3：import 相关性检测

## 成功标准

新增 test 文件必须引用对应 src 模块，不能测别的模块绕过配对。

## 验收条件（DoD）

- [x] [ARTIFACT] `lint-test-pairing.sh` 包含 import 相关性检测逻辑（v3 盲区修复）
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/scripts/lint-test-pairing.sh','utf8');if(!c.includes('UNRELATED_TESTS'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 脚本通过 bash -n 语法检查
      Test: manual:node -e "const {execSync}=require('child_process');execSync('bash -n .github/workflows/scripts/lint-test-pairing.sh');console.log('syntax OK')"

- [x] [BEHAVIOR] enforce_admins 已在 GitHub branch protection 中启用
      Test: manual:node -e "const {execSync}=require('child_process');const r=execSync('gh api repos/perfectuser21/cecelia/branches/main/protection/enforce_admins --jq .enabled').toString().trim();if(r!=='true')process.exit(1);console.log('enforce_admins: '+r)"

## 不做什么

- 不改 brain 源码
- 不改其他 lint gate
