# Bridge - Infrastructure Automation Platform

**VERSION: "no-bridge-pipeline-code" (v1.0 - Pre-Pipeline Implementation)**

This version includes all core features EXCEPT Bridge pipeline orchestration code. This is the baseline version before pipeline functionality is added.

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
