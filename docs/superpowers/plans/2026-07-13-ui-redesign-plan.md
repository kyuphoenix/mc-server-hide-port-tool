# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve layout structure and visual style of SettingsView.tsx and AdminView.tsx to align with clean SaaS design guidelines.

**Architecture:** Refactor Hono JSX structures. SettingsView uses asymmetric double column. AdminView uses a fixed-width left sidebar layout with vertical navigation. Avoid nested cards and rounded-2xl styles, restrict corners to rounded-lg, and optimize component densities.

**Tech Stack:** TypeScript, Hono JSX, Tailwind CSS.

---

### Task 1: Optimize SettingsView Layout
**Files:**
- Modify: `src/views/SettingsView.tsx`

- [ ] **Step 1: Edit SettingsView.tsx to implement asymmetric dual-column grid**
  Replace the entire layout structure with a responsive grid (`grid grid-cols-1 md:grid-cols-3 gap-8`). Put the Profile Card in the left 1/3, and other forms (basic info, oauth, passkey) in the right 2/3. Use 8px rounded corners (`rounded-lg`), simple dark flat backgrounds (`bg-slate-900/40 border border-slate-800`), and clean font tags. Round all social login icons using `rounded-full bg-transparent object-cover` or display letters inside standard circles. Move the "Add Passkey" button to the right side of the Passkey header block.

- [ ] **Step 2: Run TypeScript compile verification**
  Run: `npx tsc --noEmit`
  Expected: Exit code 0 (no compile errors)

- [ ] **Step 3: Commit the change**
  Run:
  ```bash
  git add src/views/SettingsView.tsx
  git commit -m "style: optimize settings view layout with dual-column grid and SaaS design style"
  ```

---

### Task 2: Optimize AdminView Layout
**Files:**
- Modify: `src/views/AdminView.tsx`

- [ ] **Step 1: Edit AdminView.tsx to introduce left sidebar structure and vertical navigation**
  Modify the overall page structure of AdminView to a sidebar layout (`flex flex-col md:flex-row min-h-screen bg-slate-950`).
  Define a left sidebar container (`w-full md:w-64 bg-slate-900 border-r border-slate-800 p-6 flex flex-col justify-between shrink-0`). Put the Brand Logo and Admin navigation buttons inside it with nice icons. The active navigation tab should have a clean focus indicator (e.g. `bg-emerald-600/10 text-emerald-400 border-l-2 border-emerald-500` or similar). Put the "Back to Main" and "Logout" buttons at the bottom of the sidebar.
  The right side content area (`flex-grow p-6 md:p-10 max-w-6xl mx-auto w-full space-y-6`) will display the selected Tab contents using flat 8px rounded-lg cards.

- [ ] **Step 2: Refactor forms and tables in AdminView**
  - **Global Settings Tab**: Align setting inputs in distinct grid groups (Registration Mode, System Limits, Email Service).
  - **OAuth Apps Tab**: Align templates and form fields. Refactor the application edit form: instead of putting `<details>` in a cramped table cell, render it as an inline edit block beneath the row when requested, or present a clean grid-based form.
  - **User Management Tab**: Detect synthetic email length, and output a truncated email prefix and domain suffix (using HTML titles for hover full text) to prevent layout breakages.
  - **DNS Records Tab**: Optimize tables and copyable hostnames.

- [ ] **Step 3: Run TypeScript compile verification**
  Run: `npx tsc --noEmit`
  Expected: Exit code 0 (no compile errors)

- [ ] **Step 4: Commit the changes**
  Run:
  ```bash
  git add src/views/AdminView.tsx
  git commit -m "style: implement left sidebar navigation and layout cleanups for admin view"
  ```
