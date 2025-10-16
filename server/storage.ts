// Database storage implementation (from javascript_database blueprint)
import { 
  users, projects, credentials, jobTemplates, jobRuns, settings,
  type User, type InsertUser,
  type Project, type InsertProject,
  type Credential, type InsertCredential,
  type JobTemplate, type InsertJobTemplate,
  type JobRun, type InsertJobRun,
  type Setting, type InsertSetting,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

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
  deleteCredential(id: string): Promise<void>;

  // Job Template operations
  getJobTemplates(): Promise<JobTemplate[]>;
  getJobTemplate(id: string): Promise<JobTemplate | undefined>;
  createJobTemplate(template: InsertJobTemplate): Promise<JobTemplate>;
  deleteJobTemplate(id: string): Promise<void>;

  // Job Run operations
  getJobRuns(): Promise<JobRun[]>;
  getJobRun(id: string): Promise<JobRun | undefined>;
  createJobRun(run: InsertJobRun): Promise<JobRun>;
  updateJobRun(id: string, data: Partial<JobRun>): Promise<JobRun | undefined>;

  // Settings operations
  getSetting(key: string): Promise<Setting | undefined>;
  setSetting(key: string, value: string): Promise<Setting>;
  getAllSettings(): Promise<Setting[]>;
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
  async getJobRuns(): Promise<JobRun[]> {
    return await db.select().from(jobRuns).orderBy(desc(jobRuns.createdAt));
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
}

export const storage = new DatabaseStorage();
