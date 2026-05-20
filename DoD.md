# DoD — Cecelia 统一 CI 改造

- [x] [ARTIFACT] `.github/workflows/scripts/lint-tdd-commit-order.sh` 含 smoke 识别逻辑
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/scripts/lint-tdd-commit-order.sh','utf8');if(!c.includes('scripts/smoke'))process.exit(1)"`

- [x] [ARTIFACT] `.github/workflows/scripts/lint-test-pairing.sh` 含 thin PR 豁免逻辑
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/scripts/lint-test-pairing.sh','utf8');if(!c.includes('Walking Skeleton thin PR'))process.exit(1)"`

- [x] [ARTIFACT] `.github/workflows/ci.yml` 有独立 `dod-format-check` job
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('dod-format-check:'))process.exit(1)"`

- [x] [BEHAVIOR] e2e-smoke job 无 `if: brain || workspace` 条件，所有 PR 必跑
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const i=c.indexOf('e2e-smoke:');const seg=c.slice(i,i+300);if(seg.includes('changes.outputs.brain'))process.exit(1)"`

- [x] [BEHAVIOR] brain-diff-coverage 不重跑 vitest，改为 artifact 模式
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const i=c.indexOf('brain-diff-coverage:');const seg=c.slice(i,i+1500);if(seg.includes('npx vitest run --coverage') && !seg.includes('download-artifact'))process.exit(1)"`

- [x] [BEHAVIOR] dep-audit 无 warn-only，硬失败
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(c.includes('warn-only during Walking Skeleton'))process.exit(1)"`

- [x] [BEHAVIOR] branch-naming 只允许 cp-\d{8,10}-* 格式
  Test: `manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(c.includes('feature/|fix/|chore/|docs/'))process.exit(1)"`
