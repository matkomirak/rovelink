import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, boolean, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type {
  GovernanceBlueprintRules,
  GovernanceEvaluationResult,
  GovernanceFinding,
  RecommendedGovernanceAction,
} from "./governance";
export type {
  DataManagementMode,
  DataManagementRule,
  GovernanceBlueprintRules,
  GovernanceEvaluationResult,
  GovernanceFinding,
  OwnershipRole,
  OwnershipRule,
  RecommendedGovernanceAction,
  RelevanceRule,
} from "./governance";

export const customerScopeStrategyValues = [
  "tenant",
  "mandant",
  "domain",
  "organization",
  "company",
  "entity",
  "account",
  "customer",
  "custom_field",
  "tag",
  "manual",
] as const;

export const customerScopeIsolationValues = [
  "hard",
  "logical",
  "assignment",
  "custom",
] as const;

export const ciCustomerRelationshipValues = [
  "dedicated",
  "shared",
  "internal",
  "unassigned",
] as const;

export const customerScopeAssignmentDerivedFromValues = [
  "provider",
  "mapping_rule",
  "manual",
] as const;

export const customerScopeAssignmentConfidenceValues = [
  "authoritative",
  "mapped",
  "manual",
] as const;

export const infrastructureProviderTypeValues = [
  "azure",
  "proxmox",
  "vmware",
  "aws",
  "gcp",
  "fake",
] as const;

export const infrastructureObjectTypeValues = [
  "subscription",
  "resource_group",
  "vm",
  "network_interface",
  "vnet",
  "subnet",
  "disk",
  "public_ip",
  "cluster",
  "node",
  "template",
  "storage",
  "network_bridge",
  "pool",
  "tag",
  "vcenter",
  "datacenter",
  "host",
  "datastore",
  "network",
  "folder",
] as const;

export const providerCustomerScopeCandidateDerivedFromValues = [
  "tag",
  "label",
  "resource_group",
  "subscription",
  "folder",
  "pool",
  "project",
  "manual",
  "name_convention",
  "notes",
  "unknown",
] as const;

export const providerCustomerScopeCandidateConfidenceValues = [
  "authoritative",
  "high",
  "medium",
  "low",
  "unknown",
] as const;

export const driftRunStatusValues = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export const driftMatchStatusValues = [
  "matched",
  "unmatched_reference",
  "unmatched_provider",
  "ambiguous",
  "skipped",
  "error",
] as const;

export const driftStatusValues = [
  "no_drift",
  "drift",
  "unknown",
  "not_compared",
] as const;

export const driftSeverityValues = [
  "info",
  "warning",
  "critical",
] as const;

export const customerScopeStrategySchema = z.enum(customerScopeStrategyValues);
export const customerScopeIsolationSchema = z.enum(customerScopeIsolationValues);
export const ciCustomerRelationshipSchema = z.enum(ciCustomerRelationshipValues);
export const customerScopeAssignmentDerivedFromSchema = z.enum(customerScopeAssignmentDerivedFromValues);
export const customerScopeAssignmentConfidenceSchema = z.enum(customerScopeAssignmentConfidenceValues);
export const infrastructureProviderTypeSchema = z.enum(infrastructureProviderTypeValues);
export const infrastructureObjectTypeSchema = z.enum(infrastructureObjectTypeValues);
export const providerCustomerScopeCandidateDerivedFromSchema = z.enum(providerCustomerScopeCandidateDerivedFromValues);
export const providerCustomerScopeCandidateConfidenceSchema = z.enum(providerCustomerScopeCandidateConfidenceValues);
export const driftRunStatusSchema = z.enum(driftRunStatusValues);
export const driftMatchStatusSchema = z.enum(driftMatchStatusValues);
export const driftStatusSchema = z.enum(driftStatusValues);
export const driftSeveritySchema = z.enum(driftSeverityValues);

