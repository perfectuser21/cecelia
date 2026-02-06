/**
 * Task System API Routes
 * Provides REST API for Task Management System with PostgreSQL backend
 */

import { Router } from 'express';
import projectsRouter from './projects.js';
import goalsRouter from './goals.js';
import tasksRouter from './tasks.js';
import linksRouter from './links.js';
import runsRouter from './runs.js';

const router = Router();

// Mount sub-routers
router.use('/projects', projectsRouter);
router.use('/goals', goalsRouter);
router.use('/tasks', tasksRouter);
router.use('/tasks', linksRouter);  // Task links routes
router.use('/runs', runsRouter);

// Personal tasks stub (Notion-backed, not yet implemented)
router.get('/personal', (_req, res) => {
  res.json({ success: true, tasks: [], message: 'Personal tasks API not yet connected' });
});

export default router;
