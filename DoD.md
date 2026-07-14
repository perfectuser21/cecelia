# DoD: migration 343 status CHECK 窄枚举致生产部署失败——343 修正 + 344 拓宽

- [x] [BEHAVIOR] 343 的 CHECK 枚举涵盖生产在用全部 status（含 working/broken）
      Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/migrations/343_journey_features_guard_ref.sql','utf8');if(!/working/.test(s)||!/broken/.test(s))process.exit(1)"
- [x] [BEHAVIOR] 344 幂等拓宽存在（兜住已 apply 窄版的 staging/preview 库）
      Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/migrations/344_journey_features_status_check_widen.sql','utf8');if(!/DROP CONSTRAINT IF EXISTS/.test(s)||!/working/.test(s))process.exit(1)"
- [x] [BEHAVIOR] EXPECTED_SCHEMA_VERSION 同步到 344
      Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!s.includes(String.fromCharCode(39)+'344'+String.fromCharCode(39)))process.exit(1)"
- [x] 版本四处同步 1.262.1
      Test: manual:bash scripts/check-version-sync.sh
