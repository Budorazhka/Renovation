import axios from 'axios'
import { PLATFORM_API_BASE_URL } from '@/config/backend'

/**
 * BOOK-002: изолированный клиент к бэкенду apps/api/src/modules/bookings —
 * тот же паттерн, что developmentsApiV2.ts (свой axios-инстанс,
 * PLATFORM_API_BASE_URL, withCredentials, не {success,data} обёртка).
 * НЕ смешивается с legacy components/development/sales/bookingsApi.ts —
 * тот работает через CRM_API_BASE_URL (apps/erp-web/src/services/
 * developmentApi.ts) и остаётся единственным источником для
 * InteractiveChessboard.tsx (легаси-шахматка, вне скоупа этой миграции).
 */
const api = axios.create({
  baseURL: PLATFORM_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type BookingStatusV2 = 'pending' | 'booked' | 'rejected' | 'expired' | 'paid'

export interface BookingV2 {
  id: string
  unitId: string
  organizationId: string
  leadId: string | null
  dateRange: { startsAt: string; expiresAt: string }
  status: BookingStatusV2
  manager: string
  createdAt: string
}

export interface ListBookingsV2Filters {
  developmentId?: string
  buildingId?: string
  unitId?: string
  status?: BookingStatusV2
  cursor?: string
  limit?: number
}

export interface ListBookingsV2Result {
  items: BookingV2[]
  nextCursor: string | null
}

/**
 * Idempotency-Key на попытку confirm/cancel конкретного bookingId — тот же
 * принцип, что developmentsApiV2.getCreateIdempotencyKey: ключ живёт до
 * успеха попытки, ретрай той же попытки обязан слать тот же ключ.
 */
const confirmAttemptKeys = new Map<string, string>()
const cancelAttemptKeys = new Map<string, string>()

function attemptKey(store: Map<string, string>, bookingId: string): string {
  let key = store.get(bookingId)
  if (!key) {
    key = uid()
    store.set(bookingId, key)
  }
  return key
}

export const bookingsApiV2 = {
  /** GET /api/v1/bookings — cursor-пагинация, developmentId/buildingId/unitId/status опциональны. */
  async list(filters?: ListBookingsV2Filters): Promise<ListBookingsV2Result> {
    const { data } = await api.get<ListBookingsV2Result>('/api/v1/bookings', { params: filters })
    return data
  },

  /** POST /api/v1/bookings/:id/confirm — booking.confirm (own/organization). */
  async confirm(bookingId: string): Promise<BookingV2> {
    const idempotencyKey = attemptKey(confirmAttemptKeys, bookingId)
    const { data } = await api.post<BookingV2>(
      `/api/v1/bookings/${bookingId}/confirm`,
      {},
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    confirmAttemptKeys.delete(bookingId)
    return data
  },

  /** POST /api/v1/bookings/:id/cancel — booking.cancel (organization). */
  async cancel(bookingId: string, reason?: string): Promise<BookingV2> {
    const idempotencyKey = attemptKey(cancelAttemptKeys, bookingId)
    const { data } = await api.post<BookingV2>(
      `/api/v1/bookings/${bookingId}/cancel`,
      { reason },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    cancelAttemptKeys.delete(bookingId)
    return data
  },

  /** GET /api/v1/bookings/:id */
  async getById(bookingId: string): Promise<BookingV2> {
    const { data } = await api.get<BookingV2>(`/api/v1/bookings/${bookingId}`)
    return data
  },

  /** POST /api/v1/bookings — booking.create (requires Idempotency-Key) */
  async create(payload: CreateBookingV2Payload, idempotencyKey?: string): Promise<BookingV2> {
    const key = idempotencyKey || uid()
    const { data } = await api.post<BookingV2>('/api/v1/bookings', payload, {
      headers: { 'Idempotency-Key': key },
    })
    return data
  },

  /** POST /api/v1/bookings/:id/extend */
  async extend(bookingId: string, payload: ExtendBookingPayload, idempotencyKey?: string): Promise<BookingV2> {
    const key = idempotencyKey || attemptKey(confirmAttemptKeys, `extend-${bookingId}`)
    const { data } = await api.post<BookingV2>(`/api/v1/bookings/${bookingId}/extend`, payload, {
      headers: { 'Idempotency-Key': key },
    })
    confirmAttemptKeys.delete(`extend-${bookingId}`)
    return data
  },

  /** POST /api/v1/bookings/:id/convert-to-deal */
  async convertToDeal(
    bookingId: string,
    payload: ConvertBookingToDealPayload = {},
    idempotencyKey?: string,
  ): Promise<ConvertBookingToDealResult> {
    const key = idempotencyKey || attemptKey(confirmAttemptKeys, `convert-${bookingId}`)
    const { data } = await api.post<ConvertBookingToDealResult>(
      `/api/v1/bookings/${bookingId}/convert-to-deal`,
      payload,
      { headers: { 'Idempotency-Key': key } },
    )
    confirmAttemptKeys.delete(`convert-${bookingId}`)
    return data
  },
}

export interface CreateBookingV2Payload {
  unitId: string
  leadId?: string | null
  startsAt: string
  expiresAt: string
}

export interface ExtendBookingPayload {
  newExpiresAt: string
  reason?: string
}

export interface ConvertBookingToDealPayload {
  title?: string
  contactId?: string
  dealType?: 'primary' | 'secondary' | 'rental' | 'assignment'
  installmentPlanId?: string
  downPayment?: { amountMinorUnits: number; currency: string }
  expectedCommission?: { amountMinorUnits: number; currency: string }
  notes?: string
}

export interface ConvertBookingToDealResult {
  booking: BookingV2
  dealId: string
}
