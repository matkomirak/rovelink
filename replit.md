# Bridge - Infrastructure Automation Platform

**VERSION: "bridge-pipeline-code-phase-3-backend" (v2.1 - Phase 3 Backend Complete)**

This version includes full backend implementation for Phase 3 of the Bridge Data Pipelines (BDP) system. The backend now supports pipeline CRUD, mapping rules with transformations, dry-run capabilities, and preset RTC (Rules, Transforms, Conflicts) configurations. Frontend UI implementation for Phase 3 is pending.

## Overview
Bridge is a full-stack infrastructure automation UI designed to streamline IT operations. It integrates with NetBox for inventory management, provides tools for defining and managing job templates, and orchestrates the execution of simulated Ansible playbooks. The platform offers real-time log streaming for job runs, comprehensive reporting, and a robust provider system for collecting and synchronizing VM inventory from various virtualization platforms into NetBox. Its core purpose is to provide a centralized, user-friendly interface for managing infrastructure automation workflows, enhancing operational efficiency, and improving visibility into IT assets.

## User Preferences
I prefer that the agent focuses on high-level feature implementation and architectural decisions rather than getting bogged down in minute code details. When proposing changes, please outline the approach and impact first. I appreciate clear, concise communication and a systematic approach to problem-solving. I prefer iterative development, where features are built out step-by-step, allowing for feedback and adjustments along the way. Do not make changes to files or folders without explicit instructions.

## System Architecture
Bridge is built with a modern web stack: React 18 + TypeScript + Tailwind CSS + Shadcn UI for the frontend, Express.js + TypeScript for the backend, and PostgreSQL (via Neon serverless) with Drizzle ORM for data persistence. Real-time communication for log streaming is handled via WebSockets. Authentication is JWT-based, and external integration includes the NetBox REST API for inventory data.

**UI/UX Decisions:**
The UI follows a dark-first design principle using the Inter font family for UI elements and JetBrains Mono for code/logs. It features a professional aesthetic with:
- **Color Palette:** Primary Blue, semantic colors for success (Green), warning (Amber), and danger (Red). Dark slate backgrounds with elevated card elements.
- **Typography Hierarchy:** Clearly defined sizes for display, heading, body, and label text.
- **Components:** Reusable UI components include sidebar navigation, cards, sticky-header tables, a dark monospace log console, status badges, and skeleton loading states.

**Technical Implementations & Feature Specifications:**
- **Authentication & Authorization:** JWT-based user authentication with bcrypt for passwords and role-based access control (admin, operator, viewer).
- **NetBox Integration:** Read-only access to NetBox inventory, including group/host browsing, preflight validation for limit expressions, and inventory health reporting. It also supports importing VMs from NetBox with detailed metadata, operating system normalization, and custom field/tag capture. Multi-source NetBox inventory management is supported.
- **Project Management:** CRUD operations for Git repositories, with mocked sync for playbook discovery.
- **Credentials Management:** CRUD for mock credential references (SSH key, WinRM, sudo, vault types) storing non-secret metadata.
- **Job Templates:** Creation of templates linked to projects, playbooks, and credentials, supporting limit expressions, extra variables, check mode, and diff mode. Templates can be launched immediately or scheduled.
- **Job Runs:** Simulated Ansible execution (FakeRunner) with real-time log streaming via WebSockets, persistent logs, and CSV export.
- **Scheduling:** Deferred execution via `scheduledAt` timestamps, with simplified background triggering.
- **Reports Dashboard:** Widgets for inventory health (coverage, IP/user counts) and run statistics (success rate, failures).
- **Notifications:** Configurable email and webhook notifications with trigger conditions (on success/failure), variable interpolation, retry logic, and custom headers/body.
- **Provider System:** Extensible factory pattern for integrating various virtualization providers (e.g., Proxmox). This system collects VM inventory, normalizes data, and upserts it into NetBox. It includes provider account management, sync workers, external object mapping, sync run history, and housekeeping operations (cache rebuild, schema ensure, prune stale, retry failed).
- **CMDBs Management (NEW - Phase 1-2):** Full CRUD for CMDB target accounts (NetBox, i-doit, ServiceNow). Features include connection testing, enable/disable toggles, and configuration management (URL, API token). NetBox CMDBs receive data from provider sync operations. Alert notification informs users that active NetBox account (configured in Settings) is used for inventory reads and job limits.
- **Settings:** Configuration management for NetBox URL/token, connection testing, and housekeeping dashboard.
- **NetBox VM Import/Editing:** Admin-only full replacement sync of VMs from NetBox, storing detailed metadata. Local editing of imported VM data (name, IP, OS, tags) is supported.

