'use client';

import type { MfaType } from '@zoauro/shared';
import { ChevronRight, Mail, MessageSquareText, Smartphone } from 'lucide-react';
import { cn } from '../../lib/utils';

// The three 2-step methods as cards (D66, owner 2026-10-14): the member picks ONE, that method opens, and one success
// is enough. Used by /2fa/setup and /2fa. A card that cannot be used here says why and cannot be chosen.

export const METHOD_ORDER: readonly MfaType[] = ['AUTHENTICATOR', 'EMAIL_OTP', 'SMS_OTP'];

const CARD: Record<MfaType, { title: string; text: string; Icon: typeof Mail }> = {
  AUTHENTICATOR: {
    title: 'Authenticator app',
    text: 'A 6-digit code from an app such as Google Authenticator or Microsoft Authenticator.',
    Icon: Smartphone,
  },
  EMAIL_OTP: {
    title: 'Email code',
    text: 'We email a 6-digit code to the address on your account.',
    Icon: Mail,
  },
  SMS_OTP: {
    title: 'Text message (SMS)',
    text: 'We text a 6-digit code to the mobile number on your account.',
    Icon: MessageSquareText,
  },
};

export interface MethodOption {
  type: MfaType;
  /** null = can be chosen; otherwise the short reason shown on the card */
  unavailable: string | null;
  /** e.g. the masked address the code goes to */
  detail?: string | undefined;
}

export function MethodChoice({
  legend,
  options,
  onChoose,
}: {
  legend: string;
  options: MethodOption[];
  onChoose: (type: MfaType) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map(({ type, unavailable, detail }) => {
        const { title, text, Icon } = CARD[type];
        return (
          <button
            key={type}
            type="button"
            disabled={unavailable !== null}
            onClick={() => onChoose(type)}
            className={cn(
              'flex w-full items-center gap-3 rounded-card border border-line p-3 text-left',
              'focus-visible:outline-2 focus-visible:outline-primary',
              unavailable === null
                ? 'cursor-pointer hover:border-primary hover:bg-bg'
                : 'cursor-not-allowed opacity-60',
            )}
          >
            <Icon aria-hidden className="size-5 shrink-0 text-primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-xs text-muted">{unavailable ?? detail ?? text}</span>
            </span>
            {unavailable === null ? (
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
            ) : null}
          </button>
        );
      })}
    </fieldset>
  );
}
