'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionState, SystemStatus } from '@/lib/contracts';

/**
 * Shared read of the harness session. Imported by every UI agent, so the
 * surface stays deliberately small: one fetch, one refresh, one local write
 * for routes that already hand a fresh session back (POST /api/scenario).
 */
export function useSession() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/session returned ${res.status}`);
      const data = (await res.json()) as { session: SessionState; status: SystemStatus };
      setSession(data.session);
      setStatus(data.status);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { session, status, loading, error, refresh, mutate: setSession };
}
