/** actions 单一CI入口：按原顺序注册各职责case；共享生命周期仅此处定义。 */
import { describe, beforeAll, beforeEach, afterAll } from 'vitest';
import { loadActions, resetActions, restoreFetch } from './actions-cases/fixture.js';
import { registerCreateTask } from './actions-cases/createTask.cases.js';
import { registerCreateInitiative } from './actions-cases/createInitiative.cases.js';
import { registerCreateProject } from './actions-cases/createProject.cases.js';
import { registerUpdateTask } from './actions-cases/updateTask.cases.js';
import { registerCreateGoal } from './actions-cases/createGoal.cases.js';
import { registerUpdateGoal } from './actions-cases/updateGoal.cases.js';
import { registerTriggerN8n } from './actions-cases/triggerN8n.cases.js';
import { registerSetMemory } from './actions-cases/setMemory.cases.js';
import { registerBatchUpdateTasks } from './actions-cases/batchUpdateTasks.cases.js';

beforeAll(loadActions);
afterAll(restoreFetch);
describe('actions.js', () => {
  beforeEach(resetActions);
  registerCreateTask();
  registerCreateInitiative();
  registerCreateProject();
  registerUpdateTask();
  registerCreateGoal();
  registerUpdateGoal();
  registerTriggerN8n();
  registerSetMemory();
  registerBatchUpdateTasks();
});
