import type { Metadata } from 'next';
import { StatusPage } from '../../../../components/shell/StatusPage';

export const metadata: Metadata = { title: 'No zones · ZOAURO Admin' };

/** doc 18 section 1: a Zonal Admin with no assigned zone lands here. */
export default function Page() {
  return (
    <StatusPage title="You are not assigned to any zone yet">
      A Super Admin adds you to a zone team. Once that is done, your zones and their modules appear
      here; you may need to reload the page.
    </StatusPage>
  );
}
