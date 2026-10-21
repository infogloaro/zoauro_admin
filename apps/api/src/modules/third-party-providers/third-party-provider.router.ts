import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { thirdPartyProviderHandlers } from './third-party-provider.controller';
import { requireThirdPartyProviderPermission } from './third-party-provider.scope';

/**
 * Third-Party Partners endpoints (task: Third-Party Partners page).
 *
 *   GET  /third-party-providers                       providers:view   list + counts/facets
 *   POST /third-party-providers                       providers:add    coverage zones required (doc 36)
 *   PATCH  /third-party-providers/{id}                providers:edit   profile / coverage / integration flag
 *   POST /third-party-providers/{id}/status           providers:status ACTIVE | INACTIVE | SUSPENDED
 *
 * A provider is a company record distinct from an own delivery partner (M10),
 * so it lives under its own path and its own `providers:*` permission
 * namespace. No DELETE route and no credential/secret endpoint exist — the
 * integration status is a flag only (task constraint; see the handoff gap
 * note for a real integration contract).
 */
export function createThirdPartyProvidersRouter(): Router {
  const router: Router = Router();
  const h = thirdPartyProviderHandlers;

  router.use(requireAuth, requireThirdPartyProviderPermission('view'));

  router.get('/', h.list);
  router.post('/', requireThirdPartyProviderPermission('add'), h.create);
  router.patch('/:id', requireThirdPartyProviderPermission('edit'), h.patch);
  router.post('/:id/status', requireThirdPartyProviderPermission('status'), h.status);

  return router;
}
