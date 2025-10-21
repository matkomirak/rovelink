# Bridge - Infrastructure Automation Platform

## Overview
Bridge is a full-stack infrastructure automation UI designed to streamline IT operations. It integrates with NetBox for inventory management, provides tools for defining and managing job templates, and orchestrates the execution of simulated Ansible playbooks. The platform offers real-time log streaming for job runs, comprehensive reporting, and a robust provider system for collecting and synchronizing VM inventory from various virtualization platforms into NetBox. Its core purpose is to provide a centralized, user-friendly interface for managing infrastructure automation workflows, enhancing operational efficiency, and improving visibility into IT assets. The platform also includes functionality for defining and executing data pipelines between various sources and CMDBs.

## User Preferences
I prefer that the agent focuses on high-level feature implementation and architectural decisions rather than getting bogged down in minute code details. When proposing changes, please outline the approach and impact first. I appreciate clear, concise communication and a systematic approach to problem-solving. I prefer iterative development, where features are built out step-by-step, allowing for feedback and adjustments along the way. Do not make changes to files or folders without explicit instructions.

## System Architecture
Bridge is built with a modern web stack: React 18 + TypeScript + Tailwind CSS + Shadcn UI for the frontend, Express.js + TypeScript for the backend, and PostgreSQL (via Neon serverless) with Drizzle ORM for data persistence. Real-time communication for log streaming is handled via WebSockets. Authentication is JWT-based, and external integration includes the NetBox REST API for inventory data.

**UI/UX Decisions:**
The UI follows a dark-first design principle using the Inter font family for UI elements and JetBrains Mono for code/logs. It features a professional aesthetic with a primary blue color palette, semantic colors for status, dark slate backgrounds, and elevated card elements. Typography is clearly defined, and reusable UI components include sidebar navigation, cards, sticky-header tables, a dark monospace log console, status badges, and skeleton loading states.

**Technical Implementations & Feature Specifications:**
- **Authentication & Authorization:** JWT-based user authentication with bcrypt for passwords and role-based access control (admin, operator, viewer).
- **NetBox Integration:** Read-only access to NetBox inventory, including group/host browsing, preflight validation for limit expressions, and inventory health reporting. Supports importing VMs from NetBox with detailed metadata, OS normalization, and custom field/tag capture. Multi-source NetBox inventory management is supported.
- **Project Management:** CRUD operations for Git repositories, with mocked sync for playbook discovery.
- **Credentials Management:** CRUD for mock credential references (SSH key, WinRM, sudo, vault types) storing non-secret metadata.
- **Job Templates:** Creation of templates linked to projects, playbooks, and credentials, supporting limit expressions, extra variables, check mode, and diff mode. Templates can be launched immediately or scheduled.
- **Job Runs:** Simulated Ansible execution (FakeRunner) with real-time log streaming via WebSockets, persistent logs, and CSV export.
- **Scheduling:** Deferred execution via `scheduledAt` timestamps, with simplified background triggering.
- **Reports Dashboard:** Widgets for inventory health (coverage, IP/user counts) and run statistics (success rate, failures).
- **Notifications:** Configurable email and webhook notifications with trigger conditions, variable interpolation, retry logic, and custom headers/body.
- **Provider System:** Extensible factory pattern for integrating various virtualization providers (e.g., Proxmox) to collect, normalize, and upsert VM inventory into NetBox. Includes provider account management, sync workers, external object mapping, sync run history, and housekeeping.
- **CMDBs Management:** Full CRUD for CMDB target accounts (NetBox, i-doit, ServiceNow) with connection testing, enable/disable toggles, configuration, and admin-only delete functionality with confirmation dialogs.
- **Settings:** Configuration management for NetBox URL/token, connection testing, and housekeeping dashboard.
- **NetBox VM Import/Editing:** Admin-only full replacement sync of VMs from NetBox, storing detailed metadata. Local editing of imported VM data is supported.
- **Bridge Data Pipelines (BDP):** UI and backend for creating and managing data pipelines.
  - **Pipelines List & Wizard:** Table view of pipelines, creation wizard for selecting source provider, target CMDB, and defining mappings.
  - **Pipeline Detail Page:** Header with actions, settings card with schedule editor, tabs for mappings and runs.
  - **Mapping Editor:** Configuration of mappings with source/target type pairs and field rules.
  - **Dry-Run & Sync:** Functionality to perform dry-runs to preview changes and execute syncs.
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