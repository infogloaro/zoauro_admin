import { describe, expect, it } from 'vitest';
import {
  fileKeyFor,
  matchesMagic,
  maxBytesFor,
  normalizeContentType,
  parseFileKey,
} from './upload-rules';

const Z = '0192f1d2-0000-7000-8000-000000000001';
const E = '0192f1d2-0000-7000-8000-000000000002';
const F = '0192f1d2-0000-7000-8000-000000000003';

describe('upload rules (doc 11, doc 13 T9)', () => {
  it('builds and parses the private key', () => {
    const key = fileKeyFor(Z, E, F, 'application/pdf');
    expect(key).toBe(`zone/${Z}/${E}/${F}.pdf`);
    expect(parseFileKey(key)).toEqual({ zoneId: Z, entityId: E, ext: 'pdf' });
    expect(parseFileKey(`zone/${Z}/${E}/${F}.exe`)).toBeNull();
    expect(parseFileKey(`../zone/${Z}/${E}/${F}.pdf`)).toBeNull();
    expect(parseFileKey(`zone/${Z}/${E}.pdf`)).toBeNull();
  });

  it('allow-lists types with their size caps', () => {
    expect(normalizeContentType('Image/JPEG; charset=utf-8')).toBe('image/jpeg');
    expect(maxBytesFor('image/png')).toBe(5 * 1024 * 1024);
    expect(maxBytesFor('application/pdf')).toBe(10 * 1024 * 1024);
    expect(maxBytesFor('image/svg+xml')).toBeNull();
    expect(maxBytesFor('application/x-msdownload')).toBeNull();
  });

  it('sniffs content: a renamed executable is not a JPEG (TC-UPL-1)', () => {
    expect(matchesMagic('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesMagic('image/jpeg', new TextEncoder().encode('MZ\x90\x00'))).toBe(false);
    expect(matchesMagic('application/pdf', new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(
      matchesMagic('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe(true);
    expect(
      matchesMagic('image/webp', new TextEncoder().encode('RIFF\x00\x00\x00\x00WEBPVP8 ')),
    ).toBe(true);
    expect(
      matchesMagic('image/webp', new TextEncoder().encode('RIFF\x00\x00\x00\x00AVI LIST')),
    ).toBe(false);
  });
});
