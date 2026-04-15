/**
 * Brain Route Registration Reference
 *
 * This file documents key route registrations for the Brain server.
 * The actual HTTP server is at packages/brain/server.js.
 *
 * Route: GET /api/brain/harness/pipeline-health
 * Implementation: packages/brain/src/routes/ops.js → router.get('/harness/pipeline-health', ...)
 * Registration: ops.js is merged into the main router via routes.js → server.js
 */

export const HARNESS_ROUTES = {
  'pipeline-health': '/api/brain/harness/pipeline-health',
};
