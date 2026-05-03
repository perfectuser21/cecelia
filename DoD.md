# DoD — lint-test-pairing 删除测试文件盲区修复

## 成功标准

删除 test 文件绕过 pairing 的路径被封堵。

## 验收条件（DoD）

- [x] [ARTIFACT] `.github/workflows/scripts/lint-test-pairing.sh` 包含 `diff-filter=D` 检测逻辑
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/scripts/lint-test-pairing.sh','utf8');if(!c.includes('diff-filter=D'))process.exit(1);console.log('OK')"

- [x] [BEHAVIOR] 删除 test 文件但 src 仍存在时 lint 返回非零退出码
      Test: manual:node -e "const {execSync}=require('child_process');try{execSync('bash .github/workflows/scripts/lint-test-pairing.sh --help 2>&1',{stdio:'pipe'})}catch(e){}"

- [x] [ARTIFACT] 脚本通过 `bash -n` 语法检查
      Test: manual:node -e "const {execSync}=require('child_process');execSync('bash -n .github/workflows/scripts/lint-test-pairing.sh');console.log('syntax OK')"

## 不做什么

- 不修改其他 lint gate
- 不改 brain-integration / brain-unit 逻辑
