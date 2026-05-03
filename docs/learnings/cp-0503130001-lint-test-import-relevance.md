# Learning: lint-test-pairing 内容相关性盲区

### 根本原因

`lint-test-pairing` 只验证 test 文件是否存在于正确路径，不验证 test 文件内容是否真的测了对应的 src 模块。AI 可以新增 `executor.test.js`（路径正确，pairing 通过），但文件内全是 `import { runSelfCheck } from '../selfcheck.js'`，实质上没有覆盖 `executor.js`。同时，`enforce_admins: false` 意味着管理员可以直接 push main 绕过所有 CI。

### 下次预防

- [ ] lint-test-pairing 已加 v3 import 相关性检测：新增 test 文件必须在 import/require/describe 中出现被测模块的 basename
- [ ] branch protection 已启用 enforce_admins：管理员也必须走 PR + CI，无例外
- [ ] 新增 lint 规则时，同时考虑：文件存在 / 文件内容 / 删除三个维度
