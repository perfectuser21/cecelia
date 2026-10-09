// Fixed server-owned budget; authentication failures consume the same quota.
export const TASK_MUTATION_RATE_LIMIT_OPTIONS = Object.freeze({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
