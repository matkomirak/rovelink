// Database storage implementation (from javascript_database blueprint)
import { 
  users, projects, credentials, jobTemplates, jobRuns, settings, notifications,
  providerAccounts, syncRuns, externalObjects, groupCache, netboxVms, netboxInventorySources,
  cmdbAccounts, pipelines, pipelineMappings, pipelineRuns, organizations,
  governanceBlueprints, governanceBlueprintVersions, governanceEvaluationRuns, governanceObjectEvaluations,
  customerScopes, customerScopeObjectAssignments,
  type User, type InsertUser,
  type Organization,
  type Project, type InsertProject,
  type Credential, type InsertCredential,
  type JobTemplate, type InsertJobTemplate,
  type JobRun, type InsertJobRun,
  type Setting, type InsertSetting,
  type Notification, type InsertNotification,
  type ProviderAccount, type InsertProviderAccount,
  type SyncRun, type InsertSyncRun,
  type ExternalObject, type InsertExternalObject,
  type GroupCache, type InsertGroupCache,
  type NetboxVm, type InsertNetboxVm,
  type NetboxInventorySource, type InsertNetboxInventorySource,
  type CmdbAccount, type InsertCmdbAccount,
  type Pipeline, type InsertPipeline,
  type PipelineMapping, type InsertPipelineMapping,
  type PipelineRun, type InsertPipelineRun,
  type GovernanceBlueprint, type InsertGovernanceBlueprint,
  type GovernanceBlueprintVersion, type InsertGovernanceBlueprintVersion,
  type GovernanceEvaluationRun, type InsertGovernanceEvaluationRun,
  type GovernanceObjectEvaluation, type InsertGovernanceObjectEvaluation,
  type CustomerScope, type InsertCustomerScope,
  type CustomerScopeObjectAssignment, type InsertCustomerScopeObjectAssignment,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, lte, and, lt, sql, inArray, isNull } from "drizzle-orm";

export interface IStorage {
  // Organization lookup (cross-tenant safe — used for existence checks in user creation)
  getOrganization(id: string): Promise<Organization | undefined>;

  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Project operations — orgId REQUIRED (tenant-owned)
  getProjects(orgId: string): Promise<Project[]>;
  getProject(id: string, orgId: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<Project>, orgId: string): Promise<Project | undefined>;
  deleteProject(id: string, orgId: string): Promise<void>;

  // Credential operations — orgId REQUIRED (tenant-owned)
  getCredentials(orgId: string): Promise<Credential[]>;
  getCredential(id: string, orgId: string): Promise<Credential | undefined>;
  createCredential(credential: InsertCredential): Promise<Credential>;
  updateCredential(id: string, data: Partial<Credential>, orgId: string): Promise<Credential | undefined>;
  deleteCredential(id: string, orgId: string): Promise<void>;

  // Job Template operations — orgId REQUIRED (tenant-owned)
  getJobTemplates(orgId: string): Promise<JobTemplate[]>;
  getJobTemplate(id: string, orgId: string): Promise<JobTemplate | undefined>;
  createJobTemplate(template: InsertJobTemplate): Promise<JobTemplate>;
  updateJobTemplate(id: string, data: Partial<JobTemplate>, orgId: string): Promise<JobTemplate | undefined>;
  deleteJobTemplate(id: string, orgId: string): Promise<void>;

  // Job Run operations — orgId REQUIRED (tenant-owned)
  getJobRuns(filters: any, page: number, pageSize: number, orgId: string): Promise<JobRun[]>;
  getJobRun(id: string, orgId: string): Promise<JobRun | undefined>;
  createJobRun(run: InsertJobRun): Promise<JobRun>;
  updateJobRun(id: string, data: Partial<JobRun>, orgId: string): Promise<JobRun | undefined>;

  // Settings operations
  getSetting(key: string): Promise<Setting | undefined>;
  setSetting(key: string, value: string): Promise<Setting>;
  getAllSettings(): Promise<Setting[]>;

  // Notification operations — orgId REQUIRED (tenant-owned)
  getNotifications(orgId: string): Promise<Notification[]>;
  getNotification(id: string, orgId: string): Promise<Notification | undefined>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  updateNotification(id: string, data: Partial<Notification>, orgId: string): Promise<Notification | undefined>;
  deleteNotification(id: string, orgId: string): Promise<void>;

  // Provider operations — orgId REQUIRED (tenant-owned)
  getProviders(orgId: string): Promise<ProviderAccount[]>;
  getProvider(id: string, orgId: string): Promise<ProviderAccount | undefined>;
  createProvider(provider: InsertProviderAccount): Promise<ProviderAccount>;
  updateProvider(id: string, data: Partial<ProviderAccount>, orgId: string): Promise<ProviderAccount | undefined>;
  deleteProvider(id: string, orgId: string): Promise<void>;
  /** Internal use only — route handlers must not call this. */
  getProvidersUnsafe(): Promise<ProviderAccount[]>;

  // Sync Run operations
  createSyncRun(run: InsertSyncRun): Promise<SyncRun>;
  getSyncRun(id: string, orgId: string): Promise<SyncRun | undefined>;
  updateSyncRun(id: string, data: Partial<SyncRun>): Promise<SyncRun | undefined>;
  getProviderRuns(providerAccountId: string, limit: number, orgId: string): Promise<SyncRun[]>;
  getLastFailedSyncRuns(orgId: string): Promise<SyncRun[]>;

  // Housekeeping operations
  clearGroupCache(): Promise<void>;
  addGroupCache(item: { kind: string; name: string }): Promise<GroupCache>;
  pruneStaleObjects(days: number): Promise<number>;
  getProviderStats(orgId: string): Promise<any[]>;

  // NetBox VM operations — orgId REQUIRED on org-scoped read
  getNetboxVms(orgId: string): Promise<NetboxVm[]>;
  /** Internal use only — route handlers must not call this. */
  getNetboxVmsUnsafe(): Promise<NetboxVm[]>;
  getNetboxVm(id: string): Promise<NetboxVm | undefined>;
  upsertNetboxVm(vm: InsertNetboxVm): Promise<NetboxVm>;
  updateNetboxVm(id: string, updates: Partial<NetboxVm>): Promise<NetboxVm | null>;
  deleteAllNetboxVms(): Promise<void>;

