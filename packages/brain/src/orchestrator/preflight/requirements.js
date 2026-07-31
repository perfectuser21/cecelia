import { parseCapabilityRequirements } from './capability-gate.js';

const GITHUB_ROLES = new Set([
  'planner',
  'proposer',
  'generator',
  'evaluator',
]);

/**
 * Build the server-owned minimum for a role, then allow the approved
 * structured contract to add requirements. Payload values can never weaken
 * the role baseline.
 */
export function deriveCapabilityRequirements({ role, requirements } = {}) {
  const contract = parseCapabilityRequirements({ requirements });
  const modelCapabilities = new Set([
    'structured_output',
    ...contract.model_capabilities,
  ]);
  return {
    provider_auth: true,
    github: GITHUB_ROLES.has(role) || contract.github,
    postgres: contract.postgres,
    model_capabilities: [...modelCapabilities],
  };
}