**System Design Choices:**
- **Database Schema:** Designed to support users, projects, credentials, job templates, job runs, notifications, settings, provider accounts, sync runs, external objects, NetBox VM imports, and a group cache for NetBox inventory. Roles include admin, operator, and viewer.
- **API Endpoints:** Comprehensive RESTful API for all managed resources (auth, inventory, projects, credentials, templates, runs, reports, settings, notifications, providers, NetBox VM import, housekeeping). WebSocket endpoint for live log streaming.
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
- 2025-10-16: NetBox custom fields display
  - Fixed trailing slash issue in NetBox API URLs (was causing 404 errors on import)
  - Added Custom Fields column to VMs table displaying key-value pairs as badges
  - Custom fields shown in edit dialog as read-only reference
  - Displays up to 2 custom fields in table with "+N more" indicator for additional fields
  - All NetBox custom fields are properly imported and stored as JSON in the database

- 2025-10-16: Keyed Groups for NetBox Inventory (Option A)
  - Created `inventory/netbox.yml` with keyed_groups configuration using NetBox inventory plugin
  - Keyed groups automatically generated from custom fields and metadata:
    - `wave_*` - Groups VMs by patch wave (from custom_fields.patch_wave or custom_fields.Patching.Wave)
    - `customer_*` - Groups VMs by customer/tags (from tenant.name or tags)
    - `os_*` - Groups VMs by operating system (from platform.slug)
    - `role_*` - Groups VMs by device role (from device_role.slug or custom_fields.role)
  - Updated FakeRunner to use `-i inventory/netbox.yml` and show `--limit` flag with keyed group expressions in logs
  - Enhanced preflight validation to recognize keyed group patterns (wave_*, customer_*, os_*, role_*)
  - Autocomplete suggestions now include keyed groups generated from imported NetBox VMs
  - Updated template UI with keyed group examples in placeholder and help text
  - Added limitExpr field to job_runs schema to preserve limit expressions from templates through execution
  - Rebuild Group Cache functionality now generates keyed groups from NetBox VM custom fields
  - Templates support limit expressions like: `customer_Alpha & os_linux & wave_Wave2 - role_db`

## Recent Changes

### 2025-10-20: Bridge Data Pipelines (BDP) - Phase 3 Backend Complete
- **Database Schema:** Added pipeline tables (pipelines, pipeline_mappings, pipeline_runs)
  - pipelines: Name, source provider, target CMDB, enabled flag, versioning
  - pipeline_mappings: Source/target types, RTC rules (JSON), parent mapping references
  - pipeline_runs: Status tracking (queued, running, ok, error), dry-run flag, execution summaries
  - Proper indexes on foreign keys, status, timestamps for query performance
  
- **Rules Engine Service:** Comprehensive transformation and validation engine (`server/services/rules-engine.ts`)
  - **Transforms:** lower, upper, title, strip, concat, map, regex_extract, lookup_table, datetime_parse, pick_primary_ipv4
  - **Conflict Policies:** provider-wins, cmdb-wins, manual-only, merge
  - **Validation:** Required field checking, default values, nested object support
  - **Field Mapping:** Supports dot notation (e.g., `guest.os` → `platform`)
  
- **CMDB Adapters Enhanced:**
  - **NetBox Adapter:** Added `objectTypes()` method (VirtualMachine, IPAddress, Interface, etc.)
  - **NetBox Adapter:** Added `validate()` method with field-level schema checks
  - **i-doit Adapter:** Created stub with `objectTypes()` and `validate()` methods
  
- **Sample Fixtures:** Created realistic test data (`server/services/sample-fixtures.ts`)
  - Proxmox VM samples (3 VMs with tags, custom fields, interfaces)
  - vCenter VM samples (2 VMs with guest OS, custom attributes)
  - Azure VM samples (2 VMs with tags, resource groups, network interfaces)
  - Helper functions: getSamples(), getSample(), getObjectTypes()
  
