# Entities — domain dictionary

Every business entity across the BazaSale26 system: what it means, which **database and
collection** it actually lives in, and its exact foreign keys. Reference for building the
interaction map — so links are given as real field names, not conceptual relations.

Created: 2026-07-29 · Sources: `berega-api/src/shemas/` (53 schemas), `bz26-api-crm/src/**/schemas/`
(48 schemas), and client types in `bz26-client-erp/src/`.

---

## Roles chain

The actor hierarchy the whole system is organized around. Scope widens left to right: each link
supervises or supplies the one before it.

```
realtor / user  →  head of sales / MLM curator  →  agency / MLS  →  developer
```

| Link | Who they are | How the data models them |
|---|---|---|
| **Realtor / user** | The individual seller or portal user. Owns leads, books units, builds selections. | Platform `users` with `isRealtor`; client `AccountType: 'realtor'`; a `manager` position in `team_positions`; network funnel track `realtor_1` … `realtor_6`; `developmentbookings.realtor`, `development-sales-clients.realtor` |
| **Head of sales / MLM curator** | Supervises a group of realtors — sales targets in the agency direction, network growth in the MLM direction. | `team_positions.role: 'rop'` (+ `director`), reached via `parentPositionId`; network funnel track `curator_1` … `curator_6`; targets in `analyticsplans` and `development-sales-plans.positionId`; `leadtransfers` and `distributionsettings.manualDistributorId` |
| **Agency / MLS** | The company: org chart, shared listing base, and the MLS layer where agencies co-broke with commission splits. | `teams` (one per `ownerUserId`) + `team_positions` tree; `AccountType: 'agency'`; `users.mlsLeader` and `mlsVerifiedCities`; `userverificationrequests`; `estateapartments.commissionMls`; community `segment: 'broker'` |
| **Developer** | The construction company at the top of supply: owns complexes, sets prices and commission, confirms bookings. | `developers` collection (`author` → `users`); `AccountType: 'developer'`; owns `estates` → `estatebuildings` → `estatenewconstructionsapartments`; approves `developmentbookings`; buys `promotions` |

Two things this chain does **not** capture, and the interaction map will need both:

- **The chain is two chains.** Toward an agency the middle link is a `rop` over sales targets;
  toward the network it is a curator over recruitment, with its own funnel
  (`productType: 'network'`) and its own stage tracks. The same person can hold both.
- **Position, not person.** Membership is expressed through `team_positions`, which is a slot that
  can be vacant and can change occupant, so a realtor's place in the chain is
  `occupantUserId` at a point in time — see §2.

Alongside this chain sit two actors that are not part of it: the **owner** (собственник, selling
their own object — `productType: 'owner'`) and the **agent/посредник** (referral intermediary —
`productType: 'agent'`), each with its own lead funnel.

---

## 1. Systems and databases

Three codebases, **two** MongoDB databases. The client talks to both APIs; the two APIs
overlap on one database.

| Codebase | Role | Databases it connects to |
|---|---|---|
| `platform/api/berega-api` | Public platform API (baza.sale portal) | Platform DB only |
| `erp/bz26-api-crm` | ERP/CRM API | **CRM DB** (default) + **Platform DB** (`connectionName: 'platform'`) |
| `erp/bz26-client-erp` | ERP SPA (this repo) | neither directly — HTTP to both APIs |

| Database | Env var | Contents |
|---|---|---|
| **Platform DB** (`coasts_db`) | `MONGO_REMOTE_URI` / `MONGO_URI` (berega) · `MONGODB_PLATFORM_URI` (CRM) | Listings, complexes, buildings, units, developers, platform users, media, promotions, finance, platform community |
| **CRM DB** | `MONGODB_URI` (CRM API only) | Leads, tasks, notes, notifications, calendar, teams, reports, LMS, ERP community |

`berega-api` uses a single connection with **no** `connectionName`; `bz26-api-crm` declares both
(`src/app.module.ts:31` and `:38`).

### The three cross-database seams

These are where the interaction map will need explicit joins — Mongoose `populate` does not work
across them, so the join happens in application code.

1. **`leads.complexId` → `estates._id`.** A CRM lead pointing at a platform complex. Deliberately
   ref-less because it crosses clusters. Powers the developer funnel.
