import { inShortTransaction } from './gp-assertion-repository.js';

const CONTRACT_HASH_PATTERN = /^[0-9a-f]{64}$/;

function finalizationError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function normalizeContractState(
  state,
  { requireSignature = true } = {},
) {
  if (!state || typeof state.hasHistory !== 'boolean') {
    throw finalizationError(
      'INVALID_GP_CONTRACT',
      'Contract lookup returned an invalid state',
    );
  }
  if (!state.hasHistory) {
    if (state.signed !== null) {
      throw finalizationError(
        'INVALID_GP_CONTRACT',
        'Contract state is internally inconsistent',
      );
    }
    return { hasHistory: false, id: null, hash: null };
  }
  if (!state.signed) {
    if (requireSignature) {
      throw finalizationError(
        'GP_CONTRACT_SIGNATURE_REQUIRED',
        'Journey contract history exists without a current Owner signature',
      );
    }
    return { hasHistory: true, id: null, hash: null };
  }
  if (
    typeof state.signed.id !== 'string'
    || state.signed.id.length === 0
    || !CONTRACT_HASH_PATTERN.test(state.signed.content_hash)
  ) {
    throw finalizationError(
      'INVALID_GP_CONTRACT',
      'Signed contract snapshot is incomplete',
    );
  }
  return {
    hasHistory: true,
    id: state.signed.id,
    hash: state.signed.content_hash,
  };
}

export function sameContractState(frozen, currentState) {
  try {
    const current = normalizeContractState(
      currentState,
      { requireSignature: false },
    );
    return (
      current.hasHistory === frozen.hasHistory
      && current.id === frozen.id
      && current.hash === frozen.hash
    );
  } catch {
    return false;
  }
}

export async function inFinalTransaction(pool, work) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await inShortTransaction(
        pool,
        'BEGIN ISOLATION LEVEL SERIALIZABLE',
        work,
      );
    } catch (error) {
      if (error?.code !== '40001' || attempt === maxAttempts) throw error;
    }
  }
  throw finalizationError(
    'ASSERTION_TRANSACTION_RETRY_EXHAUSTED',
    'Assertion receipt transaction retry exhausted',
  );
}
