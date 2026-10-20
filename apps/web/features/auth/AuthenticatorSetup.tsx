'use client';

import { Copy } from 'lucide-react';
import { toDataURL } from 'qrcode';
import { useEffect, useId, useState } from 'react';
import { Button } from '../../components/ui/button';
import { OtpInput } from './OtpInput';

// Adding an authenticator app (doc 52 sections 2.2 and 9.3): the QR of the otpauth URI, the same secret as text grouped
// in fours with a copy button ("can't scan?"), and the 6-digit code that confirms it. The secret is shown once and is
// never stored by the browser. Used by the set-up wizard and by Account security.

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP" */
export const groupKey = (secret: string): string => secret.replace(/(.{4})(?=.)/g, '$1 ');

export function AuthenticatorSetup({
  secretBase32,
  otpauthUri,
  busy,
  error,
  onConfirm,
}: {
  secretBase32: string;
  otpauthUri: string;
  busy: boolean;
  error: string | null;
  onConfirm: (code: string) => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const errorId = useId();

  useEffect(() => {
    let live = true;
    toDataURL(otpauthUri, { margin: 1, width: 192, errorCorrectionLevel: 'M' })
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [otpauthUri]);

  useEffect(() => {
    if (error) setCode('');
  }, [error]);

  return (
    <div className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          Open your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …).
        </li>
        <li>Scan the QR code, or enter the key below.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {qr ? (
          // a data: URL generated in the browser; next/image adds nothing here
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            width={192}
            height={192}
            alt="QR code to add ZOAURO Admin to your authenticator app"
            className="rounded-input border border-line"
          />
        ) : (
          <div className="size-48 animate-pulse rounded-input bg-bg" aria-hidden />
        )}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Can’t scan? Enter this key</p>
          <code className="rounded-input bg-bg px-3 py-2 font-mono text-sm break-all">
            {groupKey(secretBase32)}
          </code>
          <Button
            variant="secondary"
            className="self-start"
            onClick={async () => {
              await navigator.clipboard.writeText(secretBase32);
              setCopied(true);
            }}
          >
            <Copy aria-hidden className="size-4" /> {copied ? 'Copied' : 'Copy key'}
          </Button>
        </div>
      </div>
      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={onConfirm}
        disabled={busy}
        invalid={error !== null}
        describedBy={error ? errorId : undefined}
        label="Code from the app"
      />
      <p id={errorId} aria-live="assertive" className="min-h-5 text-sm font-medium text-danger">
        {error ?? ''}
      </p>
      <Button disabled={busy || code.length !== 6} onClick={() => onConfirm(code)}>
        {busy ? 'Checking…' : 'Confirm'}
      </Button>
    </div>
  );
}
