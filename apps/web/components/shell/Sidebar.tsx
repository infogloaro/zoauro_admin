import { cn } from '../../lib/utils';
import type { MenuItem, ShellRole } from '../../lib/navigation';

// One sidebar for both roles (doc 18 section 6), built from lib/navigation. Every entry is a plain link in the tab order;
// a module that is not built yet is shown dimmed with a "Coming Soon" badge and opens its explanation page. Super Admin
// uses a blue active item, Zonal Admin an orange one (doc 19 section 1).

export function isActive(href: string, activePath: string): boolean {
  return activePath === href || activePath.startsWith(`${href}/`);
}

export function Sidebar({
  items,
  userRole: role,
  activePath,
}: {
  items: MenuItem[];
  userRole: ShellRole;
  activePath: string;
}) {
  const activeBg = role === 'ZONAL_ADMIN' ? 'bg-accent-orange' : 'bg-sidebar-active';
  return (
    <nav
      aria-label="Main"
      className="flex h-full flex-col overflow-y-auto bg-gradient-to-b from-sidebar-from to-sidebar-to px-3 py-4 text-sidebar-text"
    >
      <div className="mb-6 px-3 text-lg font-semibold text-white">ZOAURO Admin</div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(item.href, activePath);
          const soon = item.status === 'coming-soon';
          return (
            <li key={item.id}>
              <a
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={soon ? `${item.label} (coming soon)` : undefined}
                data-status={item.status}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-input px-3 py-2 text-sm',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                  active ? `${activeBg} font-semibold text-white` : 'hover:bg-white/10',
                  soon && !active && 'text-sidebar-text/70',
                )}
              >
                <span>{item.label}</span>
                {soon ? (
                  <span
                    aria-hidden
                    className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase"
                  >
                    Coming Soon
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
