# DoD: cp-0427162913-lint-no-fake-test

## 产出物

- [x] [ARTIFACT] `.github/workflows/scripts/lint-no-fake-test.sh` 文件存在且可执行
  - Test: `manual:node -e "require('fs').accessSync('.github/workflows/scripts/lint-no-fake-test.sh')"`

- [x] [ARTIFACT] `.github/workflows/scripts/__tests__/lint-no-fake-test.test.sh` 文件存在
  - Test: `manual:node -e "require('fs').accessSync('.github/workflows/scripts/__tests__/lint-no-fake-test.test.sh')"`

- [x] [ARTIFACT] `.github/workflows/ci.yml` 包含 `lint-no-fake-test` job
  - Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('lint-no-fake-test:'))process.exit(1)"`

## 行为

- [x] [BEHAVIOR] lint-no-fake-test.sh Rule 1：新增 test 文件全是弱断言（toBeDefined/toBeNull 等）→ exit 1
  - Test: `manual:bash .github/workflows/scripts/__tests__/lint-no-fake-test.test.sh`

- [x] [BEHAVIOR] lint-no-fake-test.sh Rule 2：vi.mock > 5 且 expect < 3 → exit 1
  - Test: `manual:bash .github/workflows/scripts/__tests__/lint-no-fake-test.test.sh`

- [x] [BEHAVIOR] lint-no-fake-test.sh 对真行为断言（toBe/toEqual 非 null）→ exit 0（放行）
  - Test: `manual:bash .github/workflows/scripts/__tests__/lint-no-fake-test.test.sh`

- [x] [BEHAVIOR] brain-unit CI job 在 PR 模式下执行 vitest --changed（test impact analysis）
  - Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('vitest --changed'))process.exit(1)"`