  // NetBox Inventory Source operations — orgId REQUIRED (tenant-owned)
  getNetboxInventorySources(orgId: string): Promise<NetboxInventorySource[]>;
  getNetboxInventorySource(id: string, orgId: string): Promise<NetboxInventorySource | undefined>;
  createNetboxInventorySource(source: InsertNetboxInventorySource): Promise<NetboxInventorySource>;
  updateNetboxInventorySource(id: string, data: Partial<NetboxInventorySource>, orgId: string): Promise<NetboxInventorySource | undefined>;
  deleteNetboxInventorySource(id: string, orgId: string): Promise<void>;

  // CMDB operations — orgId REQUIRED (tenant-owned)
  getCmdbAccounts(orgId: string): Promise<CmdbAccount[]>;
  getCmdbAccount(id: string, orgId: string): Promise<CmdbAccount | undefined>;
  createCmdbAccount(account: InsertCmdbAccount): Promise<CmdbAccount>;
  updateCmdbAccount(id: string, data: Partial<CmdbAccount>, orgId: string): Promise<CmdbAccount | undefined>;
  deleteCmdbAccount(id: string, orgId: string): Promise<void>;

  // Pipeline operations — orgId REQUIRED (tenant-owned)
  getPipelines(orgId: string): Promise<Pipeline[]>;
  getPipeline(id: string, orgId: string): Promise<Pipeline | undefined>;
  createPipeline(pipeline: InsertPipeline): Promise<Pipeline>;
  updatePipeline(id: string, data: Partial<Pipeline>, orgId: string): Promise<Pipeline | undefined>;
  deletePipeline(id: string, orgId: string): Promise<void>;
  incrementPipelineVersion(id: string): Promise<void>;

  // Pipeline Mapping operations
  getPipelineMappings(pipelineId: string): Promise<PipelineMapping[]>;
  getPipelineMapping(id: string): Promise<PipelineMapping | undefined>;
  createPipelineMapping(mapping: InsertPipelineMapping): Promise<PipelineMapping>;
  updatePipelineMapping(id: string, data: Partial<PipelineMapping>): Promise<PipelineMapping | undefined>;
  deletePipelineMapping(id: string): Promise<void>;

  // Pipeline Run operations — orgId REQUIRED on org-scoped reads
  getPipelineRuns(pipelineId: string, limit?: number): Promise<PipelineRun[]>;
  getAllPipelineRuns(limit: number, orgId: string): Promise<PipelineRun[]>;
  getPipelineRun(id: string, orgId: string): Promise<PipelineRun | undefined>;
  createPipelineRun(run: InsertPipelineRun): Promise<PipelineRun>;
  updatePipelineRun(id: string, data: Partial<PipelineRun>): Promise<PipelineRun | undefined>;

  // Sync Run (unified) operations
  getAllSyncRuns(limit: number, orgId: string): Promise<SyncRun[]>;

  // Governance Blueprint operations - orgId REQUIRED (tenant-owned)
  createGovernanceBlueprint(blueprint: InsertGovernanceBlueprint): Promise<GovernanceBlueprint>;
  listGovernanceBlueprints(orgId: string): Promise<GovernanceBlueprint[]>;
  getGovernanceBlueprint(id: string, orgId: string): Promise<GovernanceBlueprint | undefined>;
  updateGovernanceBlueprint(id: string, data: Partial<GovernanceBlueprint>, orgId: string): Promise<GovernanceBlueprint | undefined>;
  createGovernanceBlueprintVersion(version: InsertGovernanceBlueprintVersion): Promise<GovernanceBlueprintVersion>;
  getGovernanceBlueprintVersion(id: string, orgId: string): Promise<GovernanceBlueprintVersion | undefined>;
  listGovernanceBlueprintVersions(blueprintId: string, orgId: string): Promise<GovernanceBlueprintVersion[]>;
  activateGovernanceBlueprintVersion(blueprintId: string, versionId: string, orgId: string): Promise<GovernanceBlueprint | undefined>;
  getActiveGovernanceBlueprintForObjectType(objectType: string, orgId: string): Promise<{ blueprint: GovernanceBlueprint; version: GovernanceBlueprintVersion } | undefined>;
  createGovernanceEvaluationRun(run: InsertGovernanceEvaluationRun): Promise<GovernanceEvaluationRun>;
  storeGovernanceObjectEvaluation(evaluation: InsertGovernanceObjectEvaluation): Promise<GovernanceObjectEvaluation>;
  listGovernanceEvaluationRuns(orgId: string, limit?: number): Promise<GovernanceEvaluationRun[]>;
  getGovernanceEvaluationRun(id: string, orgId: string): Promise<GovernanceEvaluationRun | undefined>;
  listGovernanceObjectEvaluations(runId: string, orgId: string): Promise<GovernanceObjectEvaluation[]>;
  getLatestGovernanceEvaluationForObject(
    orgId: string,
    objectType: string,
    objectId: string
  ): Promise<{ evaluation: GovernanceObjectEvaluation; run: GovernanceEvaluationRun | null } | undefined>;

  // CustomerScope operations — orgId REQUIRED (tenant-owned, CMDB-source-scoped)
  createCustomerScope(scope: InsertCustomerScope): Promise<CustomerScope>;
  upsertCustomerScope(scope: InsertCustomerScope): Promise<CustomerScope>;
  listCustomerScopes(orgId: string, sourceType?: string, sourceId?: string): Promise<CustomerScope[]>;
  getCustomerScope(id: string, orgId: string): Promise<CustomerScope | undefined>;
  getCustomerScopeByExternalId(orgId: string, sourceType: string, sourceId: string, externalId: string): Promise<CustomerScope | undefined>;
  createCustomerScopeObjectAssignment(assignment: InsertCustomerScopeObjectAssignment): Promise<CustomerScopeObjectAssignment>;
  upsertCustomerScopeObjectAssignment(assignment: InsertCustomerScopeObjectAssignment): Promise<CustomerScopeObjectAssignment>;
  listCustomerScopeObjectAssignments(orgId: string, sourceType?: string, sourceId?: string): Promise<CustomerScopeObjectAssignment[]>;
  listAssignmentsForObject(orgId: string, sourceType: string, sourceId: string, objectType: string, objectId: string): Promise<CustomerScopeObjectAssignment[]>;
  listAssignmentsForCustomerScope(orgId: string, customerScopeId: string): Promise<CustomerScopeObjectAssignment[]>;
}

