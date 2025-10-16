import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table with role-based access control
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("viewer"), // admin, operator, viewer
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  jobRuns: many(jobRuns),
}));

// Projects (Git repositories with playbooks)
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  gitUrl: text("git_url").notNull(),
  gitRef: text("git_ref").notNull().default("main"),
  lastSyncAt: timestamp("last_sync_at"),
  playbooks: jsonb("playbooks").default([]), // Array of discovered playbook paths
  syncStatus: text("sync_status").default("pending"), // pending, syncing, success, error
  syncError: text("sync_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  jobTemplates: many(jobTemplates),
}));

// Credentials (mocked, no real secrets stored)
export const credentials = pgTable("credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // ssh_key, winrm, sudo, vault
  metadata: jsonb("metadata").default({}), // Non-secret metadata (username, etc.)
  secretRef: text("secret_ref"), // Placeholder for external secret reference
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const credentialsRelations = relations(credentials, ({ many }) => ({
  jobTemplates: many(jobTemplates),
}));

// Job Templates
export const jobTemplates = pgTable("job_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  playbook: text("playbook").notNull(),
  credentialId: varchar("credential_id").references(() => credentials.id, { onDelete: "set null" }),
  limitExpr: text("limit_expr"), // Host limit expression
  extraVars: jsonb("extra_vars").default({}), // JSON extra variables
  checkMode: boolean("check_mode").default(false),
  diffMode: boolean("diff_mode").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const jobTemplatesRelations = relations(jobTemplates, ({ one, many }) => ({
  project: one(projects, {
    fields: [jobTemplates.projectId],
    references: [projects.id],
  }),
  credential: one(credentials, {
    fields: [jobTemplates.credentialId],
    references: [credentials.id],
  }),
  jobRuns: many(jobRuns),
}));

// Job Runs with logs and results
export const jobRuns = pgTable("job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => jobTemplates.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"), // queued, running, ok, failed
  archived: boolean("archived").default(false),
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  logs: text("logs").default(""), // Full log output
  resultSummary: jsonb("result_summary").default({}), // JSON summary (hosts, tasks, ok/failed counts)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const jobRunsRelations = relations(jobRuns, ({ one }) => ({
  template: one(jobTemplates, {
    fields: [jobRuns.templateId],
    references: [jobTemplates.id],
  }),
  user: one(users, {
    fields: [jobRuns.userId],
    references: [users.id],
  }),
}));

// Settings (key-value pairs for NetBox config, etc.)
export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Notification Configurations
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(), // "email" or "webhook"
  enabled: boolean("enabled").notNull().default(true),
  // Trigger conditions
  onSuccess: boolean("on_success").notNull().default(false),
  onFailure: boolean("on_failure").notNull().default(true),
  templateIds: text("template_ids").array(), // null = all templates
  // Email specific
  emailTo: text("email_to"),
  emailSubject: text("email_subject"),
  emailBody: text("email_body"),
  // Webhook specific
  webhookUrl: text("webhook_url"),
  webhookMethod: text("webhook_method").default("POST"),
  webhookHeaders: jsonb("webhook_headers"),
  webhookBody: text("webhook_body"),
  webhookRetryCount: integer("webhook_retry_count").default(3),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notificationRelations = relations(notifications, () => ({}));

// Insert schemas for forms
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  lastSyncAt: true,
  playbooks: true,
  syncStatus: true,
  syncError: true,
});

export const insertCredentialSchema = createInsertSchema(credentials).omit({
  id: true,
  createdAt: true,
});

export const insertJobTemplateSchema = createInsertSchema(jobTemplates).omit({
  id: true,
  createdAt: true,
});

export const insertJobRunSchema = createInsertSchema(jobRuns).omit({
  id: true,
  createdAt: true,
  logs: true,
  resultSummary: true,
  startedAt: true,
  completedAt: true,
});

export const insertSettingSchema = createInsertSchema(settings).omit({
  id: true,
  updatedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export type InsertCredential = z.infer<typeof insertCredentialSchema>;
export type Credential = typeof credentials.$inferSelect;

export type InsertJobTemplate = z.infer<typeof insertJobTemplateSchema>;
export type JobTemplate = typeof jobTemplates.$inferSelect;

export type InsertJobRun = z.infer<typeof insertJobRunSchema>;
export type JobRun = typeof jobRuns.$inferSelect;

export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Setting = typeof settings.$inferSelect;

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;
