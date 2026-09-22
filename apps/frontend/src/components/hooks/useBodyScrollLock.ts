'use client';

import { useEffect } from 'react';

/** Locks page scroll while a modal is open — same pattern as EPCCRM's AppModal. */
export function useBodyScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isLocked]);
}