export type CustomerScopeStrategy = z.infer<typeof customerScopeStrategySchema>;
export type CustomerScopeIsolation = z.infer<typeof customerScopeIsolationSchema>;
export type CiCustomerRelationship = z.infer<typeof ciCustomerRelationshipSchema>;
export type CustomerScopeAssignmentDerivedFrom = z.infer<typeof customerScopeAssignmentDerivedFromSchema>;
export type CustomerScopeAssignmentConfidence = z.infer<typeof customerScopeAssignmentConfidenceSchema>;
export type InfrastructureProviderType = z.infer<typeof infrastructureProviderTypeSchema>;
export type InfrastructureObjectType = z.infer<typeof infrastructureObjectTypeSchema>;
export type ProviderCustomerScopeCandidateDerivedFrom = z.infer<typeof providerCustomerScopeCandidateDerivedFromSchema>;
export type ProviderCustomerScopeCandidateConfidence = z.infer<typeof providerCustomerScopeCandidateConfidenceSchema>;
export type DriftRunStatus = z.infer<typeof driftRunStatusSchema>;
export type DriftMatchStatus = z.infer<typeof driftMatchStatusSchema>;
export type DriftStatus = z.infer<typeof driftStatusSchema>;
export type DriftSeverity = z.infer<typeof driftSeveritySchema>;

// Organizations table for multi-tenancy
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("free"), // "free" | "pro" | "enterprise"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Users table with role-based access control
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("viewer"), // platform_admin, admin, operator, viewer
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  jobRuns: many(jobRuns),
}));

// Projects (Git repositories with playbooks)
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  gitUrl: text("git_url").notNull(),
  gitRef: text("git_ref").notNull().default("main"),
  lastSyncAt: timestamp("last_sync_at"),
  playbooks: jsonb("playbooks").default([]), // Array of discovered playbook paths
  syncStatus: text("sync_status").default("pending"), // pending, syncing, success, error
  syncError: text("sync_error"),
  // Server-managed path populated by real Git sync.
  checkoutPath: text("checkout_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projectsRelations = relations(projects, ({ many }) => ({
  jobTemplates: many(jobTemplates),
}));

// Credentials store non-secret metadata, optional encrypted secret material, and an external secret reference.
export const credentials = pgTable("credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // ssh_key, winrm, sudo, vault
  metadata: jsonb("metadata").default({}), // Non-secret metadata (username, etc.)
  secretConfig: jsonb("secret_config").default({}), // Encrypted secret material only; never returned to clients
  secretRef: text("secret_ref"), // Placeholder for external secret reference
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const credentialsRelations = relations(credentials, ({ many }) => ({
  jobTemplates: many(jobTemplates),
}));

// Job Templates
export const jobTemplates = pgTable("job_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  playbook: text("playbook").notNull(),
  credentialId: varchar("credential_id").references(() => credentials.id, { onDelete: "set null" }),
  inventoryId: varchar("inventory_id").references(() => automationInventories.id, { onDelete: "set null" }),
  limitExpr: text("limit_expr"), // Host limit expression
  extraVars: jsonb("extra_vars").default({}), // JSON extra variables
  checkMode: boolean("check_mode").default(false),
  diffMode: boolean("diff_mode").default(false),
  runnerMode: text("runner_mode").notNull().default("local"), // "local" | "awx"
  awxTemplateId: integer("awx_template_id"),
  awxInventoryId: integer("awx_inventory_id"),
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
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
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
  gateSnapshot: jsonb("gate_snapshot").default(null), // Gate decisions computed at run preparation time
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
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
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
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
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

// Infrastructure Objects represent observed runtime inventory from provider sources.
// They are separate from CMDB/reference objects and must not be used as GATE authority.
export const infrastructureObjects = pgTable("infrastructure_objects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  providerType: text("provider_type").$type<InfrastructureProviderType>().notNull(),
  objectType: text("object_type").notNull(),
  externalId: text("external_id").notNull(),
  providerNativeId: text("provider_native_id"),
  name: text("name"),
  displayName: text("display_name"),
  region: text("region"),
  zone: text("zone"),
  cluster: text("cluster"),
  node: text("node"),
  lifecycleState: text("lifecycle_state"),
  powerState: text("power_state"),
  tags: jsonb("tags").$type<unknown[] | Record<string, unknown>>().notNull().default([]),
  labels: jsonb("labels").$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  raw: jsonb("raw").$type<Record<string, unknown> | null>().default(null),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueInfrastructureObjectExternal: uniqueIndex("unique_infrastructure_object_external").on(
    table.orgId,
    table.sourceId,
    table.objectType,
    table.externalId,
  ),
  idxInfrastructureObjectsOrg: index("idx_infrastructure_objects_org").on(table.orgId),
  idxInfrastructureObjectsSource: index("idx_infrastructure_objects_source").on(table.sourceId),
  idxInfrastructureObjectsProviderType: index("idx_infrastructure_objects_provider_type").on(table.providerType),
  idxInfrastructureObjectsObjectType: index("idx_infrastructure_objects_object_type").on(table.objectType),
  idxInfrastructureObjectsExternalId: index("idx_infrastructure_objects_external_id").on(table.externalId),
  idxInfrastructureObjectsOrgSourceType: index("idx_infrastructure_objects_org_source_type").on(table.orgId, table.sourceId, table.objectType),
}));

