import type { RequestHandler } from 'express';
import { authContextOf } from '../../lib/authz';
import { parseBody } from '../../lib/errors';
import { searchQuerySchema } from './schemas';
import type { SearchService } from './service';

// Parse (shared Zod schema) -> call the service -> send. No rules live here. Invalid input becomes the standard
// 422 VALIDATION_ERROR through parseBody; database errors reach the app's error handler (500, no details).

export function createSearchController(service: SearchService) {
  const search: RequestHandler = async (req, res) => {
    res.json(await service.search(authContextOf(res), parseBody(searchQuerySchema, req.query)));
  };
  return { search };
}
