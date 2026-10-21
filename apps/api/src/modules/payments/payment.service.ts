import * as repo from './payment.repository';

export async function list(
  ctx: { userId: string },
  params: { page: number; pageSize: number; q?: string; status?: string; method?: string },
) {
  return repo.listPayments(params);
}
