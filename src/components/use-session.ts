'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SessionState, SystemStatus } from '@/lib/contracts';

/**
 * Anything that changes shared state announces it here. The assistant can move
 * the tenant's requirements and re-run the policy through its tools, and when
 * it does, the listing cards beside it must not keep showing the old verdicts.
 */
export const SESSION_CHANGED_EVENT = 'ha:session-changed';

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
    const onChanged = () => void refresh();
    window.addEventListener(SESSION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, onChanged);
  }, [refresh]);

  return { session, status, loading, error, refresh, mutate: setSession };
}
