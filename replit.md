# Bridge - Infrastructure Automation Platform

## Overview
Bridge is a full-stack infrastructure automation UI designed to streamline IT operations. It integrates with NetBox for inventory management, provides tools for defining and managing job templates, and orchestrates the execution of simulated Ansible playbooks. The platform offers real-time log streaming for job runs, comprehensive reporting, and a robust provider system for collecting and synchronizing VM inventory from various virtualization platforms into NetBox. Its core purpose is to provide a centralized, user-friendly interface for managing infrastructure automation workflows, enhancing operational efficiency, and improving visibility into IT assets. The platform also includes functionality for defining and executing data pipelines between various sources and CMDBs.

## User Preferences
I prefer that the agent focuses on high-level feature implementation and architectural decisions rather than getting bogged down in minute code details. When proposing changes, please outline the approach and impact first. I appreciate clear, concise communication and a systematic approach to problem-solving. I prefer iterative development, where features are built out step-by-step, allowing for feedback and adjustments along the way. Do not make changes to files or folders without explicit instructions.

## System Architecture
Bridge is built with a modern web stack: React 18 + TypeScript + Tailwind CSS + Shadcn UI for the frontend, Express.js + TypeScript for the backend, and PostgreSQL (via Neon serverless) with Drizzle ORM for data persistence. Real-time communication for log streaming is handled via WebSockets. Authentication is JWT-based, and external integration includes the NetBox REST API for inventory data.

### Fake Provider System
Bridge includes a **Fake Provider** feature for testing and development without requiring real infrastructure. The fake provider generates deterministic, provider-shaped VM data using a seeded PRNG (mulberry32), supporting four variants (Proxmox, vSphere, Azure, AWS). This enables full pipeline testing including discovery, mapping, dry-run, and sync operations with NetBox/i-doit targets.

**UI/UX Decisions:**
The UI follows a dark-first design principle using the Inter font family for UI elements and JetBrains Mono for code/logs. It features a professional aesthetic with a primary blue color palette, semantic colors for status, dark slate backgrounds, and elevated card elements. Typography is clearly defined, and reusable UI components include sidebar navigation, cards, sticky-header tables, a dark monospace log console, status badges, and skeleton loading states.

**Technical Implementations & Feature Specifications:**
- **Authentication & Authorization:** JWT-based user authentication with bcrypt for passwords and role-based access control (admin, operator, viewer).
- **NetBox Integration:** Read-only access to NetBox inventory, including group/host browsing, preflight validation for limit expressions, and inventory health reporting. Supports importing VMs from NetBox with detailed metadata, OS normalization, and custom field/tag capture. Multi-source NetBox inventory management is supported.
- **Project Management:** CRUD operations for Git repositories, with mocked sync for playbook discovery.
- **Credentials Management:** CRUD for mock credential references (SSH key, WinRM, sudo, vault types) storing non-secret metadata.
- **Job Templates:** Creation of templates linked to projects, playbooks, and credentials, supporting limit expressions, extra variables, check mode, and diff mode. Templates can be launched immediately or scheduled.
- **Job Runs:** Simulated Ansible execution (FakeRunner) with real-time log streaming via WebSockets, persistent logs, and CSV export.
- **Unified Runs View:** Consolidated view of all execution types (playbook runs, pipeline syncs, provider syncs) with color-coded badges, source names, summary statistics, and clickable navigation to detailed log views.
- **Scheduling:** Deferred execution via `scheduledAt` timestamps, with simplified background triggering.
- **Reports Dashboard:** Widgets for inventory health (coverage, IP/user counts) and run statistics (success rate, failures).
- **Notifications:** Configurable email and webhook notifications with trigger conditions, variable interpolation, retry logic, and custom headers/body.
- **Provider System:** Extensible factory pattern for integrating various virtualization providers (e.g., Proxmox, Fake) to collect, normalize, and upsert VM inventory into NetBox. Includes provider account management, sync workers, external object mapping, sync run history, and housekeeping.
  - **Fake Provider:** Deterministic VM generator with configurable variants (Proxmox, vSphere, Azure, AWS), seeded PRNG for reproducible output, and full pipeline integration. Supports basic config (variant, seed, VM count, Linux %) and advanced options (tenants, sites, tags, network config). Generates provider-shaped objects compatible with existing RTC presets.
