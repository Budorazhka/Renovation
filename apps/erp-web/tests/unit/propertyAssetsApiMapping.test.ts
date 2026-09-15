import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  propertyAssetsApi,
  getPublishIdempotencyKey,
  resetPublishIdempotencyKey,
} from '@/services/propertyAssetsApi'

describe('propertyAssetsApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('generates and persists idempotency key per listing attempt', () => {
    const listingId = 'listing-test-123'
    resetPublishIdempotencyKey(listingId)
    const key1 = getPublishIdempotencyKey(listingId)
    const key2 = getPublishIdempotencyKey(listingId)

    expect(key1).toBeTruthy()
    expect(key1).toBe(key2)

    resetPublishIdempotencyKey(listingId)
    const key3 = getPublishIdempotencyKey(listingId)
    expect(key3).not.toBe(key1)
  })

  it('provides methods for full property vertical flow', () => {
    expect(typeof propertyAssetsApi.listAssets).toBe('function')
    expect(typeof propertyAssetsApi.getAsset).toBe('function')
    expect(typeof propertyAssetsApi.createAsset).toBe('function')
    expect(typeof propertyAssetsApi.listListings).toBe('function')
    expect(typeof propertyAssetsApi.createListing).toBe('function')
    expect(typeof propertyAssetsApi.activateListing).toBe('function')
    expect(typeof propertyAssetsApi.publishListing).toBe('function')
    expect(typeof propertyAssetsApi.unpublishListing).toBe('function')
    expect(typeof propertyAssetsApi.getPublicationStatus).toBe('function')
    expect(typeof propertyAssetsApi.confirmActuality).toBe('function')
    expect(typeof propertyAssetsApi.getDuplicateCandidates).toBe('function')
    expect(typeof propertyAssetsApi.overrideDuplicate).toBe('function')
    expect(typeof propertyAssetsApi.listAllAssetsWithListings).toBe('function')
  })
})
