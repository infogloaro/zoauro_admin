import { cn } from '../../lib/utils';
import { fieldLabel, formatValue } from './format';

export type DiffChange = { field: string; before?: unknown; after?: unknown };

/** Field / before / after table for one audit row. Money fields (integer paise) are shown as rupees. */
export function DiffView({ changes, className }: { changes: DiffChange[]; className?: string }) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">No field changes recorded.</p>
    );
  }
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Field changes</caption>
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            <th scope="col" className="py-2 pr-3 font-medium">
              Field
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Before
            </th>
            <th scope="col" className="py-2 font-medium">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr
              key={c.field}
              className="border-b border-neutral-100 align-top dark:border-neutral-900"
            >
              <th scope="row" className="py-2 pr-3 font-medium">
                {fieldLabel(c.field)}
              </th>
              <td className="py-2 pr-3 break-words text-neutral-600 dark:text-neutral-400">
                {formatValue(c.field, c.before)}
              </td>
              <td className="py-2 break-words">{formatValue(c.field, c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