export const infrastructureRelationships = pgTable("infrastructure_relationships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  fromObjectId: varchar("from_object_id").notNull().references(() => infrastructureObjects.id, { onDelete: "cascade" }),
  toObjectId: varchar("to_object_id").notNull().references(() => infrastructureObjects.id, { onDelete: "cascade" }),
  relationshipType: text("relationship_type").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueInfrastructureRelationship: uniqueIndex("unique_infrastructure_relationship").on(
    table.orgId,
    table.sourceId,
    table.fromObjectId,
    table.toObjectId,
    table.relationshipType,
  ),
  idxInfrastructureRelationshipsOrg: index("idx_infrastructure_relationships_org").on(table.orgId),
  idxInfrastructureRelationshipsSource: index("idx_infrastructure_relationships_source").on(table.sourceId),
  idxInfrastructureRelationshipsFrom: index("idx_infrastructure_relationships_from").on(table.fromObjectId),
  idxInfrastructureRelationshipsTo: index("idx_infrastructure_relationships_to").on(table.toObjectId),
  idxInfrastructureRelationshipsType: index("idx_infrastructure_relationships_type").on(table.relationshipType),
}));

export const providerCustomerScopeCandidates = pgTable("provider_customer_scope_candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  objectId: varchar("object_id").notNull().references(() => infrastructureObjects.id, { onDelete: "cascade" }),
  derivedFrom: text("derived_from").$type<ProviderCustomerScopeCandidateDerivedFrom>().notNull(),
  candidateValue: text("candidate_value").notNull(),
  confidence: text("confidence").$type<ProviderCustomerScopeCandidateConfidence>().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueProviderCustomerScopeCandidate: uniqueIndex("unique_provider_customer_scope_candidate").on(
    table.orgId,
    table.sourceId,
    table.objectId,
    table.derivedFrom,
    table.candidateValue,
  ),
  idxProviderCustomerScopeCandidatesOrg: index("idx_provider_customer_scope_candidates_org").on(table.orgId),
  idxProviderCustomerScopeCandidatesSource: index("idx_provider_customer_scope_candidates_source").on(table.sourceId),
  idxProviderCustomerScopeCandidatesObject: index("idx_provider_customer_scope_candidates_object").on(table.objectId),
  idxProviderCustomerScopeCandidatesDerivedFrom: index("idx_provider_customer_scope_candidates_derived_from").on(table.derivedFrom),
  idxProviderCustomerScopeCandidatesConfidence: index("idx_provider_customer_scope_candidates_confidence").on(table.confidence),
}));

export const infrastructureObjectsRelations = relations(infrastructureObjects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [infrastructureObjects.orgId],
    references: [organizations.id],
  }),
  source: one(providerAccounts, {
    fields: [infrastructureObjects.sourceId],
    references: [providerAccounts.id],
  }),
  outgoingRelationships: many(infrastructureRelationships, { relationName: "fromInfrastructureObject" }),
  incomingRelationships: many(infrastructureRelationships, { relationName: "toInfrastructureObject" }),
  customerScopeCandidates: many(providerCustomerScopeCandidates),
}));

export const infrastructureRelationshipsRelations = relations(infrastructureRelationships, ({ one }) => ({
  organization: one(organizations, {
    fields: [infrastructureRelationships.orgId],
    references: [organizations.id],
  }),
  source: one(providerAccounts, {
    fields: [infrastructureRelationships.sourceId],
    references: [providerAccounts.id],
  }),
  fromObject: one(infrastructureObjects, {
    fields: [infrastructureRelationships.fromObjectId],
    references: [infrastructureObjects.id],
    relationName: "fromInfrastructureObject",
  }),
  toObject: one(infrastructureObjects, {
    fields: [infrastructureRelationships.toObjectId],
    references: [infrastructureObjects.id],
    relationName: "toInfrastructureObject",
  }),
}));

