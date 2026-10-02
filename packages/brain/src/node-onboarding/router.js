import { Router } from 'express';
export function createOnboardingRouter(service) {
  const router = Router();
  const handle = (operation, status = 200) => async (req, res) => {
    try { return res.status(status).json(await operation(req)); }
    catch (error) {
      const code = [400, 404, 409, 422].includes(error.status) ? error.status : 503;
      return res.status(code).json({ error: code === 503 ? '节点接入服务当前不可用，请重试' : error.message });
    }
  };
  router.post('/', handle(req => service.create(req.body, req.get('Idempotency-Key')), 202));
  router.get('/', handle(() => service.list()));
  router.get('/:id', handle(req => service.get(req.params.id)));
  router.post('/:id/retry', handle(req => service.retry(req.params.id), 202));
  return router;
}
