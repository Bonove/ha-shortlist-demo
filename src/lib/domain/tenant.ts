import type { TenantProfile } from '@/lib/contracts';

/** Tenant Alex, as stated in the demonstration scenario. Fictional. */
export function seedTenant(): TenantProfile {
  return {
    name: 'Alex',
    city: 'Amsterdam',
    intendedStayMonths: 5,
    maxMonthlyRent: 1200,
    maxInitialPayment: 2500,
    prefersShortCommute: true,
    revision: 1,
  };
}
