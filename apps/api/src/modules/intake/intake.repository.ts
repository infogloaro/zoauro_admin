import type {
  ApiClientType,
  ApiEnvironment,
  InboundResult,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { uuidv7, type AuditTx } from '../../lib/audit';
import { auditTx } from '../../lib/db';

// Integration API persistence (doc 42, doc 45 section 3). The caller is an API client, not a staff member, so these
// methods take the authenticated client instead of an AuthContext; nothing here is zone-scoped admin data.

export interface ApiClientRecord {
  id: string;
  name: string;
  type: ApiClientType;
  environment: ApiEnvironment;
  status: 'ACTIVE' | 'DISABLED';
  scopes: string[];
  ipAllowlist: string[];
  rateLimitPerMin: number;
  /** sealed secrets that may sign now: not revoked and not past their overlap end */
  secrets: Array<{ id: string; secretEncrypted: string }>;
}

export type InboundLogResult = InboundResult;
/** The stored body: field names and id values only (see redactBody) */
export interface RedactedBody {
  fields: string[];
  ids: Record<string, string>;
}

export interface InboundLogRow {
  clientId: string;
  requestId: string;
  idempotencyKey: string | null;
  method: string;
  path: string;
  entityType: string | null;
  entityId: string | null;
  zoneId: string | null;
  result: InboundResult;
  errorCode: string | null;
  latencyMs: number;
  bodyRedacted: RedactedBody | null;
  receivedAt: Date;
}

/** last_used_at is written at most once a minute per client, not on every request. */
const LAST_USED_GRANULARITY_MS = 60_000;

export class IntakeRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async findClientByKeyId(keyId: string, now: Date): Promise<ApiClientRecord | null> {
    const c = await this.db.apiClient.findFirst({
      where: { keyId, deletedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        environment: true,
        status: true,
        scopes: true,
        ipAllowlist: true,
        rateLimitPerMin: true,
        secrets: {
          where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          select: { id: true, secretEncrypted: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return c;
  }

  /** A new API client with its first sealed secret (IH-1 `client:create`; the Hub UI later, doc 45). */
  async createClient(i: {
    id: string;
    name: string;
    type: ApiClientType;
    environment: ApiEnvironment;
    keyId: string;
    scopes: readonly string[];
    ipAllowlist: readonly string[];
    rateLimitPerMin: number;
    secretId: string;
    secretEncrypted: string;
    createdBy: string | null;
  }): Promise<void> {
    await this.db.apiClient.create({
      data: {
        id: i.id,
        name: i.name,
        type: i.type,
        environment: i.environment,
        keyId: i.keyId,
        scopes: [...i.scopes],
        ipAllowlist: [...i.ipAllowlist],
        rateLimitPerMin: i.rateLimitPerMin,
        createdBy: i.createdBy,
      },
    });
    await this.db.apiClientSecret.create({
      data: { id: i.secretId, clientId: i.id, secretEncrypted: i.secretEncrypted },
    });
  }

  async logInbound(row: InboundLogRow): Promise<void> {
    await this.db.integrationInboundLog.create({
      data: {
        id: uuidv7(),
        clientId: row.clientId,
        requestId: row.requestId,
        idempotencyKey: row.idempotencyKey,
        method: row.method,
        path: row.path,
        entityType: row.entityType,
        entityId: row.entityId,
        zoneId: row.zoneId,
        result: row.result,
        errorCode: row.errorCode,
        latencyMs: row.latencyMs,
        ...(row.bodyRedacted === null
          ? {}
          : { bodyRedactedJson: row.bodyRedacted as unknown as Prisma.InputJsonObject }),
        receivedAt: row.receivedAt,
      },
    });
    await this.db.apiClient.updateMany({
      where: {
        id: row.clientId,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(row.receivedAt.getTime() - LAST_USED_GRANULARITY_MS) } },
        ],
      },
      data: { lastUsedAt: row.receivedAt },
    });
  }
}

export interface IntakeTx {
  repo: IntakeRepository;
  audit: AuditTx;
}

export class IntakeDatabase {
  readonly repo: IntakeRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new IntakeRepository(prisma);
  }

  transaction<T>(fn: (tx: IntakeTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new IntakeRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