export const providerCustomerScopeCandidatesRelations = relations(providerCustomerScopeCandidates, ({ one }) => ({
  organization: one(organizations, {
    fields: [providerCustomerScopeCandidates.orgId],
    references: [organizations.id],
  }),
  source: one(providerAccounts, {
    fields: [providerCustomerScopeCandidates.sourceId],
    references: [providerAccounts.id],
  }),
  object: one(infrastructureObjects, {
    fields: [providerCustomerScopeCandidates.objectId],
    references: [infrastructureObjects.id],
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
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
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
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
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
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
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
    governance: {
      mode: "observe_only",
      requireGovernanceEvaluation: false,
      minimumGovernanceScore: null,
      blockOnRecommendedAction: true,
      allowedReadinessStates: ["ready"],
    },
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
  orgId: varchar("org_id").references(() => organizations.id, { onDelete: "cascade" }),
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

// CustomerScopes represent provider-neutral customer/environment boundaries inside CMDB sources.
// They are separate from Rovelink application organizations, which remain the security boundary.
export const customerScopes = pgTable("customer_scopes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: varchar("source_id").notNull(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  displayName: text("display_name"),
  strategy: text("strategy").$type<CustomerScopeStrategy>().notNull(),
  isolation: text("isolation").$type<CustomerScopeIsolation>(),
  parentExternalId: text("parent_external_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>().default(null),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueCustomerScopeExternal: uniqueIndex("unique_customer_scope_external").on(
    table.orgId,
    table.sourceType,
    table.sourceId,
    table.externalId,
  ),
  idxCustomerScopesOrgSource: index("idx_customer_scopes_org_source").on(table.orgId, table.sourceType, table.sourceId),
}));

export const customerScopeObjectAssignments = pgTable("customer_scope_object_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: varchar("source_id").notNull(),
  objectType: text("object_type").notNull(),
  objectId: varchar("object_id").notNull(),
  customerScopeId: varchar("customer_scope_id").references(() => customerScopes.id, { onDelete: "set null" }),
  relationship: text("relationship").$type<CiCustomerRelationship>().notNull(),
  derivedFrom: text("derived_from").$type<CustomerScopeAssignmentDerivedFrom>().notNull(),
  confidence: text("confidence").$type<CustomerScopeAssignmentConfidence>().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>().default(null),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueCustomerScopeObjectAssignment: uniqueIndex("unique_customer_scope_object_assignment").on(
    table.orgId,
    table.sourceType,
    table.sourceId,
    table.objectType,
    table.objectId,
    sql`coalesce(customer_scope_id, '__unassigned__')`,
    table.relationship,
  ),
  idxCustomerScopeAssignmentsOrgObject: index("idx_customer_scope_assignments_org_object").on(
    table.orgId,
    table.sourceType,
    table.sourceId,
    table.objectType,
    table.objectId,
  ),
  idxCustomerScopeAssignmentsOrgScope: index("idx_customer_scope_assignments_org_scope").on(table.orgId, table.customerScopeId),
}));

export const customerScopesRelations = relations(customerScopes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [customerScopes.orgId],
    references: [organizations.id],
  }),
  assignments: many(customerScopeObjectAssignments),
}));

export const customerScopeObjectAssignmentsRelations = relations(customerScopeObjectAssignments, ({ one }) => ({
  organization: one(organizations, {
    fields: [customerScopeObjectAssignments.orgId],
    references: [organizations.id],
  }),
  customerScope: one(customerScopes, {
    fields: [customerScopeObjectAssignments.customerScopeId],
    references: [customerScopes.id],
  }),
}));

