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
  inventoryId: varchar("inventory_id").references(() => automationInventories.id, { onDelete: "set null" }),
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
  limitExpr: text("limit_expr"), // Host limit expression copied from template
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

// Provider Accounts (Azure, VMware, Proxmox, etc.)
export const providerAccounts = pgTable("provider_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(), // azure, vmware, proxmox
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  scheduleCron: text("schedule_cron"), // Cron expression for automatic sync
  config: jsonb("config").notNull().default({}), // Provider-specific configuration
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const providerAccountsRelations = relations(providerAccounts, ({ many }) => ({
  syncRuns: many(syncRuns),
  externalObjects: many(externalObjects),
  pipelines: many(pipelines),
}));

// Sync Runs (Provider sync execution history)
export const syncRuns = pgTable("sync_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerAccountId: varchar("provider_account_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("provider-sync"), // provider-sync
  status: text("status").notNull().default("queued"), // queued, running, ok, failed, error
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  counts: jsonb("counts").default({}), // {created, updated, unchanged, removed, errors}
  error: text("error"),
  logs: text("logs").default(""), // Full log output
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
  providerAccount: one(providerAccounts, {
    fields: [syncRuns.providerAccountId],
    references: [providerAccounts.id],
  }),
}));

// External Objects (cached provider objects and NetBox mapping)
export const externalObjects = pgTable("external_objects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerAccountId: varchar("provider_account_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  providerKind: text("provider_kind").notNull(),
  externalId: text("external_id").notNull(), // Provider's unique ID
  netboxType: text("netbox_type"), // e.g., virtualization.virtual_machines
  netboxId: integer("netbox_id"),
  cmdbRef: jsonb("cmdb_ref").default({}), // Reference to CMDB object(s)
  cachedPayload: jsonb("cached_payload").default({}),
  lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(),
}, (table) => ({
  uniqueProviderExternal: {
    columns: [table.providerAccountId, table.externalId],
    name: "unique_provider_external"
  },
}));

export const externalObjectsRelations = relations(externalObjects, ({ one }) => ({
  providerAccount: one(providerAccounts, {
    fields: [externalObjects.providerAccountId],
    references: [providerAccounts.id],
  }),
}));

// Group Cache (NetBox groups for autocomplete)
export const groupCache = pgTable("group_cache", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  kind: text("kind").notNull(), // site, device_role, tag, tenant
  name: text("name").notNull(),
  refreshedAt: timestamp("refreshed_at").notNull().defaultNow(),
});

export const groupCacheRelations = relations(groupCache, () => ({}));

// CMDB Accounts (NetBox, i-doit, ServiceNow targets)
export const cmdbAccounts = pgTable("cmdb_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(), // netbox, idoit, servicenow
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").notNull().default({}), // CMDB-specific configuration (url, token, etc.)
  lastValidatedAt: timestamp("last_validated_at"), // Last time connection was successfully validated
  cachedData: jsonb("cached_data").default({}), // Cached CMDB data from last successful validation
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cmdbAccountsRelations = relations(cmdbAccounts, ({ many }) => ({
  pipelines: many(pipelines),
}));

// Pipelines (RDP mapping configurations)
export const pipelines = pgTable("pipelines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  providerAccountId: varchar("provider_account_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  cmdbAccountId: varchar("cmdb_account_id").notNull().references(() => cmdbAccounts.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  version: integer("version").notNull().default(1),
  scheduleCron: text("schedule_cron"), // Optional cron expression
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  idxPipelineProvider: {
    columns: [table.providerAccountId],
    name: "idx_pipeline_provider"
  },
  idxPipelineCmdb: {
    columns: [table.cmdbAccountId],
    name: "idx_pipeline_cmdb"
  },
}));

export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  providerAccount: one(providerAccounts, {
    fields: [pipelines.providerAccountId],
    references: [providerAccounts.id],
  }),
  cmdbAccount: one(cmdbAccounts, {
    fields: [pipelines.cmdbAccountId],
    references: [cmdbAccounts.id],
  }),
  createdByUser: one(users, {
    fields: [pipelines.createdBy],
    references: [users.id],
  }),
  mappings: many(pipelineMappings),
  runs: many(pipelineRuns),
}));

