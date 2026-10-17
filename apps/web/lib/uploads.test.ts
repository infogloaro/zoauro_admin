import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, MAX_PDF_BYTES } from '@zoauro/shared';
import { uploadConstraints, uploadFile, UploadError, validateUploadFile } from './uploads';

function makeFile(sizeBytes: number, type: string, name = 'file.bin'): File {
  return new File([new ArrayBuffer(sizeBytes)], name, { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadConstraints', () => {
  it('limits menu images to image types and 5 MB', () => {
    const { accept, maxBytes } = uploadConstraints('MENU_IMAGE');
    expect(accept).toContain('image/webp');
    expect(accept).not.toContain('application/pdf');
    expect(maxBytes).toBe(MAX_IMAGE_BYTES);
  });

  it('accepts images and PDFs up to 10 MB for vendor documents', () => {
    const { accept, maxBytes } = uploadConstraints('VENDOR_DOC');
    expect(accept).toContain('image/jpeg');
    expect(accept).toContain('application/pdf');
    expect(maxBytes).toBe(MAX_PDF_BYTES);
  });
});

describe('validateUploadFile', () => {
  it('rejects types outside the allow-list', () => {
    const gif = makeFile(1024, 'image/gif', 'frame.gif');
    expect(validateUploadFile('VENDOR_DOC', gif)).toMatch(/JPEG, PNG, WebP image or a PDF/);
    expect(validateUploadFile('MENU_IMAGE', gif)).toMatch(/JPEG, PNG or WebP image/);
  });

  it('rejects PDFs for menu images', () => {
    const pdf = makeFile(1024, 'application/pdf', 'menu.pdf');
    expect(validateUploadFile('MENU_IMAGE', pdf)).toMatch(/JPEG, PNG or WebP image/);
  });

  it('rejects empty files', () => {
    const empty = makeFile(0, 'image/png', 'empty.png');
    expect(validateUploadFile('MENU_IMAGE', empty)).toBe('The file is empty.');
  });

  it('rejects images over 5 MB', () => {
    const big = makeFile(MAX_IMAGE_BYTES + 1, 'image/png', 'big.png');
    expect(validateUploadFile('VENDOR_DOC', big)).toMatch(/larger than 5 MB/);
  });

  it('allows a 6 MB PDF as a vendor document', () => {
    const pdf = makeFile(6 * 1024 * 1024, 'application/pdf', 'fssai.pdf');
    expect(validateUploadFile('VENDOR_DOC', pdf)).toBeNull();
  });
});

describe('uploadFile', () => {
  it('presigns, PUTs with the declared content type, then confirms', async () => {
    const file = makeFile(16, 'image/png', 'logo.png');
    let putInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/uploads/presign')) {
        return new Response(
          JSON.stringify({
            data: {
              uploadUrl: 'http://localhost:9100/zoauro-local/zone/z1/r1/u1.png',
              fileKey: 'zone/z1/r1/u1.png',
              expiresInSec: 300,
            },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('http://localhost:9100/')) {
        putInit = init;
        return new Response('', { status: 200 });
      }
      if (url.includes('/uploads/confirm')) {
        return new Response(
          JSON.stringify({
            data: { fileKey: 'zone/z1/r1/u1.png', sizeBytes: 16, contentType: 'image/png' },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadFile({
      purpose: 'VENDOR_DOC',
      zoneId: '11111111-1111-4111-8111-111111111111',
      entityId: 'a1000001-0000-4000-8000-000000000001',
      file,
    });

    expect(result.fileKey).toBe('zone/z1/r1/u1.png');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(putInit?.method).toBe('PUT');
    expect((putInit?.headers as Record<string, string>)['Content-Type']).toBe('image/png');
    const presignBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(presignBody).toMatchObject({
      purpose: 'VENDOR_DOC',
      contentType: 'image/png',
      zoneId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('fails with a friendly message when the storage PUT is rejected', async () => {
    const file = makeFile(16, 'image/png', 'logo.png');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/uploads/presign')) {
        return new Response(
          JSON.stringify({
            data: {
              uploadUrl: 'http://localhost:9100/zoauro-local/zone/z1/r1/u1.png',
              fileKey: 'zone/z1/r1/u1.png',
              expiresInSec: 300,
            },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('http://localhost:9100/')) {
        return new Response('', { status: 500 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFile({
        purpose: 'VENDOR_DOC',
        zoneId: '11111111-1111-4111-8111-111111111111',
        entityId: 'a1000001-0000-4000-8000-000000000001',
        file,
      }),
    ).rejects.toThrow(UploadError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never contacts the API when the file fails the allow-list', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadFile({
        purpose: 'MENU_IMAGE',
        zoneId: '11111111-1111-4111-8111-111111111111',
        entityId: 'a1000001-0000-4000-8000-000000000001',
        file: makeFile(1024, 'application/pdf', 'menu.pdf'),
      }),
    ).rejects.toThrow('Choose a JPEG, PNG or WebP image.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
