'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

/**
 * Read-only preview of a stored file behind a short-lived signed URL
 * (doc 22 DocumentViewer, doc 11 "signed reads"). Presentational: the caller
 * resolves the URL first so load failures surface as the caller's toast/state.
 */
export function DocumentViewer({
  title,
  preview,
  url,
  expiresInSec,
  onClose,
}: {
  title: string;
  preview: 'image' | 'pdf';
  url: string;
  expiresInSec?: number;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {expiresInSec
              ? `Private file — this link expires in ${Math.max(1, Math.round(expiresInSec / 60))} minutes.`
              : 'Private file — this link expires shortly.'}
          </DialogDescription>
        </DialogHeader>
        {preview === 'pdf' ? (
          <iframe
            src={url}
            title={title}
            className="h-[70vh] w-full rounded-lg border border-border"
          />
        ) : (
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg border border-border bg-bg p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed S3 URL, no next/image optimization for cross-origin private files */}
            <img src={url} alt={title} className="max-h-[66vh] rounded" />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" /> Open in new tab
            </a>
          </Button>
          <Button type="button" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
