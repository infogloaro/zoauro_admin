import type { Claim } from '@zoauro/shared';
import { Lock, UserCheck } from 'lucide-react';
import { Badge } from '../../components/ui/badge';

// D174 in a list row: who is reviewing the record right now (nothing when nobody is).

export function ClaimBadge({ claim }: { claim: Claim | undefined }) {
  if (!claim) return null;
  return claim.isMine ? (
    <Badge tone="brand">
      <UserCheck aria-hidden className="size-3" /> You are reviewing
    </Badge>
  ) : (
    <Badge tone="warning">
      <Lock aria-hidden className="size-3" /> In review: {claim.claimedBy.name}
    </Badge>
  );
}