2. **`development-sales-plans.positionId` → `team_positions._id`.** A platform-DB document
   pointing back at a CRM-DB org position.
3. **Two `users` collections**, one per database, with different shapes. Login aligns `_id` across
   both, so the same id means the same human — but the documents are not the same document.
   See `bz26-api-crm/docs/user-id-remap-impact.md`.

### Who writes what on the Platform DB

Platform DB is shared, not exclusively berega's. Ownership matters for the map:

| Collections | Written by |
|---|---|
| `estates`, `estatebuildings`, `estateapartments`, `estatenewconstructionsapartments`, `estatelayouts`, `developers`, `cdn_files`, `floor-plans-data`, `promotions`, `users`, and the rest | `berega-api` (CRM API reads and writes a subset) |
| `developmentbookings`, `development-sales-clients`, `development-sales-plans`, `development-marketing` | **`bz26-api-crm` only** — these exist nowhere in berega-api |
| `unitsharelinks` | **Both**, independently — see §9 |

Note that the CRM API reaches several platform collections through raw
`connection.collection('…')` rather than `@InjectModel`, so schema middleware and automatic index
creation do not run on that path.

---

## 2. Users, teams & access

| Entity | Collection · DB | What it is | Refs out |
|---|---|---|---|
| **Platform User** | `users` · Platform | The portal account: profile, contacts, realtor flags, MLS verification, balance, referral code. The `author`/`developer` target of nearly every platform document. | `refererId` → `users` (self) |
| **CRM User** | `users` · CRM | Slim CRM-side auth record: name, email, role, password, `isOwner`. Target of every CRM `assignedTo`/`createdBy`. | — |
| **Team** | `teams` · CRM | One org chart, owned by a user. | `ownerUserId` → user id (no ref) |
| **TeamPosition** | `team_positions` · CRM | A **slot** in the org chart, not a person: role, contacts, RBAC, access profile. May be vacant; `occupancyHistory` records who held it and when, so historical work stays attributed. | `teamId` → `teams`, `parentPositionId` → `team_positions` (self, tree), `occupantUserId` → platform `users` — all ref-less |
| **ProfileSettings** | `profilesettings` · Platform | Per-user portal preferences: role, intents, contact prefs, notifications, privacy, units, timezone. | `userId` → `users` (unique) |
| **UserVerificationRequest** | `userverificationrequests` · Platform | MLS/multilisting verification request for a city. | `author` → `users` |

Role enum on `team_positions`: `owner`, `director`, `rop`, `marketer`, `administrator`, `manager`.
Status: `active` / `blocked` / `invited`.

---

## 3. CRM — leads & funnel (CRM DB)

`leads` is the centre of the CRM. Almost every other CRM collection carries a `leadId`.

| Entity | Collection | What it is | Refs out |
|---|---|---|---|
| **Lead** | `leads` | Inbound interest: contact, budget, funnel stage, product type, folder. | `assignedTo`, `createdBy` → `users`; `complexId` → platform `estates` (ref-less); `channelId` → reserved; `history[].changedBy` → `users` |
| **LeadHistory** | *embedded in* `leads` | Append-only audit inside the lead: `stage_change`, `assign`, `comment`, with from/to stages. | `changedBy` → `users` |
| **LeadFile** | *embedded in* `leads` | Attachments on the lead. | — |
| **LeadSource** | `leadsources` | Named acquisition source with daily/monthly caps. | `createdBy` → `users` |
| **LeadImport** | `leadimports` | Bulk import run: row counts, per-row errors, status. | `createdBy` → `users` |
| **LeadTransfer** | `leadtransfers` | Record of a lead moving between users, including returns. | `leadId`, `fromUser`, `toUser` |
| **LeadContactAction** | `leadcontactactions` | A single `call` or `chat` touch — the raw activity metric. | `leadId`, `userId` |
| **Checklist** | `checklists` | Per-stage checkbox state for a lead. Unique on `{leadId, stage, index}`. | `leadId`, `userId` |
| **StageComment** | `stagecomments` | One comment per lead per stage. Unique on `{leadId, stage}`. | `leadId`, `createdBy`, `updatedBy` |
| **DistributionSettings** | `distributionsettings` | How new leads are handed out: `round_robin`, `by_load`, `manual`. Singleton (`key: 'default'`). | `manualDistributorId` → `users` |
| **AnalyticsPlan** | `analyticsplans` | Per-user weekly/monthly targets: leads, contacts, deals. | `userId` (unique) |
| **BaseFile** | `basefiles` | Shared company file library, scoped by product type. | `uploadedBy` → `users` |
| **LibraryFolder** | `libraryfolders` | Folder tree for the realtor file library. | `parentId` → self, `createdBy` |
| **RealtorLibraryFile** | `realtorlibraryfiles` | Personal file inside a realtor's library folder. | `realtorId`, `folderId` |

