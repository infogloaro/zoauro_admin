import type { LoginInput } from './schemas';

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  role: LoginInput['role'];
  isActive: boolean;
  mfaEnabled: boolean;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>;

  findUserById(userId: string): Promise<AuthUser | null>;

  createSession(input: CreateSessionInput): Promise<AuthSession>;

  findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null>;

  revokeSession(sessionId: string): Promise<void>;

  revokeAllUserSessions(userId: string): Promise<void>;

  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
}
