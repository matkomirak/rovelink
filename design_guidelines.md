# Bridge App Design Guidelines

## Design Approach

**Selected Approach**: Design System - Technical Dashboard Pattern
**Justification**: Enterprise infrastructure automation tool requiring information density, operational clarity, and stability. Drawing inspiration from Linear, GitHub, and Vercel for modern technical interfaces.

**Key Principles**:
- Information hierarchy over decoration
- Operational clarity and quick scanning
- Trust through precision and consistency
- Dark-first design for reduced eye strain during extended monitoring sessions

---

## Core Design Elements

### A. Color Palette

**Dark Mode (Primary)**
- Background Base: 220 15% 8%
- Background Elevated: 220 15% 12%
- Background Interactive: 220 15% 16%
- Border Subtle: 220 15% 20%
- Border Default: 220 15% 25%
- Text Primary: 220 15% 95%
- Text Secondary: 220 10% 65%
- Text Tertiary: 220 8% 45%

**Semantic Colors**
- Primary/Accent: 215 90% 60% (clear blue for actions)
- Success: 142 70% 50% (green for ok/completed)
- Warning: 38 92% 60% (amber for pending/warnings)
- Danger: 0 72% 58% (red for failed/errors)
- Info: 200 80% 55% (cyan for metadata)

**Light Mode (Secondary)**
- Background Base: 0 0% 100%
- Background Elevated: 220 15% 98%
- Text Primary: 220 15% 15%
- Invert semantic colors for light backgrounds (darker shades)

### B. Typography

**Font Families**
- UI Text: Inter (via Google Fonts CDN)
- Monospace/Code: JetBrains Mono (for logs, JSON, limit expressions)

**Type Scale**
- Display (page titles): text-2xl font-semibold (24px)
- Heading (section headers): text-lg font-medium (18px)
- Body: text-sm font-normal (14px)
- Label: text-xs font-medium uppercase tracking-wide (12px)
- Code/Logs: text-sm font-mono (14px monospace)

### C. Layout System

**Spacing Primitives**: Tailwind units of 2, 4, 6, 8, 12, 16
- Component padding: p-4 or p-6
- Section spacing: space-y-6 or space-y-8
- Form fields: space-y-4
- Card gaps: gap-4
- Page margins: px-6 lg:px-8

**Grid System**
- Container: max-w-7xl mx-auto
- Sidebar: 240px fixed width (hidden on mobile)
- Main content: flex-1 with proper padding
- Dashboard widgets: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6

### D. Component Library

**Navigation**
- Sidebar: Dark background, icon + label items, active state with subtle highlight (background-interactive + border-l-2 primary)
- Top bar: Breadcrumbs, search, user menu, notifications
- Tabs: Underline style with primary color indicator

**Data Display**
- Tables: Striped rows (subtle), sticky headers, sortable columns, row hover states
- Log console: Dark monospace background (220 15% 6%), auto-scroll, line numbers, syntax highlighting for status
- Status badges: Rounded-full px-3 py-1 with semantic colors (success/warning/danger), uppercase text-xs
- Cards: Border subtle, background-elevated, rounded-lg with p-4 or p-6

**Forms**
- Input fields: Dark background with border-default, focus ring with primary color, consistent h-10
- Buttons: Primary (bg-primary), Secondary (border with text-primary), Danger (bg-danger) - all with h-10 px-4
- Selects/Dropdowns: Match input styling, custom chevron icon
- JSON editor: Monospace textarea with syntax highlighting hints
- Date picker: Clean modal with calendar grid, today highlight

**Interactive Elements**
- Run status: Live pulse animation on "running" status
- Preflight warnings: Yellow/amber callout cards with icon
- WebSocket indicators: Small dot with pulse animation when connected
- Loading states: Skeleton screens for tables/cards, spinner for inline actions

**Overlays**
- Modals: Centered, max-w-2xl, backdrop blur, slide-in animation
- Dropdowns: Shadow-lg, border-subtle, smooth appear animation
- Toasts: Top-right, auto-dismiss, semantic color backgrounds

### E. Page-Specific Patterns

**Inventory Page**
- Left: Group tree navigator (collapsible)
- Center: Hosts table with inline filters
- Right: Preflight panel (sticky) showing counts and warnings

**Templates Form**
- Two-column layout on desktop: Left (form fields), Right (preflight summary + actions)
- Inline validation for limit expressions
- "Save" and "Save & Launch" buttons with clear visual distinction

**Run Detail**
- Full-width log console (80vh max) with dark background
- Top: Status banner with run metadata (duration, user, template)
- Bottom: Summary cards (hosts affected, tasks, results) in grid

**Reports Dashboard**
- Widget cards in responsive grid
- Each widget: Title, metric (large), sparkline/chart, and status indicator
- Inventory Health: Percentage gauge, missing item counts
- Recent Runs: Success rate bar chart, top failures list

**Settings**
- Form sections with clear headers
- Environment variable display (masked for tokens)
- "Test Connection" button for NetBox with inline status

### F. Animations

Use sparingly and purposefully:
- Page transitions: None (instant navigation)
- Modal/dropdown: 150ms ease-out scale + opacity
- Live log streaming: Smooth auto-scroll
- Status updates: 200ms color transition
- Loading spinners: Subtle rotate animation

---

## Images

**Hero Images**: Not applicable - this is a utility dashboard application. No marketing pages.

**Icons**: Use Heroicons (outline and solid variants) via CDN for all UI icons (navigation, status, actions)

**Illustrations**: None needed for MVP. Consider adding empty state illustrations for "no runs" or "no projects" in future iterations.

---

## Implementation Notes

- Maintain dark mode across ALL components including form inputs, modals, and dropdowns
- Use consistent border-radius: rounded (4px) for buttons/inputs, rounded-lg (8px) for cards, rounded-full for badges
- Ensure 4.5:1 contrast ratio minimum for all text on backgrounds
- Monospace font mandatory for: logs, JSON editors, limit expressions, API responses
- Tables should be horizontally scrollable on mobile with sticky first column option