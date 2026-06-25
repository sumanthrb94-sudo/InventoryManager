/**
 * useUnseenNoticesCount — drives the Notices nav badge.
 *
 * Subscribes to the `notices` collection and counts how many posts
 * have a `createdAt` newer than the operator's `lastSeenNoticesAt`
 * timestamp (persisted in localStorage). Returns the count plus a
 * `markAllSeen` function the caller fires when the operator opens
 * the Notices tab — bumps lastSeen forward so the badge clears.
 *
 * Per-browser, not per-user-doc: the team is small and the badge is
 * advisory, not auditable. Keeping it in localStorage avoids a write
 * round-trip on every tab open.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { dbService } from '../lib/dbService';

const STORAGE_KEY = 'mpm.notices.lastSeenAt';

interface NoticeShape {
  id: string;
  createdAt?: string;
}

function readLastSeen(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function useUnseenNoticesCount(): { count: number; markAllSeen: () => void } {
  const [notices, setNotices] = useState<NoticeShape[]>([]);
  const [lastSeen, setLastSeen] = useState<string>(() => readLastSeen());

  useEffect(() => {
    return dbService.subscribeToCollection('notices', (data: NoticeShape[]) => setNotices(data));
  }, []);

  const count = useMemo(() => {
    if (!notices.length) return 0;
    return notices.reduce((n, x) => n + ((x.createdAt || '') > lastSeen ? 1 : 0), 0);
  }, [notices, lastSeen]);

  const markAllSeen = useCallback(() => {
    const now = new Date().toISOString();
    try { window.localStorage.setItem(STORAGE_KEY, now); } catch { /* ignore quota / private mode */ }
    setLastSeen(now);
  }, []);

  return { count, markAllSeen };
}
