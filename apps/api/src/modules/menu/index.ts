import type { Router } from 'express';
import { CategoriesService } from './categories.service';
import { ChangeRequestsService } from './change-requests.service';
import { MenuDatabase } from './menu.repository';
import { createMenuRoutes } from './menu.routes';
import { MenuService, type MenuDeps } from './menu.service';

export { MenuService } from './menu.service';
export { CategoriesService } from './categories.service';
export { ChangeRequestsService, type ChangeSubmission } from './change-requests.service';
export { MENU_ITEM_ADMIN_CHANGED, MENU_ITEM_CHANGE_DECIDED } from './menu.events';

/**
 * Menu & Food Items (SA-2.4, ZA-2.3, D119, D124-D127): items, categories, bulk actions and the R09 vendor change
 * requests. `changes.submit` is the port for the intake module (vendor app changes, doc 42).
 */
export function createMenuModule(deps: {
  prisma: ConstructorParameters<typeof MenuDatabase>[0];
  appOrigin: string;
  uploads: MenuDeps['uploads'];
  clock?: () => Date;
}): {
  router: Router;
  items: MenuService;
  categories: CategoriesService;
  changes: ChangeRequestsService;
} {
  const db = new MenuDatabase(deps.prisma);
  const clock = deps.clock ?? (() => new Date());
  const items = new MenuService({ db, uploads: deps.uploads, clock });
  const categories = new CategoriesService({ db, clock });
  const changes = new ChangeRequestsService({ db, clock });
  return {
    router: createMenuRoutes({ items, categories, changes }, { appOrigin: deps.appOrigin }),
    items,
    categories,
    changes,
  };
}
