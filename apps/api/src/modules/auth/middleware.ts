import type { Request, Response, NextFunction } from 'express';
import { AuthError, AuthService } from './service';

export interface AuthRequest extends Request {
  auth?: {
    userId: string;
    sessionToken: string;
    role: string;
  };
}

export function createRequireAuth(authService: AuthService) {
  return async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionToken = req.cookies?.zoauro_session;

      if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
        throw new AuthError('Unauthenticated', 401);
      }

      const { user } = await authService.authenticate(sessionToken);

      req.auth = {
        userId: user.id,
        sessionToken,
        role: user.role,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}
