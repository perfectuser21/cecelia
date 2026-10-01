# DoD：根 Sprint 正式登记

- [x] [BEHAVIOR] root_contract 根合同登记通过且子Sprint孤儿仍被真实守卫拒绝。
  Test: manual:npx vitest run sprints/tests/root-contract.test.mjs
- [x] [BEHAVIOR] pyramid 已有11条真实金字塔守卫全部满足预期，棘轮4条自测保持。
  Test: manual:bash -c "bash scripts/__tests__/test-pyramid-guard.test.sh && bash scripts/__tests__/ratchet-guard.test.sh"
