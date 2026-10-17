// Object storage port (doc 06 storage, doc 11 Uploads). Documents are private: the browser gets a short-lived
// pre-signed PUT to upload and a short-lived signed GET to view, and every view link passes through an audited API call
// (doc 15). The server uses the S3 adapter (s3-storage.ts); tests inject a fake. Ported from Chittra Priya's branch.

/** Pre-signed PUT validity for the browser upload (doc 11). */
export const PRESIGN_UPLOAD_TTL_SEC = 300;
/** Short-lived read links (doc 11, doc 15). */
export const PRESIGN_READ_TTL_SEC = 300;

export interface ObjectHead {
  sizeBytes: number;
  contentType: string;
}

export interface ObjectStorage {
  /** Pre-signed PUT for `key`; the client must send the same Content-Type header. */
  presignUpload(key: string, contentType: string): Promise<string>;
  /** Short-lived signed GET for a private object. */
  presignRead(key: string): Promise<string>;
  /** null when the object does not exist. */
  head(key: string): Promise<ObjectHead | null>;
  /** The first `length` bytes (content sniffing, doc 13 T9). */
  readHead(key: string, length: number): Promise<Uint8Array>;
}
