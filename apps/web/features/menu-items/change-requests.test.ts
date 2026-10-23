import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '../../lib/api';
import { formatChangeValue, rejectReasonValid, runChangeDecision } from './change-requests';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { toast: toastMock } = await import('sonner');

beforeEach(() => {
  vi.clearAllMocks();
});

const CR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('runChangeDecision — approve sends only {version}, reject adds the reason', () => {
  it('sends the loaded version on approve and toasts success', async () => {
    const decide = vi.fn().mockResolvedValue({ data: {} });
    const result = await runChangeDecision({
      id: CR_ID,
      decision: 'APPROVED',
      version: 7,
      decide,
    });
    expect(decide).toHaveBeenCalledWith(CR_ID, { version: 7 });
    expect(result).toEqual({ ok: true, stale: false });
    expect(toastMock.success).toHaveBeenCalledWith('Change request approved');
  });

  it('sends {version, reason} on reject', async () => {
    const decide = vi.fn().mockResolvedValue({ data: {} });
    const result = await runChangeDecision({
      id: CR_ID,
      decision: 'REJECTED',
      version: 3,
      reason: 'Does not match the catalog',
      decide,
    });
    expect(decide).toHaveBeenCalledWith(CR_ID, {
      version: 3,
      reason: 'Does not match the catalog',
    });
    expect(result).toEqual({ ok: true, stale: false });
    expect(toastMock.success).toHaveBeenCalledWith('Change request rejected');
  });

  it('handles a stale-version 409 by reporting stale and toasting a reload hint', async () => {
    const decide = vi.fn().mockRejectedValue(
      new ApiError(409, {
        code: 'CONFLICT',
        message: 'This change request has changed since you loaded it — reload and try again',
      }),
    );
    const result = await runChangeDecision({
      id: CR_ID,
      decision: 'APPROVED',
      version: 2,
      decide,
    });
    expect(result).toEqual({ ok: false, stale: true });
    expect(toastMock.error).toHaveBeenCalledWith(
      'This change request has changed since you loaded it — reload and try again.',
    );
  });

  it('reports an already-decided request as a plain error, not stale', async () => {
    const decide = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, { code: 'INVALID_STATE_TRANSITION', message: 'Already decided' }),
      );
    const result = await runChangeDecision({
      id: CR_ID,
      decision: 'REJECTED',
      version: 2,
      reason: 'late',
      decide,
    });
    expect(result).toEqual({ ok: false, stale: false });
    expect(toastMock.error).toHaveBeenCalledWith(
      'This change request was already decided. Reload and try again.',
    );
  });

  it('surfaces any other server message as an error toast', async () => {
    const decide = vi
      .fn()
      .mockRejectedValue(
        new ApiError(403, { code: 'FORBIDDEN', message: 'Missing permission menu:status' }),
      );
    const result = await runChangeDecision({
      id: CR_ID,
      decision: 'APPROVED',
      version: 1,
      decide,
    });
    expect(result).toEqual({ ok: false, stale: false });
    expect(toastMock.error).toHaveBeenCalledWith('Missing permission menu:status');
  });
});

describe('rejectReasonValid — the contract min 1 / max 300 reason', () => {
  it('rejects empty and whitespace-only reasons', () => {
    expect(rejectReasonValid('')).toBe(false);
    expect(rejectReasonValid('   ')).toBe(false);
  });

  it('accepts a trimmed reason within the limit', () => {
    expect(rejectReasonValid('Blurry photo')).toBe(true);
    expect(rejectReasonValid('x'.repeat(300))).toBe(true);
    expect(rejectReasonValid('x'.repeat(301))).toBe(false);
  });
});

describe('formatChangeValue — paise → ₹, null → “—”', () => {
  it('formats price fields as rupees and leaves other strings alone', () => {
    expect(formatChangeValue('price', '12500')).toBe('₹125');
    expect(formatChangeValue('name', 'Ghee Podi Dosa')).toBe('Ghee Podi Dosa');
  });

  it('renders null and empty values as an em dash', () => {
    expect(formatChangeValue('category', null)).toBe('—');
    expect(formatChangeValue('description', '')).toBe('—');
  });
});
