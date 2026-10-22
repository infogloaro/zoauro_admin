import type { ApiClient } from '@zoauro/api-client';
import type { OnboardingModule, OnboardingMoreInfoInput } from '@zoauro/shared';
import { isApiError, TRY_AGAIN } from '../auth/errors';
import { claimedMessage } from '../claims/api';

// The onboarding actions on one record (D170, D174), shared by the queue and the record pages: start a review (which
// claims the record) and ask the vendor for more information, each on its module's typed route.

export async function startReview(
  client: ApiClient,
  module: OnboardingModule,
  id: string,
): Promise<void> {
  const params = { id };
  if (module === 'restaurants')
    await client.post('/restaurants/{id}/onboarding/review', { params });
  else if (module === 'homemakers')
    await client.post('/homemakers/{id}/onboarding/review', { params });
  else await client.post('/hotels/{id}/onboarding/review', { params });
}

export async function requestMoreInfo(
  client: ApiClient,
  module: OnboardingModule,
  id: string,
  body: OnboardingMoreInfoInput,
): Promise<void> {
  const params = { id };
  if (module === 'restaurants')
    await client.post('/restaurants/{id}/onboarding/more-info', { params, body });
  else if (module === 'homemakers')
    await client.post('/homemakers/{id}/onboarding/more-info', { params, body });
  else await client.post('/hotels/{id}/onboarding/more-info', { params, body });
}

/** Why an onboarding action was refused: someone else's claim, no zone yet, or the API's own message. */
export const onboardingProblem = (err: unknown): string =>
  claimedMessage(err) ??
  (isApiError(err, 'CONFLICT')
    ? err.message || 'Give it a zone first: a sign-up without a zone cannot be reviewed yet.'
    : isApiError(err)
      ? err.message || TRY_AGAIN
      : TRY_AGAIN);
