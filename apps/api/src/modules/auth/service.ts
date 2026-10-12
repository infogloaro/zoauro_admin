import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';

import type { AuthRepository, AuthSession, AuthUser } from './repository';

import type { ChangePasswordInput, LoginInput } from './schemas';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface LoginResult {
  user: {
    id: string;
    email: string;
    role: AuthUser['role'];
  };
  sessionToken: string;
  expiresAt: Date;
}

export interface AuthServiceOptions {
  sessionDurationMs?: number;
  rememberMeDurationMs?: number;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export class AuthService {
  private readonly sessionDurationMs: number;
  private readonly rememberMeDurationMs: number;

  constructor(
    private readonly repository: AuthRepository,
    options: AuthServiceOptions = {},
  ) {
    this.sessionDurationMs = options.sessionDurationMs ?? 30 * 60 * 1000;

    this.rememberMeDurationMs = options.rememberMeDurationMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.repository.findUserByEmail(input.email.toLowerCase());

    // Use the same error for an unknown email and a wrong password.
    if (!user || !user.isActive) {
      throw new AuthError('Invalid email or password', 401);
    }

    const passwordMatches = await argon2.verify(user.passwordHash, input.password);

    if (!passwordMatches) {
      throw new AuthError('Invalid email or password', 401);
    }

    // Never trust the role supplied by the client.
    if (user.role !== input.role) {
      throw new AuthError('Invalid email or password', 401);
    }

    // Do not create a normal session before MFA is completed.
    if (user.mfaEnabled) {
      throw new AuthError('MFA verification is required before login can complete', 403);
    }

    const sessionToken = randomBytes(32).toString('base64url');

    const duration = input.rememberMe ? this.rememberMeDurationMs : this.sessionDurationMs;

    const expiresAt = new Date(Date.now() + duration);

    await this.repository.createSession({
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      sessionToken,
      expiresAt,
    };
  }

  async authenticate(
    sessionToken: string,
  ): Promise<{ user: LoginResult['user']; session: AuthSession }> {
    if (!sessionToken || sessionToken.length > 256) {
      throw new AuthError('Unauthenticated', 401);
    }

    const session = await this.repository.findSessionByTokenHash(hashToken(sessionToken));

    if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
      throw new AuthError('Unauthenticated', 401);
    }

    const user = await this.repository.findUserById(session.userId);

    if (!user || !user.isActive) {
      throw new AuthError('Unauthenticated', 401);
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      session,
    };
  }

  async logout(sessionToken: string): Promise<void> {
    if (!sessionToken || sessionToken.length > 256) {
      throw new AuthError('Unauthenticated', 401);
    }

    const session = await this.repository.findSessionByTokenHash(hashToken(sessionToken));

    if (!session || session.revokedAt !== null) {
      return;
    }

    await this.repository.revokeSession(session.id);
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.repository.findUserById(userId);

    if (!user || !user.isActive) {
      throw new AuthError('Unauthenticated', 401);
    }

    const currentPasswordMatches = await argon2.verify(user.passwordHash, input.currentPassword);

    if (!currentPasswordMatches) {
      throw new AuthError('Current password is incorrect', 400);
    }

    if (input.currentPassword === input.newPassword) {
      throw new AuthError('New password must differ from the current password', 400);
    }

    const passwordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
    });

    await this.repository.updatePasswordHash(userId, passwordHash);

    // Revoke all sessions so the new password takes effect everywhere.
    await this.repository.revokeAllUserSessions(userId);
  }
}
