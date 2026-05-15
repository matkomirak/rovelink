// Database storage implementation (from javascript_database blueprint)
import { 
  users, projects, credentials, jobTemplates, jobRuns, settings, notifications,
  providerAccounts, syncRuns, externalObjects, groupCache, netboxVms, netboxInventorySources,
  cmdbAccounts, pipelines, pipelineMappings, pipelineRuns,
  type User, type InsertUser,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, lte, and, lt, sql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Project operations
  getProjects(orgId?: string | null): Promise<Project[]>;
  getProject(id: string, orgId?: string | null): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<Project>, orgId?: string | null): Promise<Project | undefined>;
  deleteProject(id: string, orgId?: string | null): Promise<void>;

  // Credential operations
  getCredentials(orgId?: string | null): Promise<Credential[]>;
  getCredential(id: string, orgId?: string | null): Promise<Credential | undefined>;
  createCredential(credential: InsertCredential): Promise<Credential>;
  updateCredential(id: string, data: Partial<Credential>, orgId?: string | null): Promise<Credential | undefined>;
  deleteCredential(id: string, orgId?: string | null): Promise<void>;

  // Job Template operations
  getJobTemplates(orgId?: string | null): Promise<JobTemplate[]>;
  getJobTemplate(id: string, orgId?: string | null): Promise<JobTemplate | undefined>;
  createJobTemplate(template: InsertJobTemplate): Promise<JobTemplate>;
  updateJobTemplate(id: string, data: Partial<JobTemplate>, orgId?: string | null): Promise<JobTemplate | undefined>;
  deleteJobTemplate(id: string, orgId?: string | null): Promise<void>;

  // Job Run operations
  getJobRuns(filters?: any, page?: number, pageSize?: number, orgId?: string | null): Promise<JobRun[]>;
  getJobRun(id: string): Promise<JobRun | undefined>;
  createJobRun(run: InsertJobRun): Promise<JobRun>;
  updateJobRun(id: string, data: Partial<JobRun>): Promise<JobRun | undefined>;

  // Settings operations
  getSetting(key: string): Promise<Setting | undefined>;
  setSetting(key: string, value: string): Promise<Setting>;
  getAllSettings(): Promise<Setting[]>;

  // Notification operations
  getNotifications(): Promise<Notification[]>;
  getNotification(id: string): Promise<Notification | undefined>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  updateNotification(id: string, data: Partial<Notification>): Promise<Notification | undefined>;
  deleteNotification(id: string): Promise<void>;

  // Provider operations
  getProviders(orgId?: string | null): Promise<ProviderAccount[]>;
  getProvider(id: string, orgId?: string | null): Promise<ProviderAccount | undefined>;
  createProvider(provider: InsertProviderAccount): Promise<ProviderAccount>;
  updateProvider(id: string, data: Partial<ProviderAccount>, orgId?: string | null): Promise<ProviderAccount | undefined>;
  deleteProvider(id: string, orgId?: string | null): Promise<void>;

  // Sync Run operations
  createSyncRun(run: InsertSyncRun): Promise<SyncRun>;
  getSyncRun(id: string): Promise<SyncRun | undefined>;
  updateSyncRun(id: string, data: Partial<SyncRun>): Promise<SyncRun | undefined>;
  getProviderRuns(providerAccountId: string, limit: number): Promise<SyncRun[]>;
  getLastFailedSyncRuns(): Promise<SyncRun[]>;

  // Housekeeping operations
  clearGroupCache(): Promise<void>;
  addGroupCache(item: { kind: string; name: string }): Promise<GroupCache>;
  pruneStaleObjects(days: number): Promise<number>;
  getProviderStats(): Promise<any[]>;

  // NetBox VM operations
  getNetboxVms(): Promise<NetboxVm[]>;
  getNetboxVm(id: string): Promise<NetboxVm | undefined>;
  upsertNetboxVm(vm: InsertNetboxVm): Promise<NetboxVm>;
  updateNetboxVm(id: string, updates: Partial<NetboxVm>): Promise<NetboxVm | null>;
  deleteAllNetboxVms(): Promise<void>;

  // NetBox Inventory Source operations
  getNetboxInventorySources(orgId?: string | null): Promise<NetboxInventorySource[]>;
  getNetboxInventorySource(id: string, orgId?: string | null): Promise<NetboxInventorySource | undefined>;
  createNetboxInventorySource(source: InsertNetboxInventorySource): Promise<NetboxInventorySource>;
  updateNetboxInventorySource(id: string, data: Partial<NetboxInventorySource>, orgId?: string | null): Promise<NetboxInventorySource | undefined>;
  deleteNetboxInventorySource(id: string, orgId?: string | null): Promise<void>;

  // CMDB operations
  getCmdbAccounts(orgId?: string | null): Promise<CmdbAccount[]>;
  getCmdbAccount(id: string, orgId?: string | null): Promise<CmdbAccount | undefined>;
  createCmdbAccount(account: InsertCmdbAccount): Promise<CmdbAccount>;
  updateCmdbAccount(id: string, data: Partial<CmdbAccount>, orgId?: string | null): Promise<CmdbAccount | undefined>;
  deleteCmdbAccount(id: string, orgId?: string | null): Promise<void>;

  // Pipeline operations
  getPipelines(orgId?: string | null): Promise<Pipeline[]>;
  getPipeline(id: string, orgId?: string | null): Promise<Pipeline | undefined>;
  createPipeline(pipeline: InsertPipeline): Promise<Pipeline>;
  updatePipeline(id: string, data: Partial<Pipeline>, orgId?: string | null): Promise<Pipeline | undefined>;
  deletePipeline(id: string, orgId?: string | null): Promise<void>;
  incrementPipelineVersion(id: string): Promise<void>;

  // Pipeline Mapping operations
  getPipelineMappings(pipelineId: string): Promise<PipelineMapping[]>;
  getPipelineMapping(id: string): Promise<PipelineMapping | undefined>;
  createPipelineMapping(mapping: InsertPipelineMapping): Promise<PipelineMapping>;
  updatePipelineMapping(id: string, data: Partial<PipelineMapping>): Promise<PipelineMapping | undefined>;
  deletePipelineMapping(id: string): Promise<void>;

  // Pipeline Run operations
  getPipelineRuns(pipelineId: string, limit?: number): Promise<PipelineRun[]>;
  getAllPipelineRuns(limit?: number): Promise<PipelineRun[]>;
  getPipelineRun(id: string): Promise<PipelineRun | undefined>;
  createPipelineRun(run: InsertPipelineRun): Promise<PipelineRun>;
  updatePipelineRun(id: string, data: Partial<PipelineRun>): Promise<PipelineRun | undefined>;

  // Sync Run operations
  getAllSyncRuns(limit?: number): Promise<SyncRun[]>;
  getSyncRun(id: string): Promise<SyncRun | undefined>;
}

