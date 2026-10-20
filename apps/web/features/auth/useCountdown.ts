'use client';

import { useEffect, useState } from 'react';

/**
 * Seconds left until `until` (epoch ms), ticking every second; 0 when there is nothing to wait for. The screen reader
 * text is rounded to 5-second steps (doc 52 section 9.7), so assistive technology is not flooded.
 */
export function useCountdown(until: number | null): { seconds: number; spoken: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const seconds = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  return { seconds, spoken: seconds === 0 ? 0 : Math.ceil(seconds / 5) * 5 };
}
