// Database storage implementation (from javascript_database blueprint)
import { 
  users, projects, credentials, jobTemplates, jobRuns, settings, notifications,
  providerAccounts, syncRuns, externalObjects, groupCache, netboxVms,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, lte, and, lt, sql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Project operations
  getProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;

  // Credential operations
  getCredentials(): Promise<Credential[]>;
  getCredential(id: string): Promise<Credential | undefined>;
  createCredential(credential: InsertCredential): Promise<Credential>;
  updateCredential(id: string, data: Partial<Credential>): Promise<Credential | undefined>;
  deleteCredential(id: string): Promise<void>;

  // Job Template operations
  getJobTemplates(): Promise<JobTemplate[]>;
  getJobTemplate(id: string): Promise<JobTemplate | undefined>;
  createJobTemplate(template: InsertJobTemplate): Promise<JobTemplate>;
  deleteJobTemplate(id: string): Promise<void>;

  // Job Run operations
  getJobRuns(filters?: any, page?: number, pageSize?: number): Promise<JobRun[]>;
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
  getProviders(): Promise<ProviderAccount[]>;
  getProvider(id: string): Promise<ProviderAccount | undefined>;
  createProvider(provider: InsertProviderAccount): Promise<ProviderAccount>;
  updateProvider(id: string, data: Partial<ProviderAccount>): Promise<ProviderAccount | undefined>;
  
  // Sync Run operations
  createSyncRun(run: InsertSyncRun): Promise<SyncRun>;
  getSyncRun(id: string): Promise<SyncRun | undefined>;
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
  deleteAllNetboxVms(): Promise<void>;
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
  async getProjects(): Promise<Project[]> {
    return await db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project || undefined;
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db
      .insert(projects)
      .values(insertProject)
      .returning();
    return project;
  }

  async updateProject(id: string, data: Partial<Project>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set(data)
      .where(eq(projects.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  // Credential operations
  async getCredentials(): Promise<Credential[]> {
    return await db.select().from(credentials).orderBy(desc(credentials.createdAt));
  }

  async getCredential(id: string): Promise<Credential | undefined> {
    const [credential] = await db.select().from(credentials).where(eq(credentials.id, id));
    return credential || undefined;
  }

  async createCredential(insertCredential: InsertCredential): Promise<Credential> {
    const [credential] = await db
      .insert(credentials)
      .values(insertCredential)
      .returning();
    return credential;
  }

  async updateCredential(id: string, data: Partial<Credential>): Promise<Credential | undefined> {
    const [updated] = await db
      .update(credentials)
      .set(data)
      .where(eq(credentials.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteCredential(id: string): Promise<void> {
    await db.delete(credentials).where(eq(credentials.id, id));
  }

  // Job Template operations
  async getJobTemplates(): Promise<JobTemplate[]> {
    return await db.select().from(jobTemplates).orderBy(desc(jobTemplates.createdAt));
  }

  async getJobTemplate(id: string): Promise<JobTemplate | undefined> {
    const [template] = await db.select().from(jobTemplates).where(eq(jobTemplates.id, id));
    return template || undefined;
  }

  async createJobTemplate(insertTemplate: InsertJobTemplate): Promise<JobTemplate> {
    const [template] = await db
      .insert(jobTemplates)
      .values(insertTemplate)
      .returning();
    return template;
  }

  async deleteJobTemplate(id: string): Promise<void> {
    await db.delete(jobTemplates).where(eq(jobTemplates.id, id));
  }

  // Job Run operations
  async getJobRuns(filters: any = {}, page: number = 1, pageSize: number = 50): Promise<JobRun[]> {
    let query = db.select().from(jobRuns);
    
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
  async getProviders(): Promise<ProviderAccount[]> {
    return await db.select().from(providerAccounts).orderBy(desc(providerAccounts.createdAt));
  }

  async getProvider(id: string): Promise<ProviderAccount | undefined> {
    const [provider] = await db.select().from(providerAccounts).where(eq(providerAccounts.id, id));
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

  async updateProvider(id: string, data: Partial<ProviderAccount>): Promise<ProviderAccount | undefined> {
    const [updated] = await db
      .update(providerAccounts)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(providerAccounts.id, id))
      .returning();
    return updated || undefined;
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
    const existing = await db.select().from(netboxVms).where(eq(netboxVms.netboxId, vm.netboxId));
    
    if (existing.length > 0) {
      // Update existing VM
      const [updated] = await db
        .update(netboxVms)
        .set({ ...vm, lastImportedAt: new Date() })
        .where(eq(netboxVms.netboxId, vm.netboxId))
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
}

export const storage = new DatabaseStorage();
