import { Glass, PageHead } from '../../ui';
import { UserDirectory } from './common';

export default function Farmers() {
  return (
    <div className="stack">
      <PageHead title="Farmers" subtitle="Manage farmer accounts and their listings" />
      <Glass>
        <h2>All farmers</h2>
        <UserDirectory role="FARMER" emptyText="Try a different search or filter." />
      </Glass>
    </div>
  );
}