// Pipeline Mappings (field transformation rules)
export const pipelineMappings = pgTable("pipeline_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pipelineId: varchar("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(), // e.g., "Vm", "Interface"
  targetType: text("target_type").notNull(), // e.g., "VirtualMachine", "Interface"
  rules: jsonb("rules").notNull().default({}), // Transformation rules
  status: text("status").notNull().default("draft"), // draft, active, disabled
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  idxMappingPipeline: {
    columns: [table.pipelineId],
    name: "idx_mapping_pipeline"
  },
}));

export const pipelineMappingsRelations = relations(pipelineMappings, ({ one }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineMappings.pipelineId],
    references: [pipelines.id],
  }),
}));

// Pipeline Runs (RDP sync execution history)
export const pipelineRuns = pgTable("pipeline_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pipelineId: varchar("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"), // queued, running, ok, failed
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  summary: jsonb("summary").default({}), // {created, updated, unchanged, removed, errors}
  logPath: text("log_path"), // Path to detailed log file
  logs: text("logs").default(""), // Full log output
  dryRun: boolean("dry_run").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  idxPipelineRunsPipeline: {
    columns: [table.pipelineId, table.startedAt],
    name: "idx_pipeline_runs_pipeline_started"
  },
}));

export const pipelineRunsRelations = relations(pipelineRuns, ({ one }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineRuns.pipelineId],
    references: [pipelines.id],
  }),
}));

// Automation Inventories - unified inventory sources for Ansible
export const automationInventories = pgTable("automation_inventories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(), // "linked", "file", "script"
  // For linked inventories
  sourceRef: varchar("source_ref"), // CMDB account ID
  sourceType: text("source_type"), // "netbox", "idoit", "servicenow"
  // For file-based inventories
  fileContent: text("file_content"),
  fileFormat: text("file_format"), // "yaml", "json", "ini"
  // Eligibility policy for gate rules (optional rules that can be enabled/disabled)
  // Core rules (tenant, automatable, provider_state, platform, ip) are always enforced
  eligibilityPolicy: jsonb("eligibility_policy").default({
    requireRole: false,       // Require NetBox Role assignment
    requireContacts: false,   // Require at least one contact assigned
  }),
  // Metadata
  isDefault: boolean("is_default").default(false),
  groupsCount: integer("groups_count").default(0),
  hostsCount: integer("hosts_count").default(0),
  lastRefreshedAt: timestamp("last_refreshed_at"),
  previewData: jsonb("preview_data").default({}), // Sample groups/hosts for preview
  cachedData: jsonb("cached_data").default({}), // Full cached inventory data (groups + hosts) from last successful refresh
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const automationInventoriesRelations = relations(automationInventories, ({ one }) => ({
  creator: one(users, {
    fields: [automationInventories.createdBy],
    references: [users.id],
  }),
}));

// NetBox Inventory Sources (multiple NetBox instances)
export const netboxInventorySources = pgTable("netbox_inventory_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  token: text("token").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastImportAt: timestamp("last_import_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const netboxInventorySourcesRelations = relations(netboxInventorySources, ({ many }) => ({
  vms: many(netboxVms),
}));

// NetBox VMs (imported from NetBox inventory)
export const netboxVms = pgTable("netbox_vms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").references(() => netboxInventorySources.id, { onDelete: "cascade" }), // Optional: which source imported this VM
  netboxId: integer("netbox_id").notNull(), // NetBox VM ID
  name: text("name").notNull(),
  ip: text("ip"), // Primary IP address (nullable)
  operatingSystem: text("operating_system"), // Linux/Windows/Other
  customFields: jsonb("custom_fields").default({}), // All custom fields from NetBox
  tags: text("tags").array().default([]), // Array of tag names
  lastImportedAt: timestamp("last_imported_at").notNull().defaultNow(),
}, (table) => ({
  uniqueSourceNetbox: {
    columns: [table.sourceId, table.netboxId],
    name: "unique_source_netbox"
  },
}));

export const netboxVmsRelations = relations(netboxVms, ({ one }) => ({
  source: one(netboxInventorySources, {
    fields: [netboxVms.sourceId],
    references: [netboxInventorySources.id],
  }),
}));

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

export const insertProviderAccountSchema = createInsertSchema(providerAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSyncRunSchema = createInsertSchema(syncRuns).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  logs: true,
});

export const insertExternalObjectSchema = createInsertSchema(externalObjects).omit({
  id: true,
  lastSyncedAt: true,
});