// Drift Comparison Runs compare documented CMDB/reference state with observed provider/runtime state.
// They are analytical/reporting records only and must not modify CMDB, providers, CustomerScopes, Governance, or GATE behavior.
export const driftComparisonRuns = pgTable("drift_comparison_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  cmdbSourceId: varchar("cmdb_source_id").notNull().references(() => cmdbAccounts.id, { onDelete: "cascade" }),
  providerSourceId: varchar("provider_source_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  objectType: text("object_type").notNull(),
  status: text("status").$type<DriftRunStatus>().notNull().default("pending"),
  counts: jsonb("counts").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  idxDriftRunsOrg: index("idx_drift_runs_org").on(table.orgId),
  idxDriftRunsCmdbSource: index("idx_drift_runs_cmdb_source").on(table.cmdbSourceId),
  idxDriftRunsProviderSource: index("idx_drift_runs_provider_source").on(table.providerSourceId),
  idxDriftRunsObjectType: index("idx_drift_runs_object_type").on(table.objectType),
  idxDriftRunsStatus: index("idx_drift_runs_status").on(table.status),
  idxDriftRunsCreatedAt: index("idx_drift_runs_created_at").on(table.createdAt),
  idxDriftRunsOrgSourceObjectCreated: index("idx_drift_runs_org_source_object_created").on(
    table.orgId,
    table.cmdbSourceId,
    table.providerSourceId,
    table.objectType,
    table.createdAt,
  ),
}));

export const driftComparisonItems = pgTable("drift_comparison_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runId: varchar("run_id").notNull().references(() => driftComparisonRuns.id, { onDelete: "cascade" }),
  cmdbSourceId: varchar("cmdb_source_id").notNull().references(() => cmdbAccounts.id, { onDelete: "cascade" }),
  providerSourceId: varchar("provider_source_id").notNull().references(() => providerAccounts.id, { onDelete: "cascade" }),
  objectType: text("object_type").notNull(),
  referenceObjectId: varchar("reference_object_id"),
  providerObjectId: varchar("provider_object_id"),
  matchStatus: text("match_status").$type<DriftMatchStatus>().notNull(),
  matchConfidence: text("match_confidence"),
  matchReason: text("match_reason"),
  driftStatus: text("drift_status").$type<DriftStatus>().notNull(),
  driftSeverity: text("drift_severity").$type<DriftSeverity>().notNull(),
  fieldDiffs: jsonb("field_diffs").$type<unknown[]>().notNull().default([]),
  findings: jsonb("findings").$type<unknown[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ignoredAt: timestamp("ignored_at"),
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: varchar("accepted_by").references(() => users.id, { onDelete: "set null" }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  idxDriftItemsOrg: index("idx_drift_items_org").on(table.orgId),
  idxDriftItemsRun: index("idx_drift_items_run").on(table.runId),
  idxDriftItemsCmdbSource: index("idx_drift_items_cmdb_source").on(table.cmdbSourceId),
  idxDriftItemsProviderSource: index("idx_drift_items_provider_source").on(table.providerSourceId),
  idxDriftItemsObjectType: index("idx_drift_items_object_type").on(table.objectType),
  idxDriftItemsReferenceObject: index("idx_drift_items_reference_object").on(table.referenceObjectId),
  idxDriftItemsProviderObject: index("idx_drift_items_provider_object").on(table.providerObjectId),
  idxDriftItemsMatchStatus: index("idx_drift_items_match_status").on(table.matchStatus),
  idxDriftItemsDriftStatus: index("idx_drift_items_drift_status").on(table.driftStatus),
  idxDriftItemsDriftSeverity: index("idx_drift_items_drift_severity").on(table.driftSeverity),
  idxDriftItemsRunMatchStatus: index("idx_drift_items_run_match_status").on(table.runId, table.matchStatus),
  idxDriftItemsRunDriftStatus: index("idx_drift_items_run_drift_status").on(table.runId, table.driftStatus),
  idxDriftItemsOrgSourceObject: index("idx_drift_items_org_source_object").on(
    table.orgId,
    table.cmdbSourceId,
    table.providerSourceId,
    table.objectType,
  ),
}));

export const driftComparisonRunsRelations = relations(driftComparisonRuns, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [driftComparisonRuns.orgId],
    references: [organizations.id],
  }),
  cmdbSource: one(cmdbAccounts, {
    fields: [driftComparisonRuns.cmdbSourceId],
    references: [cmdbAccounts.id],
  }),
  providerSource: one(providerAccounts, {
    fields: [driftComparisonRuns.providerSourceId],
    references: [providerAccounts.id],
  }),
  items: many(driftComparisonItems),
}));

