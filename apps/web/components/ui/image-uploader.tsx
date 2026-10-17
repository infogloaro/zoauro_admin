'use client';

import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { UploadPurpose } from '@zoauro/shared';
import { uploadConstraints, uploadFile, validateUploadFile } from '../../lib/uploads';
import { Button } from './button';

/**
 * Pre-signed file picker (doc 22 ImageUploader, doc 34 SA-2.1): runs the
 * presign → PUT → confirm flow and hands the confirmed `fileKey` to the
 * caller, which attaches it to its own resource. Client validation mirrors
 * the API allow-list for instant feedback only.
 */
export function ImageUploader({
  purpose,
  zoneId,
  entityId,
  disabled,
  onUploaded,
}: {
  purpose: UploadPurpose;
  zoneId: string;
  entityId: string;
  disabled?: boolean;
  onUploaded: (fileKey: string) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { accept } = uploadConstraints(purpose);

  async function handleFile(file: File | null | undefined): Promise<void> {
    if (!file) return;
    const problem = validateUploadFile(purpose, file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { fileKey } = await uploadFile({ purpose, zoneId, entityId, file });
      await onUploaded(fileKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label="Choose a file to upload"
        disabled={busy || disabled}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          'Uploading…'
        ) : (
          <>
            <Upload className="size-4" /> Upload file
          </>
        )}
      </Button>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