export const insertGroupCacheSchema = createInsertSchema(groupCache).omit({
  refreshedAt: true,
});

export const insertNetboxVmSchema = createInsertSchema(netboxVms).omit({
  id: true,
  lastImportedAt: true,
});

export const insertNetboxInventorySourceSchema = createInsertSchema(netboxInventorySources).omit({
  id: true,
  createdAt: true,
  lastImportAt: true,
});

export const insertCmdbAccountSchema = createInsertSchema(cmdbAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPipelineSchema = createInsertSchema(pipelines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  version: true,
});

export const insertPipelineMappingSchema = createInsertSchema(pipelineMappings).omit({
  id: true,
  updatedAt: true,
});

export const insertPipelineRunSchema = createInsertSchema(pipelineRuns).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  logs: true,
  logPath: true,
});

export const insertAutomationInventorySchema = createInsertSchema(automationInventories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastRefreshedAt: true,
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

export type InsertProviderAccount = z.infer<typeof insertProviderAccountSchema>;
export type ProviderAccount = typeof providerAccounts.$inferSelect;

export type InsertSyncRun = z.infer<typeof insertSyncRunSchema>;
export type SyncRun = typeof syncRuns.$inferSelect;

export type InsertExternalObject = z.infer<typeof insertExternalObjectSchema>;
export type ExternalObject = typeof externalObjects.$inferSelect;

export type InsertGroupCache = z.infer<typeof insertGroupCacheSchema>;
export type GroupCache = typeof groupCache.$inferSelect;

export type InsertNetboxVm = z.infer<typeof insertNetboxVmSchema>;
export type NetboxVm = typeof netboxVms.$inferSelect;

export type InsertNetboxInventorySource = z.infer<typeof insertNetboxInventorySourceSchema>;
export type NetboxInventorySource = typeof netboxInventorySources.$inferSelect;

export type InsertCmdbAccount = z.infer<typeof insertCmdbAccountSchema>;
export type CmdbAccount = typeof cmdbAccounts.$inferSelect;

export type InsertPipeline = z.infer<typeof insertPipelineSchema>;
export type Pipeline = typeof pipelines.$inferSelect;

export type InsertPipelineMapping = z.infer<typeof insertPipelineMappingSchema>;
export type PipelineMapping = typeof pipelineMappings.$inferSelect;

export type InsertPipelineRun = z.infer<typeof insertPipelineRunSchema>;
export type PipelineRun = typeof pipelineRuns.$inferSelect;

export type InsertAutomationInventory = z.infer<typeof insertAutomationInventorySchema>;
export type AutomationInventory = typeof automationInventories.$inferSelect;

// Eligibility Policy type for automation gate rules
export interface EligibilityPolicy {
  requireRole: boolean;       // Require NetBox Role assignment (optional)
  requireContacts: boolean;   // Require at least one contact assigned (optional)
}

// Provider Hints - non-authoritative metadata from providers
// These are stored for future use but MUST NOT affect gate decisions
export const providerHints = pgTable("provider_hints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerAccountId: varchar("provider_account_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  vmName: text("vm_name").notNull(),
  providerId: text("provider_id").notNull(), // External ID from provider
  hints: jsonb("hints").default({}), // ProviderHints object
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProviderHintsSchema = createInsertSchema(providerHints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProviderHints = z.infer<typeof insertProviderHintsSchema>;
export type ProviderHint = typeof providerHints.$inferSelect;

// Gate Decisions - authoritative decisions based on CMDB governance
// A VM is only automatable if allowed === true
export const gateDecisions = pgTable("gate_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vmName: text("vm_name").notNull().unique(),
  netboxVmId: integer("netbox_vm_id"), // Reference to NetBox VM
  allowed: boolean("allowed").notNull().default(false),
  missing: jsonb("missing").default([]), // Array of missing governance fields
  evaluatedAt: timestamp("evaluated_at").notNull().defaultNow(),
  cmdbAccountId: varchar("cmdb_account_id"),
  reason: text("reason"), // Human-readable explanation
});

export const insertGateDecisionSchema = createInsertSchema(gateDecisions).omit({
  id: true,
});

export type InsertGateDecision = z.infer<typeof insertGateDecisionSchema>;
export type GateDecision = typeof gateDecisions.$inferSelect;