export const driftComparisonItemsRelations = relations(driftComparisonItems, ({ one }) => ({
  organization: one(organizations, {
    fields: [driftComparisonItems.orgId],
    references: [organizations.id],
  }),
  run: one(driftComparisonRuns, {
    fields: [driftComparisonItems.runId],
    references: [driftComparisonRuns.id],
  }),
  cmdbSource: one(cmdbAccounts, {
    fields: [driftComparisonItems.cmdbSourceId],
    references: [cmdbAccounts.id],
  }),
  providerSource: one(providerAccounts, {
    fields: [driftComparisonItems.providerSourceId],
    references: [providerAccounts.id],
  }),
  accepter: one(users, {
    fields: [driftComparisonItems.acceptedBy],
    references: [users.id],
  }),
}));

// Governance Blueprints - versioned CMDB governance policy definitions.
export const governanceBlueprints = pgTable("governance_blueprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  objectType: text("object_type").notNull(),
  sourceType: text("source_type"),
  sourceId: varchar("source_id"),
  status: text("status").notNull().default("draft"), // draft, active, archived
  activeVersionId: varchar("active_version_id"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  idxGovernanceBlueprintsOrgObjectType: index("idx_governance_blueprints_org_object_type").on(table.orgId, table.objectType),
  idxGovernanceBlueprintsOrgObjectSource: index("idx_governance_blueprints_org_object_source").on(table.orgId, table.objectType, table.sourceType, table.sourceId),
}));

export const governanceBlueprintVersions = pgTable("governance_blueprint_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  blueprintId: varchar("blueprint_id").notNull().references(() => governanceBlueprints.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  rules: jsonb("rules").$type<GovernanceBlueprintRules>().notNull(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueBlueprintVersion: uniqueIndex("unique_governance_blueprint_version").on(table.blueprintId, table.version),
}));

export const governanceEvaluationRuns = pgTable("governance_evaluation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  blueprintId: varchar("blueprint_id").notNull().references(() => governanceBlueprints.id, { onDelete: "cascade" }),
  blueprintVersionId: varchar("blueprint_version_id").notNull().references(() => governanceBlueprintVersions.id, { onDelete: "cascade" }),
  cmdbAccountId: varchar("cmdb_account_id").references(() => cmdbAccounts.id, { onDelete: "set null" }),
  netboxSourceId: varchar("netbox_source_id").references(() => netboxInventorySources.id, { onDelete: "set null" }),
  status: text("status").notNull().default("queued"), // queued, running, ok, failed
  counts: jsonb("counts").default({}),
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  idxGovernanceEvaluationRunsOrgCreated: index("idx_governance_evaluation_runs_org_created").on(table.orgId, table.createdAt),
}));

export const governanceObjectEvaluations = pgTable("governance_object_evaluations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runId: varchar("run_id").notNull().references(() => governanceEvaluationRuns.id, { onDelete: "cascade" }),
  blueprintId: varchar("blueprint_id").notNull().references(() => governanceBlueprints.id, { onDelete: "cascade" }),
  blueprintVersionId: varchar("blueprint_version_id").notNull().references(() => governanceBlueprintVersions.id, { onDelete: "cascade" }),
  objectType: text("object_type").notNull(),
  objectId: varchar("object_id"),
  externalId: text("external_id"),
  objectName: text("object_name"),
  governanceScore: integer("governance_score").notNull(),
  dataManagementScore: integer("data_management_score").notNull(),
  ownershipScore: integer("ownership_score").notNull(),
  relevanceWeightedPriority: integer("relevance_weighted_priority").notNull(),
  automationReady: boolean("automation_ready").notNull().default(false),
  findings: jsonb("findings").$type<GovernanceFinding[]>().notNull().default([]),
  recommendedActions: jsonb("recommended_actions").$type<RecommendedGovernanceAction[]>().notNull().default([]),
  result: jsonb("result").$type<GovernanceEvaluationResult>().notNull(),
  objectSnapshot: jsonb("object_snapshot").default({}),
  evaluatedAt: timestamp("evaluated_at").notNull().defaultNow(),
}, (table) => ({
  idxGovernanceObjectEvaluationsOrgRunEvaluated: index("idx_governance_object_evaluations_org_run_evaluated").on(table.orgId, table.runId, table.evaluatedAt),
}));

export const governanceBlueprintsRelations = relations(governanceBlueprints, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [governanceBlueprints.orgId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [governanceBlueprints.createdBy],
    references: [users.id],
  }),
  versions: many(governanceBlueprintVersions),
  evaluationRuns: many(governanceEvaluationRuns),
}));

