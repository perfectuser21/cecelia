function extractNodeIds(nodes) {
  const ids = new Set();
  if (!Array.isArray(nodes)) return ids;
  for (const node of nodes) {
    const id = node?.capability_id ?? node?.id ?? node;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

function extractAssertionIds(assertions) {
  const ids = new Set();
  if (!Array.isArray(assertions)) return ids;
  for (const assertion of assertions) {
    const id = assertion?.assertion_id ?? assertion?.id ?? assertion;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

function assertionIdentity(assertion) {
  if (!assertion || typeof assertion !== 'object') return null;
  return JSON.stringify({
    assertion_id: assertion.assertion_id ?? assertion.id ?? null,
    command: assertion.command ?? null,
    covers_capability_ids: [...(assertion.covers_capability_ids ?? [])].sort(),
    journey_step_link_id: assertion.journey_step_link_id ?? null,
    assertion_revision: assertion.assertion_revision ?? null,
    assertion_digest: assertion.assertion_digest ?? null,
    source_bindings: [...(assertion.source_bindings ?? [])].sort(
      (a, b) => String(a?.journey_step_link_id).localeCompare(String(b?.journey_step_link_id)),
    ),
  });
}

function assertionMap(assertions) {
  const result = new Map();
  if (!Array.isArray(assertions)) return result;
  for (const assertion of assertions) {
    const id = assertion?.assertion_id ?? assertion?.id ?? assertion;
    if (typeof id === 'string' && id) result.set(id, assertionIdentity(assertion));
  }
  return result;
}

function assertionCoverageById(assertions) {
  const result = new Map();
  if (!Array.isArray(assertions)) return result;
  for (const assertion of assertions) {
    const id = assertion?.assertion_id ?? assertion?.id ?? assertion;
    if (typeof id !== 'string' || !id) continue;
    result.set(id, (assertion?.covers_capability_ids ?? []).filter(
      capabilityId => typeof capabilityId === 'string' && capabilityId,
    ));
  }
  return result;
}

function extractRunnableAssertionCoverage(assertions) {
  const coveredCapabilityIds = new Set();
  if (!Array.isArray(assertions)) return coveredCapabilityIds;
  for (const assertion of assertions) {
    if (assertion && typeof assertion === 'object'
      && typeof assertion.assertion_id === 'string' && assertion.assertion_id
      && typeof assertion.command === 'string' && assertion.command.trim()) {
      for (const capabilityId of assertion.covers_capability_ids ?? []) {
        if (typeof capabilityId === 'string' && capabilityId) {
          coveredCapabilityIds.add(capabilityId);
        }
      }
    }
  }
  return coveredCapabilityIds;
}

export function compareImpactContract(
  contractNodes,
  actualNodes,
  contractAssertions = [],
  actualAssertions = [],
) {
  const contractIds = extractNodeIds(contractNodes);
  const actualIds = extractNodeIds(actualNodes);
  const contractAssertionIds = extractAssertionIds(contractAssertions);
  const actualAssertionIds = extractAssertionIds(actualAssertions);
  const contractAssertionMap = assertionMap(contractAssertions);
  const actualAssertionMap = assertionMap(actualAssertions);
  const contractAssertionCoverage = assertionCoverageById(contractAssertions);
  const runnableAssertionCoverage = extractRunnableAssertionCoverage(actualAssertions);

  const addedNodes = [...actualIds].filter(id => !contractIds.has(id));
  const removedNodes = [...contractIds].filter(id => !actualIds.has(id));
  const addedAssertions = [...actualAssertionIds].filter(id => !contractAssertionIds.has(id));
  const changedAssertions = [...actualAssertionIds].filter(id => (
    contractAssertionIds.has(id)
    && actualAssertionMap.get(id) !== contractAssertionMap.get(id)
  ));
  const removedAssertions = [];
  const assertionDriftNodes = new Set();
  for (const id of contractAssertionIds) {
    if (actualAssertionIds.has(id)) continue;
    const coverage = contractAssertionCoverage.get(id) ?? [];
    if (!coverage.some(capabilityId => actualIds.has(capabilityId))) continue;
    removedAssertions.push(id);
    for (const capabilityId of coverage) {
      if (actualIds.has(capabilityId)) assertionDriftNodes.add(capabilityId);
    }
  }

  const uncoveredActualNodes = [...actualIds].filter(
    capabilityId => !runnableAssertionCoverage.has(capabilityId),
  );
  if (removedAssertions.length > 0 || uncoveredActualNodes.length > 0) {
    return {
      verdict: 'drift', added_nodes: addedNodes, removed_nodes: removedNodes,
      added_assertions: addedAssertions, changed_assertions: changedAssertions,
      removed_assertions: removedAssertions,
      drift_nodes: [...new Set([...assertionDriftNodes, ...uncoveredActualNodes])],
      reason_code: 'CONTRACT_IMPACT_DRIFT',
    };
  }

  if (addedNodes.length === 0
    && (changedAssertions.length > 0 || addedAssertions.length > 0)) {
    return {
      verdict: 'extend', added_nodes: [], removed_nodes: removedNodes,
      added_assertions: addedAssertions, changed_assertions: changedAssertions,
      removed_assertions: [], drift_nodes: [], reason_code: null,
    };
  }

  if (addedNodes.length === 0) {
    return {
      verdict: 'pass', added_nodes: [], removed_nodes: removedNodes,
      added_assertions: [], changed_assertions: [], removed_assertions: [],
      drift_nodes: [], reason_code: null,
    };
  }

  if (addedNodes.every(nodeId => runnableAssertionCoverage.has(nodeId))) {
    return {
      verdict: 'extend', added_nodes: addedNodes, removed_nodes: removedNodes,
      added_assertions: addedAssertions, changed_assertions: changedAssertions,
      removed_assertions: [], drift_nodes: [], reason_code: null,
    };
  }

  return {
    verdict: 'drift', added_nodes: addedNodes, removed_nodes: removedNodes,
    added_assertions: addedAssertions, changed_assertions: changedAssertions,
    removed_assertions: [], drift_nodes: addedNodes,
    reason_code: 'CONTRACT_IMPACT_DRIFT',
  };
}