### Funnels and stages

`productType` selects the funnel: `sales`, `network`, `courses`, `owner`, `agent`. `stage` is one
`LeadStage` enum with 100+ values, prefixed by funnel — plus `realtorStage` and `curatorStage` as
parallel sub-tracks for the network funnel.

| Funnel | Stage values |
|---|---|
| Sales / courses (legacy, unprefixed) | `first_contact` (default), `qualification`, … `deal_closed`, `post_purchase_followup`, `registered`, `adapted` |
| Network — realtor track | `realtor_1` … `realtor_6` |
| Network — curator track | `curator_1` … `curator_6` |
| Network — pipeline | `network_new_lead`, `network_call_later`, `network_company_presented`, … `network_work_started` |
| Network — rejection | `network_rejected`, `network_rejected_defective`, `network_no_call_1/2/3` |
| Owner | `owner_new_object_inquiry`, … `owner_rejected_defective` |
| Agent (посредник) | `agent_active`, … `agent_rejected_defective` |

`folder` parks a lead outside the funnel: `rejected`, `deferred_demand`, `golden_fund`,
`transferred`. `rejectionReason` has 11 values (`price_too_high`, `defective_lead`,
`cannot_contact`, …). Network leads are de-duplicated by a partial unique index on
`{email, productType, assignedTo}`.

---

## 4. CRM — work management (CRM DB)

| Entity | Collection | What it is | Refs out |
|---|---|---|---|
| **Task** | `tasks` | To-do with subtasks, files and Eisenhower priority. Optionally mirrored to calendar. | `assignedTo`, `createdBy` → `users`; `leadId` → `leads`; `calendarEventId` is a plain string |
| **Category** | `categories` | Numeric-id classifier shared by tasks and notes. | — |
| **Note** | `notes` | Pinnable note with files, attachable to a lead or task. | `leadId`, `taskId`, `createdBy`, `updatedBy` |
| **CalendarEvent** | `calendarevents` | Meeting/call/reminder with participants and reminder offsets; recurring via `parentEventId`. | `userId`, `participants[]`, `createdBy`, `updatedBy`; `leadId`, `taskId`, `parentEventId` → self |
| **Notification** | `notifications` | In-app message. Doubles as a request/response thread via `parentRequestId`. TTL 30 days. | `userId`, `respondedBy`, `createdBy`; `taskId`, `leadId`, `parentRequestId` → self |
| **Appeal** | `appeals` | Support ticket with urgency and a public `uniqueNumber`. | `userId` |
| **OnlinePresence** | `onlinepresences` | Last-seen heartbeat, one per user. | `userId` (unique) |
| **OnlineMinutesDaily** | `onlineminutesdailies` | Minutes online per user per day. Unique on `{userId, date}`. | `userId` |
| **ReportCache** | `reportcaches` | Memoized report payload keyed by type/period/hash. TTL 24h. | `userId` |
| **ReportExport** | `reportexports` | Generated Excel/PDF/CSV file. TTL 3 days. | `userId` |
| **CalendarSyncConfig** | `calendarsyncconfigs` | Google/Apple calendar sync tokens. **Not wired** — schema exists but is not registered in `CalendarModule`; treat as planned. | `userId` (unique) |

Task priority is the Eisenhower matrix (`urgent_important` … `not_urgent_not_important`); status is
`pending` / `in_progress` / `completed` / `cancelled`. Event type: `meeting`, `call`, `reminder`,
`task`, `lead_followup`. Report types cover sales efficiency, lead sources, conversion, network and
curator efficiency.