export class DatabaseStorage implements IStorage {
  // Organization lookup
  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org ?? undefined;
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Project operations
  async getProjects(orgId: string): Promise<Project[]> {
    return await db.select().from(projects).where(eq(projects.orgId, orgId)).orderBy(desc(projects.createdAt));
  }

  async getProject(id: string, orgId: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.orgId, orgId)));
    return project || undefined;
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db
      .insert(projects)
      .values(insertProject)
      .returning();
    return project;
  }

  async updateProject(id: string, data: Partial<Project>, orgId: string): Promise<Project | undefined> {
    const [updated] = await db.update(projects).set(data).where(and(eq(projects.id, id), eq(projects.orgId, orgId))).returning();
    return updated || undefined;
  }

  async deleteProject(id: string, orgId: string): Promise<void> {
    await db.delete(projects).where(and(eq(projects.id, id), eq(projects.orgId, orgId)));
  }

  // Credential operations
  async getCredentials(orgId: string): Promise<Credential[]> {
    return await db.select().from(credentials).where(eq(credentials.orgId, orgId)).orderBy(desc(credentials.createdAt));
  }

  async getCredential(id: string, orgId: string): Promise<Credential | undefined> {
    const [credential] = await db.select().from(credentials).where(and(eq(credentials.id, id), eq(credentials.orgId, orgId)));
    return credential || undefined;
  }

  async createCredential(insertCredential: InsertCredential): Promise<Credential> {
    const [credential] = await db
      .insert(credentials)
      .values(insertCredential)
      .returning();
    return credential;
  }

  async updateCredential(id: string, data: Partial<Credential>, orgId: string): Promise<Credential | undefined> {
    const [updated] = await db.update(credentials).set({ ...data, updatedAt: new Date() }).where(and(eq(credentials.id, id), eq(credentials.orgId, orgId))).returning();
    return updated || undefined;
  }

  async deleteCredential(id: string, orgId: string): Promise<void> {
    await db.delete(credentials).where(and(eq(credentials.id, id), eq(credentials.orgId, orgId)));
  }

  // Job Template operations
  async getJobTemplates(orgId: string): Promise<JobTemplate[]> {
    return await db.select().from(jobTemplates).where(eq(jobTemplates.orgId, orgId)).orderBy(desc(jobTemplates.createdAt));
  }

  async getJobTemplate(id: string, orgId: string): Promise<JobTemplate | undefined> {
    const [template] = await db.select().from(jobTemplates).where(and(eq(jobTemplates.id, id), eq(jobTemplates.orgId, orgId)));
    return template || undefined;
  }

  async createJobTemplate(insertTemplate: InsertJobTemplate): Promise<JobTemplate> {
    const [template] = await db
      .insert(jobTemplates)
      .values(insertTemplate)
      .returning();
    return template;
  }

  async updateJobTemplate(id: string, data: Partial<JobTemplate>, orgId: string): Promise<JobTemplate | undefined> {
    const [updated] = await db.update(jobTemplates).set(data).where(and(eq(jobTemplates.id, id), eq(jobTemplates.orgId, orgId))).returning();
    return updated || undefined;
  }

  async deleteJobTemplate(id: string, orgId: string): Promise<void> {
    await db.delete(jobTemplates).where(and(eq(jobTemplates.id, id), eq(jobTemplates.orgId, orgId)));
  }

  // Job Run operations
  async getJobRuns(filters: any = {}, page: number = 1, pageSize: number = 50, orgId: string): Promise<JobRun[]> {
    let query = db.select().from(jobRuns).where(eq(jobRuns.orgId, orgId)) as any;
    if (filters.status) {
      query = query.where(eq(jobRuns.status, filters.status)) as any;
    }
    if (filters.archived !== undefined) {
      query = query.where(eq(jobRuns.archived, filters.archived)) as any;
    }
    if (filters.startDate) {
      query = query.where(gte(jobRuns.createdAt, filters.startDate)) as any;
    }
    if (filters.endDate) {
      query = query.where(lte(jobRuns.createdAt, filters.endDate)) as any;
    }
    
    const offset = (page - 1) * pageSize;
    return await query.orderBy(desc(jobRuns.createdAt)).limit(pageSize).offset(offset);
  }

  async getJobRun(id: string, orgId: string): Promise<JobRun | undefined> {
    const [run] = await db.select().from(jobRuns).where(and(eq(jobRuns.id, id), eq(jobRuns.orgId, orgId)));
    return run || undefined;
  }

  async createJobRun(insertRun: InsertJobRun): Promise<JobRun> {
    const [run] = await db
      .insert(jobRuns)
      .values(insertRun)
      .returning();
    return run;
  }

  async updateJobRun(id: string, data: Partial<JobRun>, orgId: string): Promise<JobRun | undefined> {
    const [updated] = await db
      .update(jobRuns)
      .set(data)
      .where(and(eq(jobRuns.id, id), eq(jobRuns.orgId, orgId)))
      .returning();
    return updated || undefined;
  }

  // Settings operations
  async getSetting(key: string): Promise<Setting | undefined> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key));
    return setting || undefined;
  }

  async setSetting(key: string, value: string): Promise<Setting> {
    const existing = await this.getSetting(key);
    if (existing) {
      const [updated] = await db
        .update(settings)
        .set({ value, updatedAt: new Date() })
        .where(eq(settings.key, key))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(settings)
        .values({ key, value })
        .returning();
      return created;
    }
  }

  async getAllSettings(): Promise<Setting[]> {
    return await db.select().from(settings);
  }

  // Notification operations
  async getNotifications(orgId: string): Promise<Notification[]> {
    return await db.select().from(notifications).where(eq(notifications.orgId, orgId)).orderBy(desc(notifications.createdAt));
  }

  async getNotification(id: string, orgId: string): Promise<Notification | undefined> {
    const [notification] = await db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.orgId, orgId)));
    return notification || undefined;
  }

  async createNotification(insertNotification: InsertNotification): Promise<Notification> {
    const [notification] = await db
      .insert(notifications)
      .values(insertNotification)
      .returning();
    return notification;
  }

  async updateNotification(id: string, data: Partial<Notification>, orgId: string): Promise<Notification | undefined> {
    const [updated] = await db
      .update(notifications)
      .set(data)
      .where(and(eq(notifications.id, id), eq(notifications.orgId, orgId)))
      .returning();
    return updated || undefined;
  }

  async deleteNotification(id: string, orgId: string): Promise<void> {
    await db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.orgId, orgId)));
  }

  // Provider operations
  async getProviders(orgId: string): Promise<ProviderAccount[]> {
    return await db.select().from(providerAccounts).where(eq(providerAccounts.orgId, orgId)).orderBy(desc(providerAccounts.createdAt));
  }

  /** Internal use only — route handlers must not call this. */
  async getProvidersUnsafe(): Promise<ProviderAccount[]> {
    return await db.select().from(providerAccounts).orderBy(desc(providerAccounts.createdAt));
  }

  async getProvider(id: string, orgId: string): Promise<ProviderAccount | undefined> {
    const [provider] = await db.select().from(providerAccounts).where(and(eq(providerAccounts.id, id), eq(providerAccounts.orgId, orgId)));
    return provider || undefined;
  }

  async createProvider(insertProvider: InsertProviderAccount): Promise<ProviderAccount> {
    const [provider] = await db
      .insert(providerAccounts)
      .values({
        ...insertProvider,
        updatedAt: new Date(),
      })
      .returning();
    return provider;
  }

  async updateProvider(id: string, data: Partial<ProviderAccount>, orgId: string): Promise<ProviderAccount | undefined> {
    const [updated] = await db.update(providerAccounts).set({ ...data, updatedAt: new Date() }).where(and(eq(providerAccounts.id, id), eq(providerAccounts.orgId, orgId))).returning();
    return updated || undefined;
  }

  async deleteProvider(id: string, orgId: string): Promise<void> {
    await db.delete(providerAccounts).where(and(eq(providerAccounts.id, id), eq(providerAccounts.orgId, orgId)));
  }

  // Sync Run operations
  async createSyncRun(insertRun: InsertSyncRun): Promise<SyncRun> {
    const [run] = await db
      .insert(syncRuns)
      .values(insertRun)
      .returning();
    return run;
  }

  async getSyncRun(id: string, orgId: string): Promise<SyncRun | undefined> {
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, id));
    if (!run) return undefined;
    // Verify the run's provider belongs to this org
    const provider = await this.getProvider(run.providerAccountId, orgId);
    if (!provider) return undefined;
    return run;
  }

  async updateSyncRun(id: string, data: Partial<SyncRun>): Promise<SyncRun | undefined> {
    const [updated] = await db
      .update(syncRuns)
      .set(data)
      .where(eq(syncRuns.id, id))
      .returning();
    return updated || undefined;
  }

  async getProviderRuns(providerAccountId: string, limit: number, orgId: string): Promise<SyncRun[]> {
    // Inner join against providerAccounts on orgId prevents reading runs for
    // a provider that belongs to another org even if the caller supplies a
    // valid-looking providerAccountId from a different tenant.
    return await db
      .select({ sync_run: syncRuns })
      .from(syncRuns)
      .innerJoin(
        providerAccounts,
        and(
          eq(syncRuns.providerAccountId, providerAccounts.id),
          eq(providerAccounts.orgId, orgId)
        )
      )
      .where(eq(syncRuns.providerAccountId, providerAccountId))
      .orderBy(desc(syncRuns.createdAt))
      .limit(limit)
      .then(rows => rows.map(r => r.sync_run));
  }

  async getLastFailedSyncRuns(orgId: string): Promise<SyncRun[]> {
    // Scope to this org by filtering on provider IDs that belong to orgId.
    const orgProviders = await this.getProviders(orgId);
    if (orgProviders.length === 0) return [];
    const providerIds = orgProviders.map(p => p.id);

    // Get the most recent failed run for each org-owned provider
    const subquery = db
      .select({
        providerAccountId: syncRuns.providerAccountId,
        maxCreatedAt: sql`MAX(${syncRuns.createdAt})`.as('max_created_at'),
      })
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.status, 'failed'),
          inArray(syncRuns.providerAccountId, providerIds)
        )
      )
      .groupBy(syncRuns.providerAccountId)
      .as('latest_failed');

    return await db
      .select()
      .from(syncRuns)
      .innerJoin(
        subquery,
        and(
          eq(syncRuns.providerAccountId, subquery.providerAccountId),
          sql`${syncRuns.createdAt} = ${subquery.maxCreatedAt}`
        )
      )
      .then(rows => rows.map(row => row.sync_runs));
  }

  // Housekeeping operations
  async clearGroupCache(): Promise<void> {
    await db.delete(groupCache);
  }

  async addGroupCache(item: { kind: string; name: string }): Promise<GroupCache> {
    const [cached] = await db
      .insert(groupCache)
      .values(item)
      .returning();
    return cached;
  }

  async pruneStaleObjects(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await db
      .delete(externalObjects)
      .where(lt(externalObjects.lastSyncedAt, cutoffDate));
    
    return result.rowCount || 0;
  }

  async getProviderStats(orgId: string): Promise<any[]> {
    // Scoped to org — never leaks other tenants' provider stats.
    const providers = await this.getProviders(orgId);
    const stats = [];

    for (const provider of providers) {
      // Get last sync run — pass orgId so the inner join enforces org ownership
      const lastRuns = await this.getProviderRuns(provider.id, 1, orgId);
      const lastRun = lastRuns[0];

      // Calculate next run time (simplified - would use cron parser in real implementation)
      let nextRun: Date | null = null;
      if (provider.scheduleCron && provider.enabled) {
        nextRun = new Date(Date.now() + 60 * 60 * 1000); // Placeholder: 1 hour from now
      }

      stats.push({
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        enabled: provider.enabled,
        lastSync: lastRun ? {
          id: lastRun.id,
          status: lastRun.status,
          finishedAt: lastRun.finishedAt,
          counts: lastRun.counts,
        } : null,
        nextRun,
      });
    }

    return stats;
  }

  // NetBox VM operations
  async getNetboxVms(orgId: string): Promise<NetboxVm[]> {
    // Scoped to org via JOIN on netbox_inventory_sources ownership.
    // VMs with null sourceId are not returned in any org's view.
    return await db
      .select({ vm: netboxVms })
      .from(netboxVms)
      .innerJoin(netboxInventorySources, eq(netboxVms.sourceId, netboxInventorySources.id))
      .where(eq(netboxInventorySources.orgId, orgId))
      .orderBy(desc(netboxVms.lastImportedAt))
      .then((rows) => rows.map((r) => r.vm));
  }

  /** Internal use only — route handlers must not call this. */
  async getNetboxVmsUnsafe(): Promise<NetboxVm[]> {
    return await db.select().from(netboxVms).orderBy(desc(netboxVms.lastImportedAt));
  }

  async getNetboxVm(id: string): Promise<NetboxVm | undefined> {
    const [vm] = await db.select().from(netboxVms).where(eq(netboxVms.id, id));
    return vm || undefined;
  }

  async upsertNetboxVm(vm: InsertNetboxVm): Promise<NetboxVm> {
    // Check for existing VM by sourceId and netboxId
    const existing = await db.select().from(netboxVms).where(
      and(
        eq(netboxVms.sourceId, vm.sourceId || ""),
        eq(netboxVms.netboxId, vm.netboxId)
      )
    );
    
    if (existing.length > 0) {
      // Update existing VM
      const [updated] = await db
        .update(netboxVms)
        .set({ ...vm, lastImportedAt: new Date() })
        .where(
          and(
            eq(netboxVms.sourceId, vm.sourceId || ""),
            eq(netboxVms.netboxId, vm.netboxId)
          )
        )
        .returning();
      return updated;
    } else {
      // Insert new VM
      const [inserted] = await db
        .insert(netboxVms)
        .values(vm)
        .returning();
      return inserted;
    }
  }

  async deleteAllNetboxVms(): Promise<void> {
    await db.delete(netboxVms);
  }

  async updateNetboxVm(id: string, updates: Partial<NetboxVm>): Promise<NetboxVm | null> {
    const [updated] = await db
      .update(netboxVms)
      .set(updates)
      .where(eq(netboxVms.id, id))
      .returning();
    return updated || null;
  }

  // NetBox Inventory Source operations
  async getNetboxInventorySources(orgId: string): Promise<NetboxInventorySource[]> {
    return await db.select().from(netboxInventorySources).where(eq(netboxInventorySources.orgId, orgId)).orderBy(desc(netboxInventorySources.createdAt));
  }

  async getNetboxInventorySource(id: string, orgId: string): Promise<NetboxInventorySource | undefined> {
    const [source] = await db.select().from(netboxInventorySources).where(and(eq(netboxInventorySources.id, id), eq(netboxInventorySources.orgId, orgId)));
    return source || undefined;
  }

  async createNetboxInventorySource(insertSource: InsertNetboxInventorySource): Promise<NetboxInventorySource> {
    const [source] = await db
      .insert(netboxInventorySources)
      .values(insertSource)
      .returning();
    return source;
  }

  async updateNetboxInventorySource(id: string, data: Partial<NetboxInventorySource>, orgId: string): Promise<NetboxInventorySource | undefined> {
    const [updated] = await db.update(netboxInventorySources).set(data).where(and(eq(netboxInventorySources.id, id), eq(netboxInventorySources.orgId, orgId))).returning();
    return updated || undefined;
  }

  async deleteNetboxInventorySource(id: string, orgId: string): Promise<void> {
    await db.delete(netboxInventorySources).where(and(eq(netboxInventorySources.id, id), eq(netboxInventorySources.orgId, orgId)));
  }

  // CMDB operations
  async getCmdbAccounts(orgId: string): Promise<CmdbAccount[]> {
    return await db.select().from(cmdbAccounts).where(eq(cmdbAccounts.orgId, orgId)).orderBy(desc(cmdbAccounts.createdAt));
  }

  async getCmdbAccount(id: string, orgId: string): Promise<CmdbAccount | undefined> {
    const [account] = await db.select().from(cmdbAccounts).where(and(eq(cmdbAccounts.id, id), eq(cmdbAccounts.orgId, orgId)));
    return account || undefined;
  }

  async createCmdbAccount(insertAccount: InsertCmdbAccount): Promise<CmdbAccount> {
    const [account] = await db
      .insert(cmdbAccounts)
      .values({ ...insertAccount, updatedAt: new Date() })
      .returning();
    return account;
  }

  async updateCmdbAccount(id: string, data: Partial<CmdbAccount>, orgId: string): Promise<CmdbAccount | undefined> {
    const [updated] = await db.update(cmdbAccounts).set({ ...data, updatedAt: new Date() }).where(and(eq(cmdbAccounts.id, id), eq(cmdbAccounts.orgId, orgId))).returning();
    return updated || undefined;
  }

  async deleteCmdbAccount(id: string, orgId: string): Promise<void> {
    await db.delete(cmdbAccounts).where(and(eq(cmdbAccounts.id, id), eq(cmdbAccounts.orgId, orgId)));
  }

  // Pipeline operations
  async getPipelines(orgId: string): Promise<Pipeline[]> {
    return await db.select().from(pipelines).where(eq(pipelines.orgId, orgId)).orderBy(desc(pipelines.createdAt));
  }

  async getPipeline(id: string, orgId: string): Promise<Pipeline | undefined> {
    const [pipeline] = await db.select().from(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)));
    return pipeline || undefined;
  }

  async createPipeline(insertPipeline: InsertPipeline): Promise<Pipeline> {
    const [pipeline] = await db
      .insert(pipelines)
      .values({ ...insertPipeline, updatedAt: new Date() })
      .returning();
    return pipeline;
  }

  async updatePipeline(id: string, data: Partial<Pipeline>, orgId: string): Promise<Pipeline | undefined> {
    const [updated] = await db.update(pipelines).set({ ...data, updatedAt: new Date() }).where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId))).returning();
    return updated || undefined;
  }

  async deletePipeline(id: string, orgId: string): Promise<void> {
    await db.delete(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)));
  }

  async incrementPipelineVersion(id: string): Promise<void> {
    await db
      .update(pipelines)
      .set({
        version: sql`${pipelines.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(pipelines.id, id));
  }

  // Pipeline Mapping operations
  async getPipelineMappings(pipelineId: string): Promise<PipelineMapping[]> {
    return await db
      .select()
      .from(pipelineMappings)
      .where(eq(pipelineMappings.pipelineId, pipelineId))
      .orderBy(desc(pipelineMappings.updatedAt));
  }

  async getPipelineMapping(id: string): Promise<PipelineMapping | undefined> {
    const [mapping] = await db.select().from(pipelineMappings).where(eq(pipelineMappings.id, id));
    return mapping || undefined;
  }

  async createPipelineMapping(insertMapping: InsertPipelineMapping): Promise<PipelineMapping> {
    const [mapping] = await db
      .insert(pipelineMappings)
      .values({
        ...insertMapping,
        updatedAt: new Date(),
      })
      .returning();
    return mapping;
  }

  async updatePipelineMapping(id: string, data: Partial<PipelineMapping>): Promise<PipelineMapping | undefined> {
    const [updated] = await db
      .update(pipelineMappings)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(pipelineMappings.id, id))
      .returning();
    return updated || undefined;
  }

  async deletePipelineMapping(id: string): Promise<void> {
    await db.delete(pipelineMappings).where(eq(pipelineMappings.id, id));
  }

  // Pipeline Run operations
  async getPipelineRuns(pipelineId: string, limit: number = 50): Promise<PipelineRun[]> {
    return await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.pipelineId, pipelineId))
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(limit);
  }

  async getPipelineRun(id: string, orgId: string): Promise<PipelineRun | undefined> {
    const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id));
    if (!run) return undefined;
    // Verify the run's pipeline belongs to this org
    const pipeline = await this.getPipeline(run.pipelineId, orgId);
    if (!pipeline) return undefined;
    return run;
  }

  async createPipelineRun(insertRun: InsertPipelineRun): Promise<PipelineRun> {
    const [run] = await db
      .insert(pipelineRuns)
      .values(insertRun)
      .returning();
    return run;
  }

  async updatePipelineRun(id: string, data: Partial<PipelineRun>): Promise<PipelineRun | undefined> {
    const [updated] = await db
      .update(pipelineRuns)
      .set(data)
      .where(eq(pipelineRuns.id, id))
      .returning();
    return updated || undefined;
  }

  // All pipeline runs scoped to an org via pipeline ownership
  async getAllPipelineRuns(limit: number = 100, orgId: string): Promise<PipelineRun[]> {
    const orgPipelineIds = db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(eq(pipelines.orgId, orgId));
    return await db
      .select()
      .from(pipelineRuns)
      .where(inArray(pipelineRuns.pipelineId, orgPipelineIds))
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(limit);
  }

  // All sync runs scoped to an org via provider ownership
  async getAllSyncRuns(limit: number = 100, orgId: string): Promise<SyncRun[]> {
    const orgProviderIds = db
      .select({ id: providerAccounts.id })
      .from(providerAccounts)
      .where(eq(providerAccounts.orgId, orgId));
    return await db
      .select()
      .from(syncRuns)
      .where(inArray(syncRuns.providerAccountId, orgProviderIds))
      .orderBy(desc(syncRuns.createdAt))
      .limit(limit);
  }

  // Governance Blueprint operations
  async createGovernanceBlueprint(insertBlueprint: InsertGovernanceBlueprint): Promise<GovernanceBlueprint> {
    const [blueprint] = await db
      .insert(governanceBlueprints)
      .values({ ...insertBlueprint, updatedAt: new Date() })
      .returning();
    return blueprint;
  }

  async listGovernanceBlueprints(orgId: string): Promise<GovernanceBlueprint[]> {
    return await db
      .select()
      .from(governanceBlueprints)
      .where(eq(governanceBlueprints.orgId, orgId))
      .orderBy(desc(governanceBlueprints.createdAt));
  }

  async getGovernanceBlueprint(id: string, orgId: string): Promise<GovernanceBlueprint | undefined> {
    const [blueprint] = await db
      .select()
      .from(governanceBlueprints)
      .where(and(eq(governanceBlueprints.id, id), eq(governanceBlueprints.orgId, orgId)));
    return blueprint || undefined;
  }

  async updateGovernanceBlueprint(
    id: string,
    data: Partial<GovernanceBlueprint>,
    orgId: string
  ): Promise<GovernanceBlueprint | undefined> {
    const { id: _ignoredId, orgId: _ignoredOrgId, activeVersionId: _ignoredActiveVersionId, ...safeData } = data;
    const [updated] = await db
      .update(governanceBlueprints)
      .set({ ...safeData, updatedAt: new Date() })
      .where(and(eq(governanceBlueprints.id, id), eq(governanceBlueprints.orgId, orgId)))
      .returning();
    return updated || undefined;
  }

  async createGovernanceBlueprintVersion(
    insertVersion: InsertGovernanceBlueprintVersion
  ): Promise<GovernanceBlueprintVersion> {
    const parent = await this.getGovernanceBlueprint(insertVersion.blueprintId, insertVersion.orgId);
    if (!parent) {
      throw new Error("Governance blueprint not found");
    }

    const [version] = await db
      .insert(governanceBlueprintVersions)
      .values(insertVersion)
      .returning();
    return version;
  }

  async getGovernanceBlueprintVersion(id: string, orgId: string): Promise<GovernanceBlueprintVersion | undefined> {
    const [version] = await db
      .select()
      .from(governanceBlueprintVersions)
      .where(and(eq(governanceBlueprintVersions.id, id), eq(governanceBlueprintVersions.orgId, orgId)));
    return version || undefined;
  }

  async listGovernanceBlueprintVersions(blueprintId: string, orgId: string): Promise<GovernanceBlueprintVersion[]> {
    const parent = await this.getGovernanceBlueprint(blueprintId, orgId);
    if (!parent) return [];

    return await db
      .select()
      .from(governanceBlueprintVersions)
      .where(and(eq(governanceBlueprintVersions.blueprintId, blueprintId), eq(governanceBlueprintVersions.orgId, orgId)))
      .orderBy(desc(governanceBlueprintVersions.version));
  }

  async activateGovernanceBlueprintVersion(
    blueprintId: string,
    versionId: string,
    orgId: string
  ): Promise<GovernanceBlueprint | undefined> {
    const parent = await this.getGovernanceBlueprint(blueprintId, orgId);
    if (!parent) return undefined;

    const version = await this.getGovernanceBlueprintVersion(versionId, orgId);
    if (!version || version.blueprintId !== blueprintId) return undefined;

    const [updated] = await db
      .update(governanceBlueprints)
      .set({
        activeVersionId: version.id,
        status: "active",
        updatedAt: new Date(),
      })
      .where(and(eq(governanceBlueprints.id, blueprintId), eq(governanceBlueprints.orgId, orgId)))
      .returning();
    return updated || undefined;
  }

  async getActiveGovernanceBlueprintForObjectType(
    objectType: string,
    orgId: string
  ): Promise<{ blueprint: GovernanceBlueprint; version: GovernanceBlueprintVersion } | undefined> {
    const [blueprint] = await db
      .select()
      .from(governanceBlueprints)
      .where(and(eq(governanceBlueprints.objectType, objectType), eq(governanceBlueprints.orgId, orgId), eq(governanceBlueprints.status, "active")))
      .orderBy(desc(governanceBlueprints.updatedAt))
      .limit(1);

    if (!blueprint?.activeVersionId) return undefined;

    const version = await this.getGovernanceBlueprintVersion(blueprint.activeVersionId, orgId);
    if (!version || version.blueprintId !== blueprint.id) return undefined;

    return { blueprint, version };
  }

  async createGovernanceEvaluationRun(insertRun: InsertGovernanceEvaluationRun): Promise<GovernanceEvaluationRun> {
    const blueprint = await this.getGovernanceBlueprint(insertRun.blueprintId, insertRun.orgId);
    const version = await this.getGovernanceBlueprintVersion(insertRun.blueprintVersionId, insertRun.orgId);
    if (!blueprint || !version || version.blueprintId !== blueprint.id) {
      throw new Error("Governance blueprint version not found");
    }

    if (insertRun.netboxSourceId) {
      const source = await this.getNetboxInventorySource(insertRun.netboxSourceId, insertRun.orgId);
      if (!source) {
        throw new Error("NetBox inventory source not found");
      }
    }

    if (insertRun.cmdbAccountId) {
      const account = await this.getCmdbAccount(insertRun.cmdbAccountId, insertRun.orgId);
      if (!account) {
        throw new Error("CMDB account not found");
      }
    }

    const [run] = await db
      .insert(governanceEvaluationRuns)
      .values(insertRun)
      .returning();
    return run;
  }

  async storeGovernanceObjectEvaluation(
    insertEvaluation: InsertGovernanceObjectEvaluation
  ): Promise<GovernanceObjectEvaluation> {
    if (!insertEvaluation.runId) {
      throw new Error("Governance object evaluation requires runId");
    }

    const run = await this.getGovernanceEvaluationRun(insertEvaluation.runId, insertEvaluation.orgId);
    if (!run) {
      throw new Error("Governance evaluation run not found");
    }
    if (
      run.blueprintId !== insertEvaluation.blueprintId ||
      run.blueprintVersionId !== insertEvaluation.blueprintVersionId
    ) {
      throw new Error("Governance object evaluation does not match its run");
    }

    const [evaluation] = await db
      .insert(governanceObjectEvaluations)
      .values(insertEvaluation)
      .returning();
    return evaluation;
  }

  async listGovernanceEvaluationRuns(orgId: string, limit: number = 50): Promise<GovernanceEvaluationRun[]> {
    return await db
      .select()
      .from(governanceEvaluationRuns)
      .where(eq(governanceEvaluationRuns.orgId, orgId))
      .orderBy(desc(governanceEvaluationRuns.createdAt))
      .limit(limit);
  }

  async getGovernanceEvaluationRun(id: string, orgId: string): Promise<GovernanceEvaluationRun | undefined> {
    const [run] = await db
      .select()
      .from(governanceEvaluationRuns)
      .where(and(eq(governanceEvaluationRuns.id, id), eq(governanceEvaluationRuns.orgId, orgId)));
    return run || undefined;
  }

  async listGovernanceObjectEvaluations(runId: string, orgId: string): Promise<GovernanceObjectEvaluation[]> {
    const run = await this.getGovernanceEvaluationRun(runId, orgId);
    if (!run) return [];

    return await db
      .select()
      .from(governanceObjectEvaluations)
      .where(and(eq(governanceObjectEvaluations.runId, runId), eq(governanceObjectEvaluations.orgId, orgId)))
      .orderBy(desc(governanceObjectEvaluations.evaluatedAt));
  }

  async getLatestGovernanceEvaluationForObject(
    orgId: string,
    objectType: string,
    objectId: string
  ): Promise<{ evaluation: GovernanceObjectEvaluation; run: GovernanceEvaluationRun | null } | undefined> {
    const [evaluation] = await db
      .select()
      .from(governanceObjectEvaluations)
      .where(and(
        eq(governanceObjectEvaluations.orgId, orgId),
        eq(governanceObjectEvaluations.objectType, objectType),
        eq(governanceObjectEvaluations.objectId, objectId),
      ))
      .orderBy(desc(governanceObjectEvaluations.evaluatedAt))
      .limit(1);

    if (!evaluation) return undefined;

    const run = await this.getGovernanceEvaluationRun(evaluation.runId, orgId);
    return { evaluation, run: run ?? null };
  }

  async createCustomerScope(scope: InsertCustomerScope): Promise<CustomerScope> {
    const [created] = await db
      .insert(customerScopes)
      .values(scope)
      .returning();
    return created;
  }

  async upsertCustomerScope(scope: InsertCustomerScope): Promise<CustomerScope> {
    const existing = await this.getCustomerScopeByExternalId(
      scope.orgId,
      scope.sourceType,
      scope.sourceId,
      scope.externalId,
    );

    if (existing) {
      const [updated] = await db
        .update(customerScopes)
        .set({ ...scope, updatedAt: new Date() })
        .where(and(
          eq(customerScopes.id, existing.id),
          eq(customerScopes.orgId, scope.orgId),
        ))
        .returning();
      return updated;
    }

    return this.createCustomerScope(scope);
  }

  async listCustomerScopes(orgId: string, sourceType?: string, sourceId?: string): Promise<CustomerScope[]> {
    const conditions = [eq(customerScopes.orgId, orgId)];
    if (sourceType) conditions.push(eq(customerScopes.sourceType, sourceType));
    if (sourceId) conditions.push(eq(customerScopes.sourceId, sourceId));

    return await db
      .select()
      .from(customerScopes)
      .where(and(...conditions))
      .orderBy(desc(customerScopes.updatedAt), desc(customerScopes.createdAt));
  }

  async getCustomerScope(id: string, orgId: string): Promise<CustomerScope | undefined> {
    const [scope] = await db
      .select()
      .from(customerScopes)
      .where(and(eq(customerScopes.id, id), eq(customerScopes.orgId, orgId)));
    return scope ?? undefined;
  }

  async getCustomerScopeByExternalId(
    orgId: string,
    sourceType: string,
    sourceId: string,
    externalId: string,
  ): Promise<CustomerScope | undefined> {
    const [scope] = await db
      .select()
      .from(customerScopes)
      .where(and(
        eq(customerScopes.orgId, orgId),
        eq(customerScopes.sourceType, sourceType),
        eq(customerScopes.sourceId, sourceId),
        eq(customerScopes.externalId, externalId),
      ));
    return scope ?? undefined;
  }

  async createCustomerScopeObjectAssignment(
    assignment: InsertCustomerScopeObjectAssignment,
  ): Promise<CustomerScopeObjectAssignment> {
    await this.assertCustomerScopeAssignmentIsOrgScoped(assignment);
    const [created] = await db
      .insert(customerScopeObjectAssignments)
      .values(assignment)
      .returning();
    return created;
  }

  async upsertCustomerScopeObjectAssignment(
    assignment: InsertCustomerScopeObjectAssignment,
  ): Promise<CustomerScopeObjectAssignment> {
    await this.assertCustomerScopeAssignmentIsOrgScoped(assignment);
    const existing = await this.findCustomerScopeObjectAssignment(assignment);

    if (existing) {
      const [updated] = await db
        .update(customerScopeObjectAssignments)
        .set({ ...assignment, updatedAt: new Date() })
        .where(and(
          eq(customerScopeObjectAssignments.id, existing.id),
          eq(customerScopeObjectAssignments.orgId, assignment.orgId),
        ))
        .returning();
      return updated;
    }

    return this.createCustomerScopeObjectAssignment(assignment);
  }

  async listCustomerScopeObjectAssignments(
    orgId: string,
    sourceType?: string,
    sourceId?: string,
  ): Promise<CustomerScopeObjectAssignment[]> {
    const conditions = [eq(customerScopeObjectAssignments.orgId, orgId)];
    if (sourceType) conditions.push(eq(customerScopeObjectAssignments.sourceType, sourceType));
    if (sourceId) conditions.push(eq(customerScopeObjectAssignments.sourceId, sourceId));

    return await db
      .select()
      .from(customerScopeObjectAssignments)
      .where(and(...conditions))
      .orderBy(desc(customerScopeObjectAssignments.updatedAt), desc(customerScopeObjectAssignments.createdAt));
  }

  async listAssignmentsForObject(
    orgId: string,
    sourceType: string,
    sourceId: string,
    objectType: string,
    objectId: string,
  ): Promise<CustomerScopeObjectAssignment[]> {
    return await db
      .select()
      .from(customerScopeObjectAssignments)
      .where(and(
        eq(customerScopeObjectAssignments.orgId, orgId),
        eq(customerScopeObjectAssignments.sourceType, sourceType),
        eq(customerScopeObjectAssignments.sourceId, sourceId),
        eq(customerScopeObjectAssignments.objectType, objectType),
        eq(customerScopeObjectAssignments.objectId, objectId),
      ))
      .orderBy(desc(customerScopeObjectAssignments.updatedAt), desc(customerScopeObjectAssignments.createdAt));
  }

  async listAssignmentsForCustomerScope(
    orgId: string,
    customerScopeId: string,
  ): Promise<CustomerScopeObjectAssignment[]> {
    const scope = await this.getCustomerScope(customerScopeId, orgId);
    if (!scope) return [];

    return await db
      .select()
      .from(customerScopeObjectAssignments)
      .where(and(
        eq(customerScopeObjectAssignments.orgId, orgId),
        eq(customerScopeObjectAssignments.customerScopeId, customerScopeId),
      ))
      .orderBy(desc(customerScopeObjectAssignments.updatedAt), desc(customerScopeObjectAssignments.createdAt));
  }

  private async assertCustomerScopeAssignmentIsOrgScoped(
    assignment: InsertCustomerScopeObjectAssignment,
  ): Promise<void> {
    if (!assignment.customerScopeId) return;
    const scope = await this.getCustomerScope(assignment.customerScopeId, assignment.orgId);
    if (!scope || scope.sourceType !== assignment.sourceType || scope.sourceId !== assignment.sourceId) {
      throw new Error("CustomerScope assignment must reference a scope in the same organization and source");
    }
  }

  private async findCustomerScopeObjectAssignment(
    assignment: InsertCustomerScopeObjectAssignment,
  ): Promise<CustomerScopeObjectAssignment | undefined> {
    const customerScopeCondition = assignment.customerScopeId
      ? eq(customerScopeObjectAssignments.customerScopeId, assignment.customerScopeId)
      : isNull(customerScopeObjectAssignments.customerScopeId);

    const [existing] = await db
      .select()
      .from(customerScopeObjectAssignments)
      .where(and(
        eq(customerScopeObjectAssignments.orgId, assignment.orgId),
        eq(customerScopeObjectAssignments.sourceType, assignment.sourceType),
        eq(customerScopeObjectAssignments.sourceId, assignment.sourceId),
        eq(customerScopeObjectAssignments.objectType, assignment.objectType),
        eq(customerScopeObjectAssignments.objectId, assignment.objectId),
        customerScopeCondition,
        eq(customerScopeObjectAssignments.relationship, assignment.relationship),
      ));
    return existing ?? undefined;
  }
}

export const storage = new DatabaseStorage();
