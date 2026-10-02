import { Router } from 'express';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { registerJourney } from '../lib/journey-registration.js';

export function journeyRegistrationRouter(pool) {
  const router = Router();
  const handle = updating => async (req, res) => {
    try {
      const journey = await registerJourney(pool, req.body, updating ? req.params.id : undefined);
      return res.status(updating ? 200 : 201).json(journey);
    } catch (error) { return res.status(error.status || 500).json({ error: error.message }); }
  };
  router.post('/journeys', internalAuthOrLoopback, handle(false));
  router.patch('/journeys/:id', internalAuthOrLoopback, handle(true));
  return router;
}