---

## 5. Real estate (Platform DB)

The inventory hierarchy is **Estate → EstateBuilding → unit**, where "unit" is a different
collection for new builds than for the secondary market.

| Entity | Collection | What it is | Refs out |
|---|---|---|---|
| **Estate** (ЖК / listing) | `estates` | The universal top-level object. `isComplex` / `isNewBuild` decide whether it is a residential complex or a standalone listing. Carries passport data, price range, installment wizard data, 50+ amenity fields, and a denormalized promotion cache (`paramOverlayText`, `paramMark`, `paramSections`, `paramExpiresAt`). | `author` → `users`, `developer` → `developers`, `coverFileId` + 5 more file arrays → `cdn_files` |
| **EstateBuilding** (корпус) | `estatebuildings` | A block within a complex: floors, units per floor, footprint, building type. | `estate`, `author`, `developer`, `floorPlansFiles`/`apartmentsPlansFiles` → `cdn_files`, `floorPlansData` → `floor-plans-data` |
| **EstateNewconstructionsApartment** (лот) | `estatenewconstructionsapartments` | A new-build unit — the sellable leaf and what the chessboard renders. `plot` holds its polygon; `reservedUntil` holds the booking hold. | `estate`, `building`, `author`, `developer`, `layout` → `estatelayouts`, `imageFileId` → `cdn_files` |
| **EstateApartment** (вторичка) | `estateapartments` | A secondary-market listing with localized titles, commission and MLS commission. Separate collection from new-build units. | `estate`, `building`, `author`, `developer` |
| **EstateLayout** (планировка) | `estatelayouts` | Reusable apartment plan shared by many units. Building-scoped, or complex-wide when `building` is null. | `estate`, `building`, `author`, `planFileId` |
| **FloorPlansData** | `floor-plans-data` | One floor's image plus clickable polygons. `apartments[]` is an array of **encoded strings** (`aptNum|status|polygon`), not subdocuments. | `buildingId`, `imageId` |
| **CdnFile** | `cdn_files` | Uploaded file. Target of file refs everywhere; holds no refs itself. | — |
| **Developer** (застройщик) | `developers` | Developer company: contacts, site, rating. Unique `email`. | `author` → `users` |
| **EstateAggregation** | `estateaggregations` | Precomputed per-complex rollup: units by room count, price/area ranges, status breakdown. | `estate` (unique) |
| **EstateAggregNewconstructions** | `estateaggregationsnewconstructions` | Same idea, new-build specific (`priceFrom`, `totalFloorsFrom/To`). | `estate` (unique) |
| **EstateApartmentRent** | `estateapartmentrents` | Rent-focused mirror of `estateapartments`. **Orphan** — schema and indexes exist, never registered. | `estate`, `building`, `author` |

Shared vocabulary lives in `berega-api/src/constants/property-options.ts`: `PropertyTypes` (17
values), `DealTypes` (`sale`/`rent`/`investment`), `StatusTypes` (`active`, `pending`, `draft`,
`sold`, `booked`, `reserved`, `archived`, `deleted`, `under_moderation`, `completed`), plus room,
bathroom, renovation and building-type enums. New-build units use the `active`/`sold`/`booked`
subset — that is the value bookings mutate.

---

## 6. Development sales — CRM-owned, on Platform DB

These four exist only in `bz26-api-crm` but are written to the Platform DB, alongside berega's
collections. This is the least obvious part of the topology.

| Entity | Collection | What it is | Refs out |
|---|---|---|---|
| **DevelopmentBooking** (бронь) | `developmentbookings` | Temporary hold on a unit that a developer confirms, rejects or marks paid. Flips unit status and `reservedUntil`. | `complex` → `estates`, `building`, `unit` → `estatenewconstructionsapartments`, `realtor` → `users` |
| **DevelopmentSalesClient** | `development-sales-clients` | A client fixed to a realtor at a complex until `reservedUntil` (закрепление клиента). Phone stored twice, raw and normalized, for dedupe. | `complex`, `realtor` |
| **DevelopmentSalesPlan** | `development-sales-plans` | Sales/revenue target for a manager over a period. `complex` null means all complexes. | `owner`, `complex`; `positionId` → CRM `team_positions` (cross-DB) |
| **DevelopmentMarketingStat** | `development-marketing` | Per-source snapshot: leads, bookings, spend. Feeds CPL. | `owner`, `complex` |

