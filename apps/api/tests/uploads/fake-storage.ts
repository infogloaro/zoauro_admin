import type { ObjectHead, ObjectStorage } from '../../src/lib/storage';

// In-memory object storage for the integration tests: presign returns a recognisable fake URL, `put` stands in for the
// browser's PUT to that URL.

export interface FakeStorage extends ObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): void;
  readonly signed: { kind: 'upload' | 'read'; key: string }[];
}

export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const signed: { kind: 'upload' | 'read'; key: string }[] = [];
  return {
    signed,
    put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
    },
    async presignUpload(key, contentType) {
      signed.push({ kind: 'upload', key });
      return `https://storage.test/${key}?put&type=${encodeURIComponent(contentType)}`;
    },
    async presignRead(key) {
      signed.push({ kind: 'read', key });
      return `https://storage.test/${key}?get`;
    },
    async head(key): Promise<ObjectHead | null> {
      const o = objects.get(key);
      return o ? { sizeBytes: o.bytes.length, contentType: o.contentType } : null;
    },
    async readHead(key, length) {
      const o = objects.get(key);
      if (!o) throw new Error('NoSuchKey');
      return o.bytes.subarray(0, length);
    },
  };
}
