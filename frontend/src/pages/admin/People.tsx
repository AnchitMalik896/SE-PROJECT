import { useState } from 'react';
import { post } from '../../api';
import { errMsg, fieldErrs } from '../../hooks';
import { Banner, Button, Chips, Field, Glass, Modal, PageHead, useToast } from '../../ui';
import { UserDirectory } from './common';

function AddPartner({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setErr(null);
    setFields({});
    try {
      await post('/admin/delivery', f);
      toast.ok('Delivery partner added');
      onAdded();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setFields(fieldErrs(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Add delivery partner" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Add partner</Button></>}>
      {err && <Banner kind="error">{err}</Banner>}
      <Field label="Full name" value={f.name} onChange={set('name')} error={fields.name} autoComplete="off" />
      <Field label="Email" type="email" value={f.email} onChange={set('email')} error={fields.email} autoComplete="off" />
      <Field label="Phone" value={f.phone} onChange={set('phone')} error={fields.phone} autoComplete="off" />
      <Field label="Temporary password" type="password" value={f.password} onChange={set('password')} error={fields.password} hint="At least 8 characters with a letter and a number. Share it securely." autoComplete="new-password" />
    </Modal>
  );
}

export default function People() {
  const [tab, setTab] = useState<'CONSUMER' | 'DELIVERY'>('CONSUMER');
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  return (
    <div className="stack">
      <PageHead title="People" subtitle="Customers and delivery partners" actions={tab === 'DELIVERY' && <Button variant="primary" onClick={() => setAdding(true)}>+ Add delivery partner</Button>} />
      <Chips value={tab} onChange={setTab} options={[{ value: 'CONSUMER', label: 'Customers' }, { value: 'DELIVERY', label: 'Delivery partners' }]} />
      <Glass>
        <UserDirectory key={tab} role={tab} refreshKey={tick} emptyText={tab === 'DELIVERY' ? 'Add a delivery partner to get started.' : 'Try a different search or filter.'} />
      </Glass>
      {adding && <AddPartner onClose={() => setAdding(false)} onAdded={() => setTick((t) => t + 1)} />}
    </div>
  );
}