- **Preset RTC Rules:** 6 pre-configured mapping templates (`server/services/preset-rules.ts`)
  - Proxmox.Vm → NetBox.VirtualMachine
  - vCenter.VM → NetBox.VirtualMachine
  - Azure.VM → NetBox.VirtualMachine
  - Proxmox.Vm → i-doit.VirtualServer
  - vCenter.VM → i-doit.VirtualServer
  - Azure.VM → i-doit.VirtualServer
  - Each preset includes comprehensive field mappings, transforms, and conflict policies
  
- **Modular Routes Architecture:** Organized Phase 3 endpoints into focused route files
  - `server/routes/pipelines.ts`: Pipeline CRUD, dry-run, sync, runs, presets
  - `server/routes/pipeline-mappings.ts`: Mapping CRUD, test transformations
  - `server/routes/provider-discovery.ts`: Object types, sample objects
  - All routes integrated into main `server/routes.ts` with auth middleware
  
- **Storage Interface:** Extended with full Phase 3 CRUD operations
  - createPipeline, updatePipeline, deletePipeline, getPipelines, getPipeline
  - createPipelineMapping, updatePipelineMapping, deletePipelineMapping, getPipelineMappings
  - createPipelineRun, updatePipelineRun, getPipelineRuns
  - incrementPipelineVersion for change tracking
  
- **API Endpoints:** Complete backend API for Phase 3 (ready for UI consumption)
  - `GET/POST /api/pipelines` - List/create pipelines
  - `GET/PATCH/DELETE /api/pipelines/:id` - Pipeline detail/update/delete
  - `GET /api/pipelines/:id/runs` - Pipeline execution history
  - `POST /api/pipelines/:id/dry-run` - Test pipeline without changes
  - `POST /api/pipelines/:id/sync` - Enqueue sync worker
  - `GET /api/pipelines/presets` - List preset RTC rules
  - `GET /api/pipelines/presets/:id` - Get preset rules details
  - `POST/GET /api/pipelines/:pipelineId/mappings` - Create/list mappings
  - `GET/PATCH/DELETE /api/pipelines/:pipelineId/mappings/:mapId` - Mapping operations
  - `POST /api/pipelines/:pipelineId/mappings/:mapId/test` - Test transformation with validation
  - `GET /api/providers/:id/object-types` - Available provider object types
  - `GET /api/providers/:id/samples` - Sample normalized objects for testing
  
- **RBAC Enforcement:** Role-based access control applied to all Phase 3 endpoints
  - Admin: Full access to pipeline CRUD, mapping configuration, dry-run, sync
  - Operator: Can execute dry-run and sync, view pipelines
  - Viewer: Read-only access to pipelines and runs
  
- **Dependencies:** Installed `@types/lodash` for type safety in transforms
  
- **Version Transition:** v2.0 "phases-1-2" → v2.1 "phase-3-backend"

### 2025-10-20: Bridge Data Pipelines (BDP) - Phases 1-2 Complete
- **CMDBs Page:** Created full UI for managing CMDB target accounts at `/cmdbs`
  - Add/Edit CMDB accounts with kind selection (NetBox, i-doit, ServiceNow)
  - Connection testing with detailed error reporting
  - Enable/disable toggle for each CMDB account
  - Table view showing all configured CMDBs with status indicators
  - Alert notification explaining active NetBox usage for inventory/limits
  - Backend: `POST /api/cmdbs`, `PATCH /api/cmdbs/:id`, `POST /api/cmdbs/:id/test`
  
- **Providers Page:** Already existed with comprehensive provider management
  - Add/Edit provider accounts (Proxmox, vCenter, Azure)
  - Test connection, Sync, and Schedule sync operations
  - Cron expression validation for scheduled syncs
  - Backend integration with provider collectors and sync workers
  
- **Navigation Updates:**
  - Added "CMDBs" link to sidebar navigation (between Providers and Templates)
  - Both Providers and CMDBs pages accessible from main navigation
  - Icon: Cloud for Providers, Boxes for CMDBs
  
- **Dependencies:**
  - Installed `cron-parser` package for schedule validation
  
- **Version Transition:** v1.0 "no-bridge-pipeline-code" → v2.0 "bridge-pipeline-code-phases-1-2"
