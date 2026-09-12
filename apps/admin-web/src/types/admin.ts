export type PublicationSourceType = 'development' | 'unit' | 'listing'
export type PublicationStatus = 'publication_pending' | 'published' | 'unpublished' | 'build_failed'

export interface AdminPublicationListItem {
  id: string
  sourceType: string
  sourceId: string
  organizationId: string | null
  status: string
  slug: string | null
  publishedAt: string | null
  unpublishedAt: string | null
  unpublishReason: string | null
  city: string | null
}

export interface AdminPublicationList {
  items: AdminPublicationListItem[]
  nextCursor: string | null
}

export interface AdminPublicationListQuery {
  sourceType?: PublicationSourceType
  city?: string
  cursor?: string
  limit?: number
}

export interface UnpublishResult {
  id: string
  sourceType: string
  sourceId: string
  status: string
  slug: string | null
  unpublishReason: string | null
}

export interface AdminAccountListItem {
  id: string
  identityId: string
  isSuperAdmin: boolean
  status: 'active' | 'deactivated'
  createdAt: string
}

export interface AdminAccountList {
  items: AdminAccountListItem[]
  nextCursor: string | null
}

/** PermissionScope — см. apps/api PermissionGrantDocument.scope. */
export type PermissionScope =
  | 'own'
  | 'position'
  | 'team'
  | 'organization'
  | 'project'
  | 'city'
  | 'global'
  | 'assigned'
  | 'domain'

export interface PermissionGrant {
  id: string
  resource: string
  action: string
  scope: PermissionScope
  scopeValue?: string
  version: number
  revokedAt?: string
  revokedBy?: string
  revokeReason?: string
}

export interface DeactivateReactivateResult {
  status: 'active' | 'deactivated'
}

export interface PublicationReadScopeEntry {
  global: boolean
  cities: string[]
}

export interface AdminMe {
  adminAccountId: string
  isSuperAdmin: boolean
  publicationReadScope: 'all' | Partial<Record<PublicationSourceType, PublicationReadScopeEntry>>
}

export type AuditResource = PublicationSourceType | 'admin_account' | 'complaint' | 'duplicate_candidate'

