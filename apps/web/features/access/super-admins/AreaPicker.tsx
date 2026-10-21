'use client';

// D178: the Control Panel areas a primary grants a non-primary Super Admin, one checkbox each in the catalogue's order
// (GET /super-admins/areas).

export type Catalogue = readonly { key: string; label: string; description: string }[];

/** A checkbox per area, in the catalogue's order. */
export function AreaPicker({
  catalogue,
  value,
  onChange,
}: {
  catalogue: Catalogue;
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Control Panel areas</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {catalogue.map((a) => (
          <label
            key={a.key}
            className="grid grid-cols-[auto_1fr] items-start gap-x-2 rounded-input border border-line p-2 text-sm"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={value.includes(a.key)}
              onChange={(e) =>
                onChange(
                  catalogue
                    .map((c) => c.key)
                    .filter((k) => (k === a.key ? e.target.checked : value.includes(k))),
                )
              }
            />
            <span className="font-medium">{a.label}</span>
            <span className="col-start-2 text-xs text-muted">{a.description}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
