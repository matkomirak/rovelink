# Replit task: stop provider sync from importing into CMDB

## What is happening now
When a provider sync is started, the backend currently imports provider data directly into the CMDB/NetBox inside the provider sync worker.

### Evidence in the code
- `server/routes.ts`
  - `POST /api/providers/:id/sync` calls `runProviderSyncWithWorker(provider.id)`
- `server/services/syncWorker.ts`
  - `executeSyncRun()` does:
    1. connect to provider
    2. collect provider VMs
    3. **Phase 3: NetBox Import**
  - It resolves a NetBox CMDB account, creates `NetBoxAdapter`, tests NetBox connectivity, and then:
    - for Azure: uses `AzureNetBoxSyncService.importAll(discovery)`
    - for standard providers: calls `netbox.upsertVm(...)`

### Important clarification
Creating or updating a provider does **not** automatically trigger CMDB import by itself.
- `POST /api/providers` only creates the provider.
- `PATCH /api/providers/:id` only updates the provider.
- The CMDB import starts when provider sync is run via `POST /api/providers/:id/sync`.

## Goal
Change provider sync so it only imports/caches provider data inside the LegacyProject app.

After this change:
- Provider sync must **not** write anything into NetBox or any CMDB.
- Provider sync should only:
  - validate provider connection
  - collect provider inventory
  - persist/cache provider objects in LegacyProject-owned tables
  - record sync run logs and counts
- CMDB writes must happen **only** through pipelines (`/api/pipelines/:id/sync`), which already exist and are working.

## Required implementation

### 1) Remove CMDB/NetBox write behavior from provider sync worker
Update `server/services/syncWorker.ts`.

#### Current behavior to remove from provider sync
Remove or bypass all logic in `executeSyncRun()` that:
- loads NetBox CMDB account config
- creates `NetBoxAdapter`
- tests NetBox connectivity
- uses `AzureNetBoxSyncService`
- calls `netbox.upsertVm(...)`
- syncs IPs into NetBox
- writes any provider sync data into NetBox/CMDB

#### Replace with LegacyProject-only caching behavior
Provider sync should instead:
- collect provider inventory from the collector
- upsert provider objects into LegacyProject storage only
- continue updating `external_objects` with cached provider payloads
- optionally store normalized summary fields in `cachedPayload`
- keep sync run history/logs/counts working
- keep removed-object detection limited to LegacyProject-side tracking only

### 2) Keep `external_objects` as the provider-side cache
Use `external_objects` as the canonical cache for provider-synced inventory.

For each discovered provider object/VM, upsert:
- `providerAccountId`
- `providerKind`
- `externalId`
- `cachedPayload`
- `lastSyncedAt`

Do **not** require a CMDB record to exist.

If needed, make `netboxType` / `netboxId` nullable-safe in the write path, and do not populate them during provider sync.

### 3) Provider sync logs must reflect new behavior
Update sync logs so they no longer say:
- `Phase 3: NetBox Import`
- `Importing X VMs into NetBox`
- `NetBox connected`

Replace with wording like:
- `Phase 3: LegacyProject Cache Update`
- `Caching X provider objects in LegacyProject`
- `Provider sync completed without CMDB write`

### 4) Azure provider sync must also stop writing to NetBox
In `server/services/syncWorker.ts`, the Azure path currently uses `AzureNetBoxSyncService.importAll(...)`.
That must be removed from provider sync.

Instead, Azure provider sync should cache Azure discovery results in LegacyProject only.
No VNets, NICs, Public IPs, Prefixes, or VMs should be created/updated in NetBox during provider sync.

### 5) Pipelines remain the only CMDB sync path
Do **not** remove or weaken pipeline sync behavior.

`server/routes/pipelines.ts` should remain the place that performs real CMDB writes:
- provider collector reads source inventory
- mapping rules transform objects
- CMDB adapter writes to NetBox/i-doit

This becomes the single supported path for CMDB sync.

### 6) Optional but recommended: make the architecture explicit in code/comments
Add comments and/or naming that clearly separate:
- **Provider sync** = collect/cache source inventory into LegacyProject
- **Pipeline sync** = move approved/transformed source data into CMDB

If there is UI text that implies provider sync imports to CMDB, update it so the user understands:
- provider sync refreshes LegacyProject’s source inventory
- pipeline sync pushes data into the selected CMDB

## Acceptance criteria
1. Running `POST /api/providers/:id/sync` does **not** create or update any objects in NetBox or any CMDB.
2. Running provider sync still:
   - tests provider access
   - collects inventory
   - stores/upserts provider data in LegacyProject cache/storage
   - creates sync run logs/counts
3. Existing pipelines still work and are the only way to write provider data into CMDB.
4. Azure provider sync no longer writes anything into NetBox during provider sync.
5. Sync run logs clearly show cache-only behavior, not CMDB import.
6. No provider create/update action triggers CMDB import.

## Suggested implementation notes
- Keep the public API shape for provider sync unchanged if possible.
- Minimize schema changes unless absolutely necessary.
- Prefer a narrow refactor inside `server/services/syncWorker.ts`.
- If the current `external_objects` schema assumes NetBox IDs always exist, relax only what is necessary so provider cache entries can exist without CMDB linkage.

## Files to inspect/change
- `server/services/syncWorker.ts`  **(main change)**
- `server/routes.ts`  **(confirm provider sync route semantics only)**
- `server/routes/pipelines.ts`  **(leave CMDB sync behavior intact)**
- `shared/schema.ts`  **(only if nullability/storage needs small adjustment)**
- any provider sync UI copy in:
  - `client/src/pages/providers.tsx`
  - `client/src/pages/provider-detail.tsx`

## Deliverable expected from Replit
Please implement the refactor and provide:
1. a summary of code changes
2. any schema change made
3. confirmation that provider sync is now LegacyProject-only
4. confirmation that pipeline sync still writes to CMDB
5. a short manual test plan with exact endpoints used
