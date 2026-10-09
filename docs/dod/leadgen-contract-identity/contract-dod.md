# DoD：独立流程契约身份

- [x] [BEHAVIOR] contractidentity 独立 contract_key 保留业务 capability，正确 owner 可加载；缺 owner、歧义 owner、异 repo 和异 capability_id 拒绝，旧契约及 digest/身份校验保持。
  Test: manual:bash packages/brain/scripts/smoke/workflow-contract-identity-smoke.sh

- [x] [BEHAVIOR] contractgates Brain 事实、版本同步及 DoD 映射保持。
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs DoD.md"