- **CMDBs Management:** Full CRUD for CMDB target accounts (NetBox, i-doit, ServiceNow) with connection testing, enable/disable toggles, configuration, and admin-only delete functionality with confirmation dialogs.
- **Settings:** Configuration management for NetBox URL/token, connection testing, and housekeeping dashboard.
- **NetBox VM Import/Editing:** Admin-only full replacement sync of VMs from NetBox, storing detailed metadata. Local editing of imported VM data is supported.
- **Bridge Data Pipelines (BDP):** UI and backend for creating and managing data pipelines.
  - **Pipelines List & Wizard:** Table view of pipelines, creation wizard for selecting source provider, target CMDB, and defining mappings.
  - **Pipeline Detail Page:** Header with actions, settings card with schedule editor, tabs for mappings and runs.
  - **Mapping Editor:** Configuration of mappings with source/target type pairs and field rules.
  - **Dry-Run & Sync:** Functionality to perform dry-runs to preview changes and execute syncs with automatic IP address syncing.
  - **IP Address Syncing:** Pipeline sync automatically creates IP addresses in NetBox IPAM, assigns them to VM interfaces, and sets the primary_ip4 reference.
  - **Rules Engine Service:** Backend service for transformation and validation with various transforms (e.g., lower, upper, regex_extract), conflict policies (provider-wins, cmdb-wins), and validation rules.
  - **CMDB Adapters Enhanced:** NetBox and i-doit adapters extended with `objectTypes()` and `validate()` methods.
  - **Preset RTC Rules:** 6 pre-configured mapping templates for common provider-to-CMDB integrations.
  - **Modular Routes Architecture:** Organized API endpoints for pipelines, mappings, and provider discovery.
  - **RBAC Enforcement:** Role-based access control applied to all pipeline endpoints.
- **Automation Inventories:** Unified inventory management system consolidating all inventory sources.
  - **Three Inventory Types:** Linked (CMDB-backed with real NetBox data), File-based (YAML/JSON/INI), and Script-based (dynamic).
  - **Real NetBox Integration:** Linked inventories fetch actual VM data from connected NetBox CMDBs via `NetBoxAdapter.listAllVms()` method.
  - **Automatic Group Generation:** Groups created from VM tags, tenant, site, cluster, and platform metadata.
  - **Drill-Down Navigation:** Browse groups → hosts → host details with group memberships and variables.
  - **File Inventory Editor:** Real-time validation and editing of YAML/JSON/INI inventory files.
  - **Refresh Functionality:** Updates group/host counts from live NetBox data.
  - **Preview Data:** Sample hosts and groups displayed in list view for quick inspection.
  - **Gate Filtering:** VMs must pass governance checks (tenant, role, automatable tag) to be included in automation inventories.
- **Provider Tag Namespacing:** All provider-originated tags are namespaced before writing to NetBox.
  - **Non-Negotiable Rule:** Provider tags MUST NOT be written to NetBox verbatim - they are always prefixed with the provider name.
  - **Transformation Rule:** Tags are transformed from `<key>/<value>` to `<provider>_<key>/<value>` (e.g., `customer/acme` → `proxmox_customer/acme`).
  - **Scope:** Applied in sync pipelines (provider-sync.ts, syncWorker.ts, pipelines.ts) - NOT in provider output or gate logic.
  - **NetBox Tag Handling:** Prefixed tags are created automatically; existing NetBox tags are preserved.
  - **Explicit Prohibition:** Prefixed tags are NEVER used for gate decisions, tenant/role mapping, or CMDB field auto-population.
