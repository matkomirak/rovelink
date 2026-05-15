# Rovelink - Infrastructure Automation Platform

## Overview
Rovelink is a full-stack infrastructure automation platform designed to streamline IT operations by providing a centralized UI for managing infrastructure, integrating with NetBox for inventory, and orchestrating simulated Ansible playbook executions. It offers real-time log streaming, reporting, and an extensible provider system for synchronizing VM inventory from various virtualization platforms into NetBox. The platform's core purpose is to enhance operational efficiency, improve visibility into IT assets, and manage data pipelines between diverse sources and CMDBs.

## User Preferences
I prefer that the agent focuses on high-level feature implementation and architectural decisions rather than getting bogged down in minute code details. When proposing changes, please outline the approach and impact first. I appreciate clear, concise communication and a systematic approach to problem-solving. I prefer iterative development, where features are built out step-by-step, allowing for feedback and adjustments along the way. Do not make changes to files or folders without explicit instructions.

## System Architecture
Rovelink is built with React 18 (TypeScript, Tailwind CSS, Shadcn UI) for the frontend, Express.js (TypeScript) for the backend, and PostgreSQL (Neon serverless) with Drizzle ORM for data persistence. Real-time communication uses WebSockets. Authentication is JWT-based.

**UI/UX Decisions:**
The UI features a dark-first design with the Inter font, a primary blue color palette, semantic status colors, dark slate backgrounds, and elevated card elements. Key UI components include sidebar navigation, cards, sticky-header tables, a dark monospace log console, status badges, and skeleton loading states.

**Technical Implementations & Feature Specifications:**
- **Authentication & Authorization:** JWT-based user authentication with bcrypt for passwords and role-based access control (admin, operator, viewer). Auth tokens are stored as HttpOnly cookies (never in localStorage). AUTH_DISABLE is dev-only and hard-fails with HTTP 403 in production.
- **Secrets Management:** All provider, CMDB, and NetBox tokens are encrypted at rest using AES-256-GCM (`ENCRYPTION_KEY` env var, 64-char hex). Secrets are decrypted only immediately before adapter/API use. All API responses redact secrets; `redactForLog` prevents secrets appearing in server logs. Migration script at `server/migrations/encrypt-existing-secrets.ts` for existing plaintext DB values. Security tests in `tests/security.test.ts` verify no secrets leak in responses, logs, or request shapes. Bootstrap passwords are written to a file (not stdout) in production.
- **NetBox Integration:** Read-only access to NetBox inventory, including VM imports, group/host browsing, and inventory health reporting. Supports multi-source NetBox inventory management.
- **Project & Credentials Management:** CRUD for Git repositories (mocked sync for playbook discovery) and mock credential references.
- **Job Templates & Runs:** Creation and scheduling of job templates linked to projects, playbooks, and credentials. Simulated Ansible execution (FakeRunner) with real-time log streaming via WebSockets and persistent logs.
- **Unified Runs View:** Consolidated view of all execution types (playbook, pipeline syncs, provider syncs).
- **Reports Dashboard:** Widgets for inventory health and run statistics.
- **Notifications:** Configurable email and webhook notifications with trigger conditions.
- **Provider System:** Extensible factory pattern for integrating virtualization providers (e.g., Proxmox, Fake, Azure) to collect, normalize, and upsert VM inventory into NetBox. Includes account management, sync workers, and run history.
    - **Fake Provider:** Deterministic VM generator for testing, supporting multiple virtualization variants (Proxmox, vSphere, Azure, AWS) with configurable parameters.
    - **Azure Provider (Full Discovery):** Full-subscription Azure discovery via OAuth2 service principal. Scans VMs (with all azure_vm_* custom fields), Virtual Networks, Subnets, NICs, and Public IPs. Imports into NetBox as VirtualMachines, VMInterfaces, IPAddresses, and Prefixes. Uses `AzureNetBoxSyncService` (server/services/azure-netbox-sync.ts) for idempotent upserts. Automatically creates all azure_vm_*, azure_nic_*, azure_vnet_*, azure_subnet_*, azure_ip_* custom fields in NetBox during sync. Discovery endpoints return 5 Azure object types: Vm, VirtualNetwork, Subnet, NetworkInterface, PublicIp. Pipeline presets exist for all Azure → NetBox mappings.
- **CMDBs Management:** CRUD for CMDB target accounts (NetBox, i-doit, ServiceNow) with connection testing.
- **Rovelink Data Pipelines (RDP):** UI and backend for creating and managing data pipelines between sources and CMDBs. Features include a creation wizard, mapping editor, dry-run/sync functionality with IP address syncing, and a rules engine for transformation and validation.
- **Automation Inventories:** Unified inventory management system supporting Linked (NetBox-backed), File-based (YAML/JSON/INI), and Script-based types. Provides drill-down navigation and automatic group generation from VM metadata.
- **Provider Tag Namespacing:** All provider-originated tags are automatically namespaced before writing to NetBox (e.g., `proxmox_customer/acme`) and are never used for gate decisions or governance.
- **Automation GATE System:** A non-optional, inescapable governance layer ensuring VMs are properly governed in NetBox before automation. It checks for active status, assigned tenant/role, and an `automatable` custom field set to `true`. This system includes provider ownership tracking (`gate_provider_id`), handling of missing CIs (marking as `offline`), and robust safety checks during provider syncs. Gate decisions are ephemeral, and read-only API endpoints provide transparency into allowed/blocked VMs and block reasons.
- **Eligibility Policy:** Per-inventory configurable policy that extends gate evaluation with optional rules. Core rules (Tenant, Platform, Primary IP, Automatable, Provider State) are always enforced. Optional rules (Require Role, Require Contacts) can be toggled per inventory via the UI. Policy is stored in the `eligibilityPolicy` JSONB field on automation inventories and evaluated during gate phase.

**System Design Choices:**
- **Database Schema:** Supports users, projects, credentials, job templates, runs, notifications, settings, provider accounts, syncs, external objects, NetBox VM imports, CMDBs, and pipeline entities.
- **API Endpoints:** Comprehensive RESTful API and a WebSocket endpoint for live log streaming.
- **File Structure:** Organized into `client/`, `server/`, and `shared/` directories.

## External Dependencies
- **PostgreSQL:** Primary database, hosted on Neon.
- **NetBox REST API:** For inventory data integration.
- **WebSocket:** For real-time communication.
- **bcrypt:** For password hashing.
- **JWT:** For token-based authentication.
- **Tailwind CSS:** Frontend styling.
- **Shadcn UI:** UI component library.
- **Vite:** Frontend build tool.
- **Drizzle ORM:** Database ORM.
- **cron-parser:** For schedule validation.
