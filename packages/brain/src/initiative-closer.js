import { computeCapacity } from './capacity.js';

/** 从既有worker槽位计算容量上限。 */
export function getMaxActiveInitiatives(slots) {
  return computeCapacity(slots).initiative.max;
}

export const MAX_ACTIVE_INITIATIVES = 9;
