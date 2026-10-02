import { COMPANY_KR_SQL_GUARD, isCompanyKr } from './lib/company-kr-metrics.js';
import {createTask} from './lib/task-create.js';
import pool from './db.js';
import { broadcastTaskState } from './task-updater.js';
import { afterTerminalTransition, isTerminalStatus } from './lib/task-terminal.js';
import { assertAuthoringCompletion } from './workflow-authoring/task-guard.js';
import { detectDomain } from './domain-detector.js';
import { getDomainRole } from './role-registry.js';

const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5679';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

