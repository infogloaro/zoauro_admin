'use client';

import { Copy, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';

// Backup codes, shown once (doc 52 section 2.2 and 9.3): 10 codes, Copy / Download .txt / Print, and an "I have saved
// these codes" checkbox the caller uses to enable Continue. The codes live only in memory: never in storage or logs.

export function backupCodesText(codes: readonly string[]): string {
  return [
    'ZOAURO Admin backup codes',
    'Each code signs you in once if you cannot use your other 2-step methods.',
    '',
    ...codes,
    '',
  ].join('\n');
}

export function BackupCodes({
  codes,
  acknowledged,
  onAcknowledge,
}: {
  codes: readonly string[];
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const download = () => {
    const url = URL.createObjectURL(new Blob([backupCodesText(codes)], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zoauro-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const print = () => {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    const pre = w.document.createElement('pre');
    pre.textContent = backupCodesText(codes); // text only: nothing is parsed as HTML
    w.document.body.appendChild(pre);
    w.print();
    w.close();
  };

  return (
    <div className="flex flex-col gap-4">
      <ol
        aria-label="Backup codes"
        className="grid grid-cols-2 gap-2 rounded-input border border-line bg-bg p-4 font-mono text-sm"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(codes.join('\n'));
            setCopied(true);
          }}
        >
          <Copy aria-hidden className="size-4" /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download aria-hidden className="size-4" /> Download .txt
        </Button>
        <Button variant="secondary" onClick={print}>
          <Printer aria-hidden className="size-4" /> Print
        </Button>
      </div>
      <p className="text-sm text-muted">
        These codes are shown only now. Keep them somewhere safe, away from your phone.
      </p>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
        />
        I have saved these codes
      </label>
    </div>
  );
}