export const governanceBlueprintVersionsRelations = relations(governanceBlueprintVersions, ({ one, many }) => ({
  blueprint: one(governanceBlueprints, {
    fields: [governanceBlueprintVersions.blueprintId],
    references: [governanceBlueprints.id],
  }),
  creator: one(users, {
    fields: [governanceBlueprintVersions.createdBy],
    references: [users.id],
  }),
  evaluationRuns: many(governanceEvaluationRuns),
}));

export const governanceEvaluationRunsRelations = relations(governanceEvaluationRuns, ({ one, many }) => ({
  blueprint: one(governanceBlueprints, {
    fields: [governanceEvaluationRuns.blueprintId],
    references: [governanceBlueprints.id],
  }),
  blueprintVersion: one(governanceBlueprintVersions, {
    fields: [governanceEvaluationRuns.blueprintVersionId],
    references: [governanceBlueprintVersions.id],
  }),
  cmdbAccount: one(cmdbAccounts, {
    fields: [governanceEvaluationRuns.cmdbAccountId],
    references: [cmdbAccounts.id],
  }),
  netboxSource: one(netboxInventorySources, {
    fields: [governanceEvaluationRuns.netboxSourceId],
    references: [netboxInventorySources.id],
  }),
  objectEvaluations: many(governanceObjectEvaluations),
}));

