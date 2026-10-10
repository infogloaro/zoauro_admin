# 23 — Frontend State and Data-Fetching Plan (v1.1)

## 1. Principles
Server first. Default to Server Components for reading, calling the Express API through the generated client with the forwarded session cookie (no Prisma in `apps/web`); client components only for interaction. No global store for server data.

## 2. State types
| Kind | Tool |
|---|---|
| Server data on pages | Server Components calling `/api/v1` via the generated client (cached per request) |
| Interactive lists (tables, filters, live data) | TanStack Query hitting `/api/v1` |
| URL state (filters, pagination, tabs, **zone scope `?zone=`**) | `nuqs` or `useSearchParams`, source of truth |
| Form state | React Hook Form + Zod resolver |
| UI state (dialogs, sidebar) | Local state or small Zustand store |
| Session / permissions | Loaded in layout, provided via context (read only) |

## 3. Query keys and caching
Keys: `[module, "list", scope, filters]`, `[module, "detail", id]`, `["dashboard", range, scope]`, `["me"]` where `scope` = sorted zone ids or `ALL`. Changing the switcher changes the key, so scopes never share cache. staleTime: lists 15 s, detail 30 s, dashboard 60 s, settings 5 min. Server-side cache (Redis) for dashboard aggregates 30–60 s.

## 4. Mutations and invalidation
After a mutation invalidate `[module, "list"]` and `[module, "detail", id]`; orders mutations also invalidate dashboard. Next Server Actions are not used for data writes; mutations go through the Express API.

## 5. Optimistic updates
Allowed for toggles (availability, featured, vendor status in lists). Not allowed for money (refunds, payments), order transitions (wait for server), permission changes. On error roll back and toast.

## 6. Real-time
Orders list and dashboard order-status: Socket.IO events from the user's zone rooms trigger query invalidation; polling every 15 s while tab visible is the fallback. On `scope.changed`, refetch `["me"]` and invalidate everything. Pause polling when hidden. Show "Updated 5 s ago" and new-order highlight with optional sound toggle.

## 7. Error and conflict handling
401 → redirect to login with `next`; 403 → forbidden state; 404 → not-found (including a zone removed mid-session: show "no longer available" and refetch `["me"]`); 409 version conflict → refetch and prompt; 422 → map to form fields; 5xx → toast + retry; network offline banner.

## 8. Performance
Route-level code splitting; dynamic import charts; image optimisation; virtualised long tables only if > 200 visible rows; debounce search 300 ms; prefetch detail on row hover.

## 9. Type safety
API client generated from OpenAPI; shared Zod schemas for form and server; no hand-written fetch calls in components.
