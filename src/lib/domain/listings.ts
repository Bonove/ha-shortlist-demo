import type { Listing } from '@/lib/contracts';

/**
 * The three demonstration homes from the acceptance fixture. Fictional.
 *
 * requestedDepositMonths is nullable on purpose: a scenario action can clear it
 * to demonstrate "the advertiser has not stated a deposit", which must read as
 * needs-information and never as a deposit of zero.
 */
export function seedListings(): Listing[] {
  return [
    {
      reference: 'A',
      name: 'Canal Studio',
      neighbourhood: 'Jordaan',
      monthlyRent: 1100,
      requestedDepositMonths: 2,
      minimumStayMonths: 3,
      travelMinutesToUniversity: 10,
      availableForRequestedDates: true,
      imageHue: 205,
      revision: 1,
    },
    {
      reference: 'B',
      name: 'City Room',
      neighbourhood: 'De Pijp',
      monthlyRent: 1150,
      requestedDepositMonths: 1,
      minimumStayMonths: 4,
      travelMinutesToUniversity: 25,
      availableForRequestedDates: true,
      imageHue: 28,
      revision: 1,
    },
    {
      reference: 'C',
      name: 'Park Apartment',
      neighbourhood: 'Oud-West',
      monthlyRent: 1050,
      requestedDepositMonths: 1,
      minimumStayMonths: 6,
      travelMinutesToUniversity: 15,
      availableForRequestedDates: true,
      imageHue: 152,
      revision: 1,
    },
  ];
}
