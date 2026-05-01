# DoD — smoke-task-planning.sh（PR 2/3）

## 成功标准

- [x] **[ARTIFACT]** `packages/brain/scripts/smoke/smoke-task-planning.sh` 存在且可执行
  - Test: `node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/smoke/smoke-task-planning.sh');if(!(s.mode&0o111))process.exit(1)"`

- [x] **[ARTIFACT]** `tests/packages/brain/smoke-task-planning.test.js` 存在
  - Test: `node -e "require('fs').accessSync('tests/packages/brain/smoke-task-planning.test.js')"`

- [x] **[BEHAVIOR]** smoke-task-planning.sh 覆盖 task(13) + schedule(10) + planning(4) + proposal(5) = 32 个 feature，全部通过
  - Test: `tests/packages/brain/smoke-task-planning.test.js`

- [x] **[BEHAVIOR]** 单元测试 6/6 通过（结构验证：文件存在、可执行、32 个 feature 标签齐全）
  - Test: `tests/packages/brain/smoke-task-planning.test.js`