Booking status: `pending` → `booked` → `paid`, or `rejected` / `expired`.

---

## 7. Monetization, promotion & finance (Platform DB)

| Entity | Collection | What it is | Refs out |
|---|---|---|---|
| **Promotion** | `promotions` | Paid promotion bought for a complex. Unique per `{complexId, serviceId}`; **TTL on `expiresAt`** auto-deletes it, which is why `estates` caches promo fields. | `complexId` → `estates`, `author` |
| **Promocode** | `promocodes` | Redeemable credit code, uppercase and unique. | — |
| **PromocodeRedemption** | `promocoderedemptions` | One redemption; unique per `{userId, code}`. | `userId` |
| **PaymentRequest** | `paymentrequests` | Top-up request: `pending` → `approved`/`rejected`/`completed`. | `userId` |
| **FinanceOperation** | `financeoperations` | Ledger line. Points at its subject via **soft** `refType` + `refId` strings, not ObjectId refs. | `userId` |
| **FinanceDocument** | `financedocuments` | Invoice, receipt, voucher, act or refund with a download URL. | `userId` |

---

## 8. Portal user workspace (Platform DB)

The public portal's personal cabinet. Documented in `berega-api/docs/workspace2-data-api-reference.md`.

| Entity | Collection | What it is | Refs out |
|---|---|---|---|
| **Chat** | `chats` | Portal conversation thread, categorized `object`/`listing`/`support`/`ai`/`security`. Unrelated to the ERP messenger. | `ownerId`; embedded `entityRef` `{id, type}` (string) |
| **ChatMessage** | `chatmessages` | Message with role `user`/`agent`/`system`/`counterparty`. | `chatId` |
| **UserInterest** | `userinterests` | Saved search with filters and notification toggle. | `userId` |
| **RecentView** | `recentviews` | Recently viewed object; `entityId` is a **string**, so it spans collections. | `userId` |
| **EntityChange** | `entitychanges` | Change feed on watched objects: `price_down`, `booked`, `sold`, `promo`, … | `userId` |
| **UserRecommendation** | `userrecommendations` | Precomputed recommendation tiles with embedded snapshots. | `userId` (unique) |
| **Compare** | `compares` | Comparison set; `list[]` is string ids. | `author` |
| **Catalog** | `catalogs` | Named object catalog, exportable to PDF. | `author` |
| **Pdf** | `pdfs` | Generated PDF for a catalog/estate/building/apartment. | `author`, `catalog`; soft `entityId` + `type` |
| **UnitShareLink** | `unitsharelinks` | Tokenized public link to one unit, with customization, view counter and revocation. | none — `unitId`/`ownerId` are strings |

---

## 9. Community — two separate systems

Community exists **twice** and the two are unrelated. The ERP forum is the newer one.

### ERP forum (CRM DB) — `bz26-api-crm/src/modules/community/`

| Entity | Collection | What it is | Links |
|---|---|---|---|
| **CommunitySection** | `communitysections` | Container: `feed`, `category`, `exchange`, `showcase`, `events`. `_id` is a **string**. | — |
| **CommunityThread** | `communitythreads` | Post: discussion, question, announcement, exchange or showcase. Embeds `exchange` metadata when it is a deal-board entry. | `sectionId` (string), `authorId` (**string** user id), `bestReplyId` |
| **CommunityReply** | `communityreplies` | Answer; can be marked best on the thread. | `threadId`, `authorId` (string) |
| **CommunityReaction** | `communityreactions` | One like. Unique per `{memberId, targetType, targetId}`. | `memberId`, polymorphic `targetId` |
| **CommunityMember** | `communitymembers` | Community identity with segment, role, trust metrics, badges. `_id` is the user id string. | `userId` → `users`, `crmContactId` |
| **CommunityEvent** | `communityevents` | Event, `online`/`offline`, with capacity. | — |
| **CommunityEventRegistration** | `communityeventregistrations` | Attendance. Unique per `{eventId, memberId}`. | `eventId`, `memberId` |