- **Automation GATE System:** Governance layer ensuring VMs can only be automated when properly governed in CMDB.
  - **Inescapable Gate:** Gate evaluation is AUTOMATIC and NON-OPTIONAL - there is no execution path that bypasses this check.
  - **First-Class Phase:** Gate evaluation is an EXPLICIT PHASE that runs BEFORE inventory generation. Inventory generation ONLY reads from gate store, never triggers evaluation.
  - **Provider Governance Blindness:** Providers emit raw observed data only - they have NO knowledge of tenants, automation, or gating concepts.
  - **CMDB Authority:** Governance authority resides EXCLUSIVELY in the CMDB. Provider metadata may only suggest, never confirm intent.
  - **Gate Requirements:** VMs require three governance fields in NetBox to be allowed for automation: (1) tenant assignment, (2) role assignment, (3) `automatable` boolean custom field set to `true`.
  - **Automatable Custom Field:** Boolean custom field on VMs that must be explicitly set to `true` by a human operator. Default is `false`. The legacy `automatable` tag is deprecated and ignored.
  - **Stable Asset Identity:** Uses `asset_id` (deterministic hash of source + external ID) as stable internal identity. VM names are display-only, NOT trusted identifiers.
  - **Ephemeral State:** Gate decisions and provider hints are stored in ephemeral in-memory storage (derived state only, can be dropped at any time).
  - **Failure Classification:** 
    - INVARIANT VIOLATIONS (crash): blocked VM in inventory, provider hints used for governance
    - GOVERNANCE FAILURES (block): missing tenant/role/tag - visible, non-fatal
  - **Security Guardrail:** Gate evaluator explicitly rejects provider hints - throws INVARIANT VIOLATION if hints are passed.
  - **Invariant Check:** Inventory generation includes a tripwire that crashes if a blocked VM ever appears in an automation inventory.
  - **Human Feedback Loop:** Block reasons can be synced back to NetBox as informational tags/fields. Sync-back is INFORMATIONAL ONLY - not used for gate decisions.
  - **Gate API Endpoints (Read-Only for Transparency):** 
    - `GET /api/gate/allowed` - List all allowed VMs with asset_id
    - `GET /api/gate/blocked` - List all blocked VMs with missing fields and failure_type
    - `GET /api/gate/status/:vmName` - Get gate status for specific VM
    - `GET /api/gate/hints/:vmName` - Get provider hints for specific VM (with warning that hints are non-authoritative)
    - `GET /api/gate/summary` - Summary stats with last evaluation time
    - `POST /api/gate/sync-blocks` - Sync block reasons to NetBox for human visibility (admin only)
  - **Inventory Integration:** Automation inventories automatically filter VMs through gate, only including allowed VMs.
  - **Design Principle Anchor:** See `server/services/gate-design-principle.ts` for architectural intent documentation.
  - **Future Mapping (Not Implemented):** Provider-to-CMDB mapping, when implemented, may pre-fill governance fields but MUST require explicit human confirmation and never automatically grant automation access.

**System Design Choices:**
- **Database Schema:** Designed to support users, projects, credentials, job templates, job runs, notifications, settings, provider accounts, sync runs, external objects, NetBox VM imports, CMDBs, and pipeline-related entities (pipelines, pipeline_mappings, pipeline_runs). Roles include admin, operator, and viewer.
- **API Endpoints:** Comprehensive RESTful API for all managed resources and a WebSocket endpoint for live log streaming.
- **File Structure:** Organized for clarity: `client/` (components, pages, lib), `server/` (services, db, storage, routes), and `shared/` (schema).

## External Dependencies
- **PostgreSQL:** Primary database, hosted serverlessly on Neon.
- **NetBox REST API:** For reading inventory data and potentially writing custom fields.
- **WebSocket:** For real-time log streaming.
- **bcrypt:** For password hashing.
- **JWT:** For token-based authentication.
- **Tailwind CSS:** Frontend styling framework.
- **Shadcn UI:** UI component library.
- **Vite:** Frontend build tool.
- **Drizzle ORM:** Database ORM for TypeScript.
- **cron-parser:** For schedule validation.