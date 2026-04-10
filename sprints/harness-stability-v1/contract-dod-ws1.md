# Contract DoD — Workstream 1: CI 白名单 — playwright 加入

- [x] [ARTIFACT] `scripts/devgate/check-manual-cmd-whitelist.cjs` 的 ALLOWED_COMMANDS 包含 `playwright`
  Test: node -e "const m=require('./scripts/devgate/check-manual-cmd-whitelist.cjs');if(!m.ALLOWED_COMMANDS.has('playwright'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] `manual:playwright test xxx` 通过白名单校验（退出码 0），`manual:grep xxx` 仍被拒绝（退出码 1）
  Test: bash -c "TMP=$(mktemp);echo '- [ ] [BEHAVIOR] test\n  Test: manual:playwright test e2e.spec.ts'>$TMP;node scripts/devgate/check-manual-cmd-whitelist.cjs $TMP;rm $TMP"
