// Logs feature module
import { Router } from 'express';
import logsRoute from './logs.route';

export const router: Router = logsRoute;
export const basePath = '/v1/logs';
export const requiresAuth = true;

export { logsRepository } from './logs.repository';
export * from './logs.types';
