# 19 — UI/UX Design System

Source of truth: the Figma prototype; tokens below are defaults to be replaced by exact Figma values (task F0.6, log in doc 32). Approximate values read from screenshots: doc 37 §3.

## 1. Foundations
| Element | Direction |
|---|---|
| Sidebar | Dark navy / blue gradient, clear active state; Zonal Admin uses blue gradient with orange active item |
| Workspace | Light neutral background |
| Cards | Rounded corners (12px), subtle shadow |
| Primary action | Single brand accent |
| Typography | Clean sans-serif (Inter or Figma font); scale 12/14/16/20/24/32; headings 600 weight |
| Icons | lucide-react, consistent line style, 20px default |
| Spacing | 4px base grid: 4, 8, 12, 16, 24, 32, 48 |
| Radius | 6 (inputs), 12 (cards), 999 (badges) |

## 2. Colour tokens
Semantic tokens in CSS variables mapped to Tailwind: `--primary`, `--sidebar-from`, `--sidebar-to`, `--accent-orange`, `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--success` (green), `--warning` (orange), `--danger` (red), `--neutral`.
Status mapping: Active/Delivered/Paid = green; Pending/Preparing/Awaiting = orange; Cancelled/Failed/Suspended = red; Inactive/Draft = neutral; Assigned/Out for delivery = blue.

## 3. Components (shadcn/ui + Radix)
Button (primary, secondary, ghost, destructive), Input, Select, Combobox, Textarea, Checkbox, Switch, Radio, DatePicker and range, Tabs, Table, Badge, Card, Dialog/Sheet (overlays for add/edit), Dropdown menu, Popover (filters), Toast, Tooltip, Skeleton, Pagination, Breadcrumb, Avatar, Stepper, Charts (Recharts, with legends).

## 4. Interaction states
Default, hover, focus (2px visible ring), active, disabled, loading (spinner + disabled), error (red border + message), success (toast). Destructive actions need confirmation dialog naming the target. Toasts for save/update/error, auto-dismiss 4 s, errors persist until dismissed.

## 5. Forms
Labels above fields, required marker `*`, helper text, inline validation on blur and on submit, first invalid field focused, submit disabled while pending, unsaved-changes guard.

## 6. Tables
Sticky header, readable column widths, status badges, row action menu, column sort, sticky pagination footer, empty/loading/error states (doc 22).

## 7. Responsive behaviour
Desktop-first ≥ 1280px; 1024–1279 collapsible sidebar; < 1024 drawer sidebar, tables horizontal scroll, cards stack. Panel is not optimised for phones.

## 8. Accessibility (WCAG 2.1 AA)
Contrast ≥ 4.5:1; keyboard operable; Radix focus management; labels and ARIA for icon buttons; no colour-only status (badge text always present); reduced-motion respected; screen-reader announcements for toasts.

## 9. Content style
Sentence case; verbs on buttons ("Save changes", "Approve restaurant"); currency in Indian grouping (`₹12,48,320`, `Intl.NumberFormat('en-IN')`); dates `09 Oct 2026, 14:30` in configured timezone.
