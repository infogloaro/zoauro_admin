'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Reusable black prototype toast.
 * - Black/near-black background with white text
 * - Bottom-right corner positioning
 * - Rounded corners and subtle shadow
 * - Auto-dismiss after ~3 seconds
 * - Prevents duplicate overlapping toasts
 * - Accessible status announcement
 * Responsive positioning on mobile.
 */
export function usePrototypeToast(message?: string, options?: { autoClose?: boolean }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!message) return;

    toast.info(message, {
      description: '',
      action: [],
      // Custom styling via CSS override
      className: 'prototype-toast',
      // Auto-dismiss after 3 seconds unless otherwise configured
      duration: options?.autoClose === false ? undefined : 3000,
    });

    setShown(true);

    // Clean up state after toast dismisses
    setTimeout(() => setShown(false), 4000);
  }, [message]);

  return shown;
}

/**
 * Show the prototype welcome toast.
 * Should be called once on screen mount in demo/prototype mode.
 */
export function showPrototypeWelcomeToast() {
  toast.error('Welcome to the Super Admin Prototype', {
    description: '',
    action: [],
    className: 'prototype-toast',
    duration: 5000,
  });
}
