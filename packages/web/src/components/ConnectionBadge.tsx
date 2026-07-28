import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.js';
import type { ConnectionStatus } from '../net/connection.js';

interface Props {
  status: ConnectionStatus;
  retryAt: number | null;
  onRetry: () => void;
}

const LABEL: Record<ConnectionStatus, 'connOffline' | 'connConnecting' | 'connOnline' | 'connReconnecting'> = {
  idle: 'connOffline',
  connecting: 'connConnecting',
  open: 'connOnline',
  reconnecting: 'connReconnecting',
  offline: 'connOffline',
};

export function ConnectionBadge({ status, retryAt, onRetry }: Props): React.JSX.Element {
  const { t } = useI18n();
  const seconds = useCountdown(retryAt);

  return (
    <div className={`conn conn--${status}`} role="status" aria-live="polite">
      <span className="conn__dot" />
      <span>{t(LABEL[status])}</span>
      {status === 'offline' && (
        <button type="button" className="conn__retry" onClick={onRetry}>
          {seconds > 0 ? t('connRetryIn', { seconds }) : t('connRetryNow')}
        </button>
      )}
    </div>
  );
}

/** Ticks once a second, and only while there is something to count down to. */
function useCountdown(target: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (target === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [target]);

  if (target === null) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}
