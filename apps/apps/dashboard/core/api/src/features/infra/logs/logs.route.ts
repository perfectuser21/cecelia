// Logging routes
import { Router, Request, Response, NextFunction } from 'express';
import { logsRepository } from './logs.repository';
import { AppError } from '../../../shared/middleware/error.middleware';

const router = Router();

// POST / - Create log entry
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { level, platform, accountId, message, meta } = req.body;

    if (!level || !message) {
      throw new AppError('Missing required fields: level, message', 400);
    }

    const log = await logsRepository.create({
      action: level,
      resource_type: platform,
      details: {
        platform,
        accountId,
        message,
        ...meta,
      },
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
    });

    res.json({
      ok: true,
      logId: `log_${log.id}`,
    });
  } catch (error) {
    next(error);
  }
});

// GET /recent - Get recent logs
router.get('/recent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const logs = await logsRepository.findRecent(limit);
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// GET /action/:action - Get logs by action
router.get('/action/:action', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const logs = await logsRepository.findByAction(action, limit);
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// GET /resource/:type/:id - Get logs by resource
router.get('/resource/:type/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, id } = req.params;
    const resourceId = parseInt(id, 10);

    if (isNaN(resourceId)) {
      throw new AppError('Invalid resource ID', 400);
    }

    const limit = parseInt(req.query.limit as string, 10) || 100;
    const logs = await logsRepository.findByResource(type, resourceId, limit);
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

export default router;