Exchange `intent`: `rent_seek`, `buy_seek`, `partner_seek`, `client_handover`, `rent_offer`,
`sale_offer`, `service_offer`; `side`: `demand`/`supply`; `status`: `open`/`in_work`/`closed`.

**Migration hazard:** community `authorId` and `memberId` are plain strings, not ObjectId refs, so
they are invisible to any ref-based tooling.

### Platform Q&A and voting (Platform DB)

| Entity | Collection | What it is | Refs out |
|---|---|---|---|
| **Vote** | `votes` | 0–5 rating with comment. `target` is **polymorphic and ref-less**: resolved by `type` to `users` (realtors), `developers` or `estates` (complexes). | `author`; `target` |
| **Comment** | `comments` | Threaded comment on a vote or question. | `author`, `voteId`, `questionId`, `targetCommentId` → self |
| **Question** | `quiestion` | Q&A question. Collection name is a **typo** and is load-bearing in production. | `author` |
| **Dialog** | `dialogs` | Admin↔user message thread with read flags. Unrelated to messenger dialogs. | `author`; `threadId` → self |

---

## 10. LMS (CRM DB)

| Entity | Collection | What it is | Links |
|---|---|---|---|
| **LmsItem** | `lmsitems` | One learning unit: article, video, script, quiz, presentation or PDF, targeted at a role. Soft-deleted via `status`. | — |
| **LmsCourse** | `lmscourses` | Ordered `itemIds[]` plus an optional final quiz. Ids are **strings**, no refs. | `itemIds[]` → `lmsitems` |
| **LmsProgress** | `lmsprogress` | Completion per user per course. Unique on `{userId, courseId}`. | `userId`, `courseId` — both ref-less |

---

## 11. Content, stats & reference data (Platform DB)

| Entity | Collection | What it is |
|---|---|---|
| **Article** | `articles` | Editorial article with up to 5 images. |
| **Journal** | `journals` | Long-form post with SEO fields, category, city and language (`ru`/`en`/`ka`). Unique slug. |
| **News** | `news` | Short news item. |
| **Request** | `requests` | Public inbound request from the portal (property type, contacts, status). |
| **Support** | `supports` | Public support ticket; soft `estateId` + `estateType`. |
| **Lead** (platform) | `leads` | ⚠️ A **trivial** lead-capture record — only `data`, `source`, `status`. Not the CRM lead; see §12. |
| **StatApartmentOpen / Favorite / Share** | `statapartmentopens`, `statapartmentfavorites`, `statapartmentshares` | Per-event counters on `estateapartments`. |
| **StatNewbuildsOpen** | `statnewbuildsopens` | New-build view event → `estate` (+ optional apartment). |
| **StatSearch** | `statsearches` | Raw search query log. |
| **Country / City** | `countries`, `cities` | Geo reference with unique codes and 2dsphere coords. |
| **Street** | `streets` | Street reference. **Orphan** — never registered. |
| **Tag / FormOption / I18n / Rate** | `tags`, `formoptions`, `i18ns`, `rates` | Lookup tables: tag vocabulary, form dropdowns, UI translations (6 languages), FX rates. |

---

## 12. Naming collisions — read before writing queries

Four names mean different things depending on database. Each has burned someone.

| Name | Meaning A | Meaning B |
|---|---|---|
| `users` | Platform DB: full portal profile, `refererId`, balance, MLS fields | CRM DB: slim auth record (name, email, role, `isOwner`). Same `_id` for the same human, different documents |
| `leads` | **CRM DB: the real CRM lead** — stages, funnels, history, 30+ fields | **Platform DB: a 5-field web-form capture** (`data`, `source`, `status`). Unrelated |
| `Dialog` | Platform `dialogs`: admin↔user thread | Messenger service: a client conversation on Telegram/WhatsApp. Also unrelated to portal `chats` |
| community | CRM DB `community*`: the ERP forum | Platform `votes`/`comments`/`quiestion`: portal Q&A and ratings |

Other traps:

- **`quiestion`** — the collection is misspelled in production. `comments.questionId` points at it.
- **`unitsharelinks`** — one collection, **two independent implementations** (berega
  `src/shemas/unit-share-link.schema.ts` and CRM `src/modules/share-links/schemas/`). Schema changes
  must land in both.
