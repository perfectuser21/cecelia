/** staging 验收合同的输入结构校验。 */
export function normalizeAcceptance(acceptance) {
  if (!acceptance || typeof acceptance !== 'object') {
    throw new Error('e2e_acceptance must be an object with scenarios[]');
  }
  const scenarios = Array.isArray(acceptance.scenarios) ? acceptance.scenarios : null;
  if (!scenarios || scenarios.length === 0) {
    throw new Error('e2e_acceptance.scenarios required (non-empty array)');
  }
  scenarios.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new Error(`scenarios[${i}] must be object`);
    }
    if (typeof s.name !== 'string' || !s.name.trim()) {
      throw new Error(`scenarios[${i}].name required`);
    }
    if (!Array.isArray(s.covered_tasks) || s.covered_tasks.length === 0) {
      throw new Error(`scenarios[${i}].covered_tasks required (non-empty uuid[])`);
    }
    if (!Array.isArray(s.commands) || s.commands.length === 0) {
      throw new Error(`scenarios[${i}].commands required (non-empty array)`);
    }
  });
  return { scenarios };
}
