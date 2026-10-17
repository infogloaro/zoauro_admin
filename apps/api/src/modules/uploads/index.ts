import type { Router } from 'express';
import type { ObjectStorage } from '../../lib/storage';
import { createUploadsRoutes } from './uploads.routes';
import { UploadsService, type UploadEntities } from './uploads.service';

export { UploadsService, type UploadEntities } from './uploads.service';

/** Uploads (SA-2.1, doc 11): pre-signed private uploads; `service.assertUploaded` gates every attach of a fileKey. */
export function createUploadsModule(deps: {
  storage: ObjectStorage;
  entities: UploadEntities;
  appOrigin: string;
}): { router: Router; service: UploadsService } {
  const service = new UploadsService({ storage: deps.storage, entities: deps.entities });
  return { router: createUploadsRoutes(service, { appOrigin: deps.appOrigin }), service };
}
