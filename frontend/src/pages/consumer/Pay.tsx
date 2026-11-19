import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { money } from '../../format';
import { errMsg, useLoad } from '../../hooks';
import type { Payment } from '../../types';
import { Async, Banner, Button, Glass, PageHead, StatusBadge, useToast } from '../../ui';

interface PayData {
  payment: Payment;
  orders: { id: string; ref: string; status: string; paymentStatus: string; total: number; farmName: string }[];
}
type Outcome = 'SUCCESS' | 'DECLINED' | 'TIMEOUT';

export function Pay() {
  const { groupId = '' } = useParams();
  const toast = useToast();
  const data = useLoad(() => get<PayData>(`/payments/${groupId}`), [groupId]);
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const complete = async (outcome: Outcome) => {
    setBusy(outcome);
    setNote(null);
    try {
      const r = await post<{ status: string; duplicateIgnored: boolean }>(`/payments/${groupId}/mock-complete`, { outcome, duplicate });
      if (duplicate) setNote(r.duplicateIgnored ? 'The duplicate callback was received and safely ignored.' : 'Duplicate callback was sent.');
      await data.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  const retry = async () => {
    setBusy('RETRY');
    try {
      await post(`/payments/${groupId}/retry`);
      setNote(null);
      await data.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const pay = data.data?.payment;
  return (
    <>
      <PageHead title="Payment" subtitle="Complete your payment to confirm your order." />
      <Async loading={data.loading} error={data.error} onRetry={data.reload}>
        {data.data && pay && (
          <div className="two-col">
            <Glass className="stack" as="section" aria-label="Payment status">
              <div className="row between">
                <h2 style={{ margin: 0 }}>{money(pay.amount)}</h2>
                <StatusBadge status={pay.status} text={pay.status === 'SUCCESS' ? 'Paid' : undefined} />
              </div>

              {pay.status === 'SUCCESS' && (
                <>
                  <Banner kind="ok">✅ Payment received. The farmers have been notified.</Banner>
                  <Link className="btn primary" to="/orders">View my orders</Link>
                </>
              )}

              {pay.status === 'FAILED' && (
                <>
                  <Banner kind="error">Payment failed{pay.failureReason ? `: ${pay.failureReason}` : ''}. Your order is not confirmed yet.</Banner>
                  <div className="row">
                    <Button variant="primary" busy={busy === 'RETRY'} onClick={retry}>Retry payment</Button>
                    <Link className="btn" to="/orders">Back to orders</Link>
                  </div>
                </>
              )}

              {pay.status === 'PENDING' && (
                pay.mockGateway ? (
                  <div className="stack">
                    <Banner kind="info"><strong>Simulated payment gateway.</strong> No real money moves. Pick an outcome to test how the platform reacts.</Banner>
                    <div className="row">
                      <Button variant="primary" busy={busy === 'SUCCESS'} disabled={!!busy} onClick={() => complete('SUCCESS')}>Pay successfully</Button>
                      <Button variant="danger" busy={busy === 'DECLINED'} disabled={!!busy} onClick={() => complete('DECLINED')}>Decline card</Button>
                      <Button busy={busy === 'TIMEOUT'} disabled={!!busy} onClick={() => complete('TIMEOUT')}>Simulate timeout</Button>
                    </div>
                    <label className="checkbox">
                      <input type="checkbox" checked={duplicate} onChange={(e) => setDuplicate(e.target.checked)} />
                      Also send the callback twice (tests idempotency)
                    </label>
                  </div>
                ) : (
                  <Banner kind="warn">Waiting for the payment provider to confirm. This page updates when you refresh.</Banner>
                )
              )}
              {note && <Banner kind="info">{note}</Banner>}
              {pay.attempts > 1 && <p className="small muted">Attempt {pay.attempts}</p>}
            </Glass>

            <Glass as="section" aria-label="Orders in this payment">
              <h3>Orders in this payment</h3>
              {data.data.orders.map((o) => (
                <div className="line" key={o.id}>
                  <div className="grow"><strong>#{o.ref}</strong><div className="small muted">{o.farmName}</div></div>
                  <StatusBadge status={o.paymentStatus} />
                  <strong>{money(o.total)}</strong>
                </div>
              ))}
            </Glass>
          </div>
        )}
      </Async>
    </>
  );
}
