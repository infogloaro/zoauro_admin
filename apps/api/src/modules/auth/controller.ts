import type { Request, Response, NextFunction } from 'express';
import { AuthError, AuthService } from './service';
import { changePasswordSchema, loginSchema } from './schemas';

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    sessionToken: string;
  };
}

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = loginSchema.parse(req.body);
      const result = await this.authService.login(input);

      res.cookie('zoauro_session', result.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: result.expiresAt,
      });

      res.status(200).json({
        user: result.user,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.auth?.sessionToken) {
        await this.authService.logout(req.auth.sessionToken);
      }

      res.clearCookie('zoauro_session', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.auth?.userId) {
        throw new AuthError('Unauthenticated', 401);
      }

      const input = changePasswordSchema.parse(req.body);

      await this.authService.changePassword(req.auth.userId, input);

      res.clearCookie('zoauro_session', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