- **`promotions` has a TTL** on `expiresAt`, so promo documents vanish. `estates` keeps a
  denormalized copy (`paramMark`, `paramOverlayText`, `paramSections`, `paramExpiresAt`).
- **Orphan schemas** with indexes but no registration: `EstateApartmentRent`, `Street` (berega),
  `CalendarSyncConfig` (CRM).
- **New-build and secondary units are different collections** —
  `estatenewconstructionsapartments` vs `estateapartments`. Nothing joins them.

---

## 13. Client-side entities with no persistence

These are real concepts in the ERP UI but have **no collection in either database** — no `deals`,
`clients`, `selections`, `partners` or `mailings` schema exists anywhere. They live in mocks,
Zustand stores or `localStorage`, so on the interaction map they belong in a separate
"frontend-only" band.

| Entity | Where it lives in the client | What it would need |
|---|---|---|
| **Deal** (сделка) | `src/types/deals.ts` — stages `showing` → `deposit` → `deal` → `golden` → `check_in` | A `deals` collection; currently the pipeline after a won lead is untracked server-side |
| **Client** (клиент) | `src/types/clients.ts` — segments `active`/`golden`/`deferred`/`archived` | Partially covered by `leads.folder` (`golden_fund`, `deferred_demand`) and `development-sales-clients` |
| **Selection / DevSelection** (подборка) | `src/types/selections.ts`, `src/types/dev-selection.ts`, `useDevSelectionsStore` | Closest real thing is `unitsharelinks` (single unit only) |
| **Partner** (referral and MLM) | `src/types/partners.ts`, `src/types/dashboard.ts` | Only `users.refererId` and `referalCode` exist |
| **Mailing** | `src/types/mailings.ts` | — |
| **Reminder** (ERP-side) | `src/data/info-mock.ts` | Overlaps CRM `notifications` |
| **NewsArticle** | `src/services/newsApiV2.ts` | Platform `news` module since 15.09.2026: BAZA news from admin, company news from ERP settings |
| **Property** (agency base) | `src/components/management/my-properties/types.ts` | Maps onto platform `estateapartments` |
| **ManagerPlan** | `src/services/plansApiV2.ts` | Platform `plans` module since 15.09.2026 (monthly plan per position) |

The messenger entities (`Account`, `Dialog`, `Message`, `ClientDossier`, `AiHistoryEntry`) are real
but live in a **third** backend, `api-msngrs.baza.sale`, whose repo is not in this workspace. The
CRM link is `Dialog.crmLeadId` → `leads._id`.

---

## 14. Where to look next

| Question | Authoritative source |
|---|---|
| CRM collection names + full FK inventory | `bz26-api-crm/docs/user-id-remap-impact.md` |
| Lead fields, filters, product types | `bz26-api-crm/docs/crm-leads-api.md`, `docs/crm-funnel-api.md` |
| Booking side effects on unit status | `bz26-api-crm/docs/booking-api-implementation.md` |
| Platform estate graph | `bz26-api-crm/docs/api-estate-full.md`, `berega-api/docs/estate-aggregation-system.md` |
| Floor plans & installments | `berega-api/docs/floor-plans-and-installments.md` |
| Portal cabinet collections | `berega-api/docs/workspace2-data-api-reference.md` |
| LMS schema | `bz26-api-crm/docs/lms-backend-spec-v2.md` |
| Community API | `bz26-api-crm/docs/api-community-specs.md` |
| Client real-vs-mock status per module | `docs/project-overview-and-improvements.md` |

## Next step: interaction map

Build on this list. The flows worth drawing, in rough order of value:

1. **Lead lifecycle** per funnel, including where it leaves the funnel into a `folder`, and the
   drop-off into frontend-only Deal/Client.
2. **Estate → Building → Unit → Booking** and the status side effects
   (`developmentbookings.status` → unit `status` + `reservedUntil` → `estateaggregations`).
3. **The three cross-DB seams** from §1 — these are the fragile joins.
4. **Analytics feeds**: which collections back the developer, manager and city dashboards, and
   which numbers are computed vs seeded.
5. **Identity**: platform user ↔ CRM user ↔ `team_positions.occupantUserId` ↔
   `communitymembers._id`.
