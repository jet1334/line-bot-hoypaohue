export const SplitMode = { EQUAL: 'EQUAL', CUSTOM: 'CUSTOM' } as const;

export const Recurrence = {
  NONE: 'NONE',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;

export const BillStatus = {
  DRAFT: 'DRAFT',
  OPEN_JOIN: 'OPEN_JOIN',
  ACTIVE: 'ACTIVE',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;

export const CycleStatus = { COLLECTING: 'COLLECTING', COMPLETED: 'COMPLETED' } as const;

export const ChargeStatus = { UNPAID: 'UNPAID', PENDING: 'PENDING', PAID: 'PAID' } as const;

export const PaymentMethod = { SLIP: 'SLIP', CASH: 'CASH' } as const;

export const TripStatus = { OPEN: 'OPEN', DONE: 'DONE', CANCELLED: 'CANCELLED' } as const;