export class DatabaseStorage implements IStorage {
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
  async getProjects(orgId?: string | null): Promise<Project[]> {
    if (orgId) {
      return await db.select().from(projects).where(eq(projects.orgId, orgId)).orderBy(desc(projects.createdAt));
    }
    return await db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProject(id: string, orgId?: string | null): Promise<Project | undefined> {
    const where = orgId
      ? and(eq(projects.id, id), eq(projects.orgId, orgId))
      : eq(projects.id, id);
    const [project] = await db.select().from(projects).where(where);
    return project || undefined;
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db
      .insert(projects)
      .values(insertProject)
      .returning();
    return project;
  }

  async updateProject(id: string, data: Partial<Project>, orgId?: string | null): Promise<Project | undefined> {
    const where = orgId ? and(eq(projects.id, id), eq(projects.orgId, orgId)) : eq(projects.id, id);
    const [updated] = await db.update(projects).set(data).where(where).returning();
    return updated || undefined;
  }

  async deleteProject(id: string, orgId?: string | null): Promise<void> {
    const where = orgId ? and(eq(projects.id, id), eq(projects.orgId, orgId)) : eq(projects.id, id);
    await db.delete(projects).where(where);
  }

  // Credential operations
  async getCredentials(orgId?: string | null): Promise<Credential[]> {
    if (orgId) {
      return await db.select().from(credentials).where(eq(credentials.orgId, orgId)).orderBy(desc(credentials.createdAt));
    }
    return await db.select().from(credentials).orderBy(desc(credentials.createdAt));
  }

  async getCredential(id: string, orgId?: string | null): Promise<Credential | undefined> {
    const where = orgId ? and(eq(credentials.id, id), eq(credentials.orgId, orgId)) : eq(credentials.id, id);
    const [credential] = await db.select().from(credentials).where(where);
    return credential || undefined;
  }

  async createCredential(insertCredential: InsertCredential): Promise<Credential> {
    const [credential] = await db
      .insert(credentials)
      .values(insertCredential)
      .returning();
    return credential;
  }

  async updateCredential(id: string, data: Partial<Credential>, orgId?: string | null): Promise<Credential | undefined> {
    const where = orgId ? and(eq(credentials.id, id), eq(credentials.orgId, orgId)) : eq(credentials.id, id);
    const [updated] = await db.update(credentials).set(data).where(where).returning();
    return updated || undefined;
  }

  async deleteCredential(id: string, orgId?: string | null): Promise<void> {
    const where = orgId ? and(eq(credentials.id, id), eq(credentials.orgId, orgId)) : eq(credentials.id, id);
    await db.delete(credentials).where(where);
  }

  // Job Template operations
  async getJobTemplates(orgId?: string | null): Promise<JobTemplate[]> {
    if (orgId) {
      return await db.select().from(jobTemplates).where(eq(jobTemplates.orgId, orgId)).orderBy(desc(jobTemplates.createdAt));
    }
    return await db.select().from(jobTemplates).orderBy(desc(jobTemplates.createdAt));
  }

  async getJobTemplate(id: string, orgId?: string | null): Promise<JobTemplate | undefined> {
    const where = orgId ? and(eq(jobTemplates.id, id), eq(jobTemplates.orgId, orgId)) : eq(jobTemplates.id, id);
    const [template] = await db.select().from(jobTemplates).where(where);
    return template || undefined;
  }

  async createJobTemplate(insertTemplate: InsertJobTemplate): Promise<JobTemplate> {
    const [template] = await db
      .insert(jobTemplates)
      .values(insertTemplate)
      .returning();
    return template;
  }

  async updateJobTemplate(id: string, data: Partial<JobTemplate>, orgId?: string | null): Promise<JobTemplate | undefined> {
    const where = orgId ? and(eq(jobTemplates.id, id), eq(jobTemplates.orgId, orgId)) : eq(jobTemplates.id, id);
    const [updated] = await db.update(jobTemplates).set(data).where(where).returning();
    return updated || undefined;
  }

  async deleteJobTemplate(id: string, orgId?: string | null): Promise<void> {
    const where = orgId ? and(eq(jobTemplates.id, id), eq(jobTemplates.orgId, orgId)) : eq(jobTemplates.id, id);
    await db.delete(jobTemplates).where(where);
  }

  // Job Run operations
  async getJobRuns(filters: any = {}, page: number = 1, pageSize: number = 50, orgId?: string | null): Promise<JobRun[]> {
    let query = db.select().from(jobRuns);
    
    if (orgId) {
      query = query.where(eq(jobRuns.orgId, orgId)) as any;
    }
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

  async getJobRun(id: string): Promise<JobRun | undefined> {
    const [run] = await db.select().from(jobRuns).where(eq(jobRuns.id, id));
    return run || undefined;
  }

  async createJobRun(insertRun: InsertJobRun): Promise<JobRun> {
    const [run] = await db
      .insert(jobRuns)
      .values(insertRun)
      .returning();
    return run;
  }

  async updateJobRun(id: string, data: Partial<JobRun>): Promise<JobRun | undefined> {
    const [updated] = await db
      .update(jobRuns)
      .set(data)
      .where(eq(jobRuns.id, id))
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
  async getNotifications(): Promise<Notification[]> {
    return await db.select().from(notifications).orderBy(desc(notifications.createdAt));
  }

  async getNotification(id: string): Promise<Notification | undefined> {
    const [notification] = await db.select().from(notifications).where(eq(notifications.id, id));
    return notification || undefined;
  }

  async createNotification(insertNotification: InsertNotification): Promise<Notification> {
    const [notification] = await db
      .insert(notifications)
      .values(insertNotification)
      .returning();
    return notification;
  }

  async updateNotification(id: string, data: Partial<Notification>): Promise<Notification | undefined> {
    const [updated] = await db
      .update(notifications)
      .set(data)
      .where(eq(notifications.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteNotification(id: string): Promise<void> {
    await db.delete(notifications).where(eq(notifications.id, id));
  }

  // Provider operations
  async getProviders(orgId?: string | null): Promise<ProviderAccount[]> {
    if (orgId) {
      return await db.select().from(providerAccounts).where(eq(providerAccounts.orgId, orgId)).orderBy(desc(providerAccounts.createdAt));
    }
    return await db.select().from(providerAccounts).orderBy(desc(providerAccounts.createdAt));
  }

  async getProvider(id: string, orgId?: string | null): Promise<ProviderAccount | undefined> {
    const where = orgId ? and(eq(providerAccounts.id, id), eq(providerAccounts.orgId, orgId)) : eq(providerAccounts.id, id);
    const [provider] = await db.select().from(providerAccounts).where(where);
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

  async updateProvider(id: string, data: Partial<ProviderAccount>, orgId?: string | null): Promise<ProviderAccount | undefined> {
    const where = orgId ? and(eq(providerAccounts.id, id), eq(providerAccounts.orgId, orgId)) : eq(providerAccounts.id, id);
    const [updated] = await db.update(providerAccounts).set({ ...data, updatedAt: new Date() }).where(where).returning();
    return updated || undefined;
  }

  async deleteProvider(id: string, orgId?: string | null): Promise<void> {
    const where = orgId ? and(eq(providerAccounts.id, id), eq(providerAccounts.orgId, orgId)) : eq(providerAccounts.id, id);
    await db.delete(providerAccounts).where(where);
  }

  // Sync Run operations
  async createSyncRun(insertRun: InsertSyncRun): Promise<SyncRun> {
    const [run] = await db
      .insert(syncRuns)
      .values(insertRun)
      .returning();
    return run;
  }

  async getSyncRun(id: string): Promise<SyncRun | undefined> {
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, id));
    return run || undefined;
  }

  async updateSyncRun(id: string, data: Partial<SyncRun>): Promise<SyncRun | undefined> {
    const [updated] = await db
      .update(syncRuns)
      .set(data)
      .where(eq(syncRuns.id, id))
      .returning();
    return updated || undefined;
  }

  async getProviderRuns(providerAccountId: string, limit: number): Promise<SyncRun[]> {
    return await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.providerAccountId, providerAccountId))
      .orderBy(desc(syncRuns.createdAt))
      .limit(limit);
  }

  async getLastFailedSyncRuns(): Promise<SyncRun[]> {
    // Get the most recent failed run for each provider
    const subquery = db
      .select({
        providerAccountId: syncRuns.providerAccountId,
        maxCreatedAt: sql`MAX(${syncRuns.createdAt})`.as('max_created_at'),
      })
      .from(syncRuns)
      .where(eq(syncRuns.status, 'failed'))
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

  async getProviderStats(): Promise<any[]> {
    const providers = await this.getProviders();
    const stats = [];

    for (const provider of providers) {
      // Get last sync run
      const lastRuns = await this.getProviderRuns(provider.id, 1);
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
  async getNetboxVms(): Promise<NetboxVm[]> {
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
  async getNetboxInventorySources(orgId?: string | null): Promise<NetboxInventorySource[]> {
    if (orgId) {
      return await db.select().from(netboxInventorySources).where(eq(netboxInventorySources.orgId, orgId)).orderBy(desc(netboxInventorySources.createdAt));
    }
    return await db.select().from(netboxInventorySources).orderBy(desc(netboxInventorySources.createdAt));
  }

  async getNetboxInventorySource(id: string, orgId?: string | null): Promise<NetboxInventorySource | undefined> {
    const where = orgId ? and(eq(netboxInventorySources.id, id), eq(netboxInventorySources.orgId, orgId)) : eq(netboxInventorySources.id, id);
    const [source] = await db.select().from(netboxInventorySources).where(where);
    return source || undefined;
  }

  async createNetboxInventorySource(insertSource: InsertNetboxInventorySource): Promise<NetboxInventorySource> {
    const [source] = await db
      .insert(netboxInventorySources)
      .values(insertSource)
      .returning();
    return source;
  }

  async updateNetboxInventorySource(id: string, data: Partial<NetboxInventorySource>, orgId?: string | null): Promise<NetboxInventorySource | undefined> {
    const where = orgId ? and(eq(netboxInventorySources.id, id), eq(netboxInventorySources.orgId, orgId)) : eq(netboxInventorySources.id, id);
    const [updated] = await db.update(netboxInventorySources).set(data).where(where).returning();
    return updated || undefined;
  }

  async deleteNetboxInventorySource(id: string, orgId?: string | null): Promise<void> {
    const where = orgId ? and(eq(netboxInventorySources.id, id), eq(netboxInventorySources.orgId, orgId)) : eq(netboxInventorySources.id, id);
    await db.delete(netboxInventorySources).where(where);
  }

  // CMDB operations
  async getCmdbAccounts(orgId?: string | null): Promise<CmdbAccount[]> {
    if (orgId) {
      return await db.select().from(cmdbAccounts).where(eq(cmdbAccounts.orgId, orgId)).orderBy(desc(cmdbAccounts.createdAt));
    }
    return await db.select().from(cmdbAccounts).orderBy(desc(cmdbAccounts.createdAt));
  }

  async getCmdbAccount(id: string, orgId?: string | null): Promise<CmdbAccount | undefined> {
    const where = orgId ? and(eq(cmdbAccounts.id, id), eq(cmdbAccounts.orgId, orgId)) : eq(cmdbAccounts.id, id);
    const [account] = await db.select().from(cmdbAccounts).where(where);
    return account || undefined;
  }

  async createCmdbAccount(insertAccount: InsertCmdbAccount): Promise<CmdbAccount> {
    const [account] = await db
      .insert(cmdbAccounts)
      .values({ ...insertAccount, updatedAt: new Date() })
      .returning();
    return account;
  }

  async updateCmdbAccount(id: string, data: Partial<CmdbAccount>, orgId?: string | null): Promise<CmdbAccount | undefined> {
    const where = orgId ? and(eq(cmdbAccounts.id, id), eq(cmdbAccounts.orgId, orgId)) : eq(cmdbAccounts.id, id);
    const [updated] = await db.update(cmdbAccounts).set({ ...data, updatedAt: new Date() }).where(where).returning();
    return updated || undefined;
  }

  async deleteCmdbAccount(id: string, orgId?: string | null): Promise<void> {
    const where = orgId ? and(eq(cmdbAccounts.id, id), eq(cmdbAccounts.orgId, orgId)) : eq(cmdbAccounts.id, id);
    await db.delete(cmdbAccounts).where(where);
  }

  // Pipeline operations
  async getPipelines(orgId?: string | null): Promise<Pipeline[]> {
    if (orgId) {
      return await db.select().from(pipelines).where(eq(pipelines.orgId, orgId)).orderBy(desc(pipelines.createdAt));
    }
    return await db.select().from(pipelines).orderBy(desc(pipelines.createdAt));
  }

  async getPipeline(id: string, orgId?: string | null): Promise<Pipeline | undefined> {
    const where = orgId ? and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)) : eq(pipelines.id, id);
    const [pipeline] = await db.select().from(pipelines).where(where);
    return pipeline || undefined;
  }

  async createPipeline(insertPipeline: InsertPipeline): Promise<Pipeline> {
    const [pipeline] = await db
      .insert(pipelines)
      .values({ ...insertPipeline, updatedAt: new Date() })
      .returning();
    return pipeline;
  }

  async updatePipeline(id: string, data: Partial<Pipeline>, orgId?: string | null): Promise<Pipeline | undefined> {
    const where = orgId ? and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)) : eq(pipelines.id, id);
    const [updated] = await db.update(pipelines).set({ ...data, updatedAt: new Date() }).where(where).returning();
    return updated || undefined;
  }

  async deletePipeline(id: string, orgId?: string | null): Promise<void> {
    const where = orgId ? and(eq(pipelines.id, id), eq(pipelines.orgId, orgId)) : eq(pipelines.id, id);
    await db.delete(pipelines).where(where);
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

  async getPipelineRun(id: string): Promise<PipelineRun | undefined> {
    const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id));
    return run || undefined;
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

  // All pipeline runs (not filtered by pipeline)
  async getAllPipelineRuns(limit: number = 100): Promise<PipelineRun[]> {
    return await db
      .select()
      .from(pipelineRuns)
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(limit);
  }

  // All sync runs (not filtered by provider)
  async getAllSyncRuns(limit: number = 100): Promise<SyncRun[]> {
    return await db
      .select()
      .from(syncRuns)
      .orderBy(desc(syncRuns.createdAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
