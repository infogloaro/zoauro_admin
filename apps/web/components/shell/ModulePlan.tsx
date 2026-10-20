import { ArrowRight, CircleCheck, Hourglass, Layers, Link2, Workflow } from 'lucide-react';
import { NAV_GROUPS, type NavModule } from '../../lib/navigation';
import { PageHeader } from '../shared/PageHeader';
import { Badge } from '../ui/badge';
import { Card, CardBody, CardHeader } from '../ui/card';
import { NavIconGlyph } from './icons';

// The page of a module that is not built yet (P14 Coming Soon, extended with the owner's roadmap): what it will do, its
// planned screens, workflow states, the rules it must keep and what it depends on. No numbers or records are shown,
// because none exist until the module is built (doc 56: no fake data).

export function ModulePlan({ mod, homeHref }: { mod: NavModule; homeHref: string }) {
  const plan = mod.blueprint;
  const group = NAV_GROUPS.find((g) => g.id === mod.group)?.label ?? '';
  return (
    <div>
      <PageHeader
        title={mod.label}
        crumbs={[{ label: 'Dashboard', href: homeHref }, { label: group }, { label: mod.label }]}
        description={mod.description}
        badge={
          <>
            <Badge tone="brand" dot>
              Coming soon
            </Badge>
            {plan ? (
              <Badge tone={plan.phase === 'Phase 2' ? 'info' : 'neutral'}>{plan.phase}</Badge>
            ) : null}
          </>
        }
      />

      <div className="mb-6 flex items-start gap-4 rounded-card border border-orange-200 bg-gradient-to-r from-primary-soft to-surface p-5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface text-primary-strong shadow-card">
          <NavIconGlyph icon={mod.icon} className="size-6" />
        </span>
        <div>
          <p className="font-semibold text-text">
            This module is not available in this release yet.
          </p>
          <p className="mt-1 text-sm text-muted">
            Below is what it will contain. Nothing here is live data: records, numbers and actions
            appear once the module and its API are built.
          </p>
        </div>
      </div>

      {plan ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2" aria-labelledby="plan-screens">
            <CardHeader
              id="plan-screens"
              title={
                <span className="flex items-center gap-2">
                  <Layers aria-hidden className="size-4 text-primary-strong" /> Planned screens
                </span>
              }
            />
            <CardBody>
              <ol className="flex flex-col gap-3">
                {plan.screens.map((s, i) => (
                  <li key={s} className="flex gap-3 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-strong">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card aria-labelledby="plan-meta">
            <CardHeader
              id="plan-meta"
              title={
                <span className="flex items-center gap-2">
                  <Hourglass aria-hidden className="size-4 text-primary-strong" /> Release
                </span>
              }
            />
            <CardBody className="flex flex-col gap-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted uppercase">Phase</p>
                <p className="mt-0.5 font-medium">{plan.phase}</p>
              </div>
              {plan.roadmap ? (
                <div>
                  <p className="text-xs font-medium text-muted uppercase">Roadmap items</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {plan.roadmap.map((r) => (
                      <li key={r}>
                        <Badge>{r}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {plan.dependsOn ? (
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted uppercase">
                    <Link2 aria-hidden className="size-3.5" /> Depends on
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {plan.dependsOn.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {plan.flow ? (
            <Card className="lg:col-span-3" aria-labelledby="plan-flow">
              <CardHeader
                id="plan-flow"
                title={
                  <span className="flex items-center gap-2">
                    <Workflow aria-hidden className="size-4 text-primary-strong" /> Workflow
                  </span>
                }
                subtitle="The states a record moves through."
              />
              <CardBody>
                <ol className="flex flex-wrap items-center gap-2">
                  {plan.flow.map((step, i) => (
                    <li key={step} className="flex items-center gap-2">
                      <span className="rounded-full border border-line bg-surface-muted px-3 py-1.5 text-sm font-medium">
                        {step}
                      </span>
                      {i < (plan.flow?.length ?? 0) - 1 ? (
                        <ArrowRight aria-hidden className="size-4 text-muted" />
                      ) : null}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ) : null}

          {plan.rules ? (
            <Card className="lg:col-span-3" aria-labelledby="plan-rules">
              <CardHeader
                id="plan-rules"
                title={
                  <span className="flex items-center gap-2">
                    <CircleCheck aria-hidden className="size-4 text-primary-strong" /> Rules it will
                    keep
                  </span>
                }
              />
              <CardBody>
                <ul className="grid gap-3 md:grid-cols-2">
                  {plan.rules.map((r) => (
                    <li key={r} className="flex gap-2.5 text-sm">
                      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                      {r}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8">
        <a
          href={homeHref}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary-strong hover:underline"
        >
          Back to the dashboard <ArrowRight aria-hidden className="size-4" />
        </a>
      </div>
    </div>
  );
}