export interface AdminAuditEventView {
  id: string
  action: string
  resource: string
  resourceId: string
  actor: { type: string; id: string | null }
  createdAt: string
  correlationId: string
  reason: string | null
  summary: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface AdminAuditEventList {
  items: AdminAuditEventView[]
  nextCursor: string | null
}

export interface AdminAuditEventListQuery {
  resource?: AuditResource
  action?: string
  resourceId?: string
  publicationId?: string
  actorId?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

// Complaints
export type ComplaintCategory = 'not_available' | 'wrong_info' | 'scam' | 'duplicate' | 'other'
export type ComplaintStatus = 'pending' | 'resolved_upheld' | 'resolved_dismissed'

export interface AdminComplaintListItem {
  id: string
  status: ComplaintStatus
  category: ComplaintCategory
  details: string | null
  propertyAssetId: string
  listingId: string
  scopeCity: string
  respondentScope: { type: string; organizationId: string | null }
  createdAt: string
  resolvedAt: string | null
  resolutionReason: string | null
}

export interface AdminComplaintList {
  items: AdminComplaintListItem[]
  nextCursor: string | null
}

export interface AdminComplaintListQuery {
  status?: ComplaintStatus
  cursor?: string
  limit?: number
}

export interface ResolveComplaintResult {
  id: string
  status: 'resolved_upheld' | 'resolved_dismissed'
}

// Duplicate Candidates
export type DuplicateCandidateStatus = 'detected' | 'confirmed_duplicate' | 'override_not_duplicate'

export interface AdminDuplicateCandidateAssetSummary {
  id: string
  propertyType: string
  location: { city: string; address: string }
  characteristics: { area: number; rooms: number | null; floor: number | null }
  representativePhone: string
  publisherScope: { type: string; organizationId: string | null }
}

export interface AdminDuplicateCandidateListItem {
  id: string
  status: DuplicateCandidateStatus
  signals: { phoneMatch: boolean; addressMatch: boolean; roomsAreaFloorMatch: boolean }
  detectedAt: string
  overrideReason: string | null
  overrideAt: string | null
  confirmReason: string | null
  confirmedAt: string | null
  assetA: AdminDuplicateCandidateAssetSummary | null
  assetB: AdminDuplicateCandidateAssetSummary | null
}

export interface AdminDuplicateCandidateList {
  items: AdminDuplicateCandidateListItem[]
  nextCursor: string | null
}

export interface AdminDuplicateCandidateListQuery {
  status?: DuplicateCandidateStatus
  cursor?: string
  limit?: number
}

export interface ConfirmDuplicateResult {
  id: string
  status: 'confirmed_duplicate'
}

// Organizations
export type AdminOrganizationType = 'agency' | 'developer' | 'independent_realtor'
export type AdminOrganizationStatus = 'active' | 'frozen' | 'archived'

export interface AdminOrganizationPosition {
  id: string
  role: string
  status: string
}

export interface AdminOrganizationListItem {
  id: string
  name: string
  type: AdminOrganizationType
  status: AdminOrganizationStatus
  mlsVerified: boolean
  createdAt: string
  positionsCount?: number
}

export interface AdminOrganizationList {
  items: AdminOrganizationListItem[]
  nextCursor: string | null
}

export interface AdminOrganizationListQuery {
  type?: AdminOrganizationType
  status?: AdminOrganizationStatus
  search?: string
  cursor?: string
  limit?: number
}

export interface AdminOrganizationDetail {
  id: string
  name: string
  type: AdminOrganizationType
  status: AdminOrganizationStatus
  mlsVerified: boolean
  createdAt: string
  positionsCount: number
  positions: AdminOrganizationPosition[]
}

export interface FreezeOrganizationResult {
  id: string
  status: 'frozen'
}

export interface UnfreezeOrganizationResult {
  id: string
  status: 'active'
}

export interface VerifyMlsResult {
  id: string
  mlsVerified: true
}

export interface RevokeMlsVerificationResult {
  id: string
  mlsVerified: false
}

// Billing
export interface PlanLimits {
  maxActiveListings: number
  maxTeamPositions: number
  crmAccess: boolean
  chessboardAccess: boolean
  landingAccess: boolean
}

export interface PricePerMonth {
  amountMinorUnits: number
  currency: string
}

export interface SubscriptionPlan {
  code: string
  name: string
  targetAudience: 'developer' | 'agency' | 'independent_realtor'
  limits: PlanLimits
  pricePerMonth: PricePerMonth
  isActive: boolean
}

export interface ResourceUsage {
  activeListings: number
  teamPositions: number
}

export interface OrganizationSubscription {
  organizationId: string
  planCode: string
  status: 'trial' | 'active' | 'grace_period' | 'frozen' | 'cancelled'
  startedAt: string
  expiresAt: string
  gracePeriodEndsAt?: string | null
  customLimits?: PlanLimits | null
  currentUsage: ResourceUsage
}

export interface BillingLedgerEntry {
  id: string
  organizationId: string
  action: 'plan_activated' | 'plan_renewed' | 'plan_changed' | 'limit_adjusted' | 'payment_recorded' | 'frozen' | string
  amountMinorUnits: number
  currency: string
  planCode: string
  periodDays: number
  reason: string
  recordedBy?: string
  createdAt: string
}

export interface AdminBillingOverview {
  subscription: OrganizationSubscription
  plan: SubscriptionPlan | null
  effectiveLimits: PlanLimits
  ledger: BillingLedgerEntry[]
}

export interface ActivateSubscriptionParams {
  planCode: string
  periodDays?: number
  amountMinorUnits?: number
  currency?: string
  reason: string
}