export const governanceObjectEvaluationsRelations = relations(governanceObjectEvaluations, ({ one }) => ({
  run: one(governanceEvaluationRuns, {
    fields: [governanceObjectEvaluations.runId],
    references: [governanceEvaluationRuns.id],
  }),
  blueprint: one(governanceBlueprints, {
    fields: [governanceObjectEvaluations.blueprintId],
    references: [governanceBlueprints.id],
  }),
  blueprintVersion: one(governanceBlueprintVersions, {
    fields: [governanceObjectEvaluations.blueprintVersionId],
    references: [governanceBlueprintVersions.id],
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
  checkoutPath: true,
});

export const insertCredentialSchema = createInsertSchema(credentials).omit({
  id: true,
  secretConfig: true,
  createdAt: true,
  updatedAt: true,
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

export const insertInfrastructureObjectSchema = createInsertSchema(infrastructureObjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  providerType: infrastructureProviderTypeSchema,
});

export const insertInfrastructureRelationshipSchema = createInsertSchema(infrastructureRelationships).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProviderCustomerScopeCandidateSchema = createInsertSchema(providerCustomerScopeCandidates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  derivedFrom: providerCustomerScopeCandidateDerivedFromSchema,
  confidence: providerCustomerScopeCandidateConfidenceSchema,
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

export const insertGovernanceBlueprintSchema = createInsertSchema(governanceBlueprints).omit({
  id: true,
  activeVersionId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGovernanceBlueprintVersionSchema = createInsertSchema(governanceBlueprintVersions).omit({
  id: true,
  createdAt: true,
});

export const insertGovernanceEvaluationRunSchema = createInsertSchema(governanceEvaluationRuns).omit({
  id: true,
  createdAt: true,
});

export const insertGovernanceObjectEvaluationSchema = createInsertSchema(governanceObjectEvaluations).omit({
  id: true,
  evaluatedAt: true,
});

export const insertCustomerScopeSchema = createInsertSchema(customerScopes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  strategy: customerScopeStrategySchema,
  isolation: customerScopeIsolationSchema.nullable().optional(),
});

export const insertCustomerScopeObjectAssignmentSchema = createInsertSchema(customerScopeObjectAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  relationship: ciCustomerRelationshipSchema,
  derivedFrom: customerScopeAssignmentDerivedFromSchema,
  confidence: customerScopeAssignmentConfidenceSchema,
});

export const insertDriftComparisonRunSchema = createInsertSchema(driftComparisonRuns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: driftRunStatusSchema.optional(),
});

export const insertDriftComparisonItemSchema = createInsertSchema(driftComparisonItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  matchStatus: driftMatchStatusSchema,
  driftStatus: driftStatusSchema,
  driftSeverity: driftSeveritySchema,
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

export type InsertInfrastructureObject = typeof infrastructureObjects.$inferInsert;
export type InfrastructureObject = typeof infrastructureObjects.$inferSelect;

export type InsertInfrastructureRelationship = typeof infrastructureRelationships.$inferInsert;
export type InfrastructureRelationship = typeof infrastructureRelationships.$inferSelect;

export type InsertProviderCustomerScopeCandidate = typeof providerCustomerScopeCandidates.$inferInsert;
export type ProviderCustomerScopeCandidate = typeof providerCustomerScopeCandidates.$inferSelect;

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

export type InsertGovernanceBlueprint = typeof governanceBlueprints.$inferInsert;
export type GovernanceBlueprint = typeof governanceBlueprints.$inferSelect;

export type InsertGovernanceBlueprintVersion = typeof governanceBlueprintVersions.$inferInsert;
export type GovernanceBlueprintVersion = typeof governanceBlueprintVersions.$inferSelect;

export type InsertGovernanceEvaluationRun = typeof governanceEvaluationRuns.$inferInsert;
export type GovernanceEvaluationRun = typeof governanceEvaluationRuns.$inferSelect;

export type InsertGovernanceObjectEvaluation = typeof governanceObjectEvaluations.$inferInsert;
export type GovernanceObjectEvaluation = typeof governanceObjectEvaluations.$inferSelect;

export type InsertCustomerScope = typeof customerScopes.$inferInsert;
export type CustomerScope = typeof customerScopes.$inferSelect;

export type InsertCustomerScopeObjectAssignment = typeof customerScopeObjectAssignments.$inferInsert;
export type CustomerScopeObjectAssignment = typeof customerScopeObjectAssignments.$inferSelect;

export type InsertDriftComparisonRun = typeof driftComparisonRuns.$inferInsert;
export type DriftComparisonRun = typeof driftComparisonRuns.$inferSelect;

export type InsertDriftComparisonItem = typeof driftComparisonItems.$inferInsert;
export type DriftComparisonItem = typeof driftComparisonItems.$inferSelect;

export const governanceEnforcementModeSchema = z.enum(["observe_only", "warn_only", "enforce"]);
export const governanceReadinessStateSchema = z.enum(["ready", "not_ready"]);

export const governanceEnforcementPolicySchema = z.object({
  mode: governanceEnforcementModeSchema.default("observe_only"),
  requireGovernanceEvaluation: z.boolean().default(false),
  minimumGovernanceScore: z.number().min(0).max(100).nullable().default(null),
  blockOnRecommendedAction: z.boolean().default(true),
  allowedReadinessStates: z.array(governanceReadinessStateSchema).nonempty().default(["ready"]),
}).strict();

export const governanceEnforcementPolicyPatchSchema = governanceEnforcementPolicySchema.partial().strict();

export const DEFAULT_GOVERNANCE_ENFORCEMENT_POLICY: GovernanceEnforcementPolicy = {
  mode: "observe_only",
  requireGovernanceEvaluation: false,
  minimumGovernanceScore: null,
  blockOnRecommendedAction: true,
  allowedReadinessStates: ["ready"],
};

export const eligibilityPolicySchema = z.object({
  requireRole: z.boolean().default(false),
  requireContacts: z.boolean().default(false),
  governance: governanceEnforcementPolicySchema.default(DEFAULT_GOVERNANCE_ENFORCEMENT_POLICY),
}).strict();

export const eligibilityPolicyPatchSchema = z.object({
  requireRole: z.boolean().optional(),
  requireContacts: z.boolean().optional(),
  governance: governanceEnforcementPolicyPatchSchema.optional(),
}).strict();

export type GovernanceEnforcementMode = z.infer<typeof governanceEnforcementModeSchema>;
export type GovernanceReadinessState = z.infer<typeof governanceReadinessStateSchema>;
export type GovernanceEnforcementPolicy = z.infer<typeof governanceEnforcementPolicySchema>;
export type EligibilityPolicy = z.infer<typeof eligibilityPolicySchema>;

export function normalizeEligibilityPolicy(policy: unknown): EligibilityPolicy {
  return eligibilityPolicySchema.parse(policy ?? {});
}

export function mergeEligibilityPolicyPatch(existingPolicy: unknown, patch: unknown): EligibilityPolicy {
  const existing = normalizeEligibilityPolicy(existingPolicy);
  const parsedPatch = eligibilityPolicyPatchSchema.parse(patch);

  return normalizeEligibilityPolicy({
    ...existing,
    ...parsedPatch,
    governance: parsedPatch.governance
      ? {
          ...existing.governance,
          ...parsedPatch.governance,
        }
      : existing.governance,
  });
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

// Organization insert schema and types
export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
});
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;
