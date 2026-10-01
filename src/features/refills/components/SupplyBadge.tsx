import { Badge } from '@/components';
import { LowSupplyBadge } from '@/features/medications/components/LowSupplyBadge';
import type { SupplyStatus } from '@/lib/supply';

/** Low / out-of-supply pill; with `showOk`, also a calm "Supply OK" pill. */
export function SupplyBadge({
  status,
  showOk = false,
}: {
  status: SupplyStatus;
  showOk?: boolean;
}) {
  if (status === 'low') return <LowSupplyBadge />;
  if (status === 'out')
    return <Badge tone="warning" label="Out of supply" testID="out-of-supply-badge" />;
  if (status === 'ok' && showOk) return <Badge label="Supply OK" testID="supply-ok-badge" />;
  return null;
}
