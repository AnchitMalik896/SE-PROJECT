import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/http.js';
import { audit, notify } from '../lib/notify.js';

export type OrderStatus = 'PLACED' | 'ACCEPTED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PACKED', 'CANCELLED'],
  PACKED: ['DISPATCHED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function assertTransition(from: string, to: string) {
  const allowed = TRANSITIONS[from as OrderStatus] ?? [];
  if (!allowed.includes(to as OrderStatus)) {
    throw new HttpError(409, `An order that is ${from.toLowerCase()} cannot be changed to ${to.toLowerCase()}`);
  }
}

export type Canceller = 'CONSUMER' | 'FARMER' | 'ADMIN' | 'SYSTEM';

export async function cancelOrder(orderId: string, reason: string, by: Canceller, actorId: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, delivery: true } });
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status === 'CANCELLED') throw new HttpError(409, 'This order is already cancelled');
    const cancellable = by === 'ADMIN' ? ['PLACED', 'ACCEPTED', 'PACKED', 'DISPATCHED'] : ['PLACED', 'ACCEPTED'];
    if (!cancellable.includes(order.status)) {
      throw new HttpError(
        409,
        order.status === 'DELIVERED'
          ? 'Delivered orders cannot be cancelled'
          : 'This order has already been packed and can no longer be cancelled',
      );
    }

    for (const it of order.items) {
      await tx.product.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
    }

    let refunded = 0;
    const payment = await tx.payment.findUnique({ where: { groupId: order.groupId } });
    if (order.paymentStatus === 'PAID' && payment) {
      await tx.refund.create({ data: { paymentId: payment.id, orderId: order.id, amount: order.total, reason } });
      refunded = order.total;
    } else if (payment && payment.status !== 'SUCCESS') {
      // unpaid: the pending payment no longer needs to cover this order
      const remaining = await tx.order.findMany({
        where: { groupId: order.groupId, status: { not: 'CANCELLED' }, id: { not: order.id } },
      });
      if (remaining.length === 0) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureReason: 'Order cancelled', amount: 0 },
        });
      } else {
        await tx.payment.update({ where: { id: payment.id }, data: { amount: { decrement: order.total } } });
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        cancelReason: reason,
        paymentStatus: refunded ? 'REFUNDED' : order.paymentStatus === 'PAID' ? 'PAID' : order.paymentStatus,
        payoutStatus: refunded ? 'REFUNDED' : order.payoutStatus,
        deliveryOtp: null,
      },
    });

    if (order.delivery && order.delivery.status !== 'DELIVERED') {
      await tx.delivery.update({
        where: { id: order.delivery.id },
        data: { status: 'FAILED', failureReason: `Order cancelled: ${reason}`, lat: null, lng: null },
      });
      if (order.delivery.deliveryPersonId) {
        await notify(order.delivery.deliveryPersonId, 'DELIVERY', `Delivery for order #${short(order.id)} was cancelled.`, tx);
      }
    }

    const ref = `#${short(order.id)}`;
    if (by !== 'CONSUMER') {
      await notify(
        order.consumerId,
        'ORDER',
        `Your order ${ref} was cancelled${refunded ? ' and a refund has been started' : ''}. Reason: ${reason}`,
        tx,
      );
    } else if (refunded) {
      await notify(order.consumerId, 'PAYMENT', `Refund started for cancelled order ${ref}.`, tx);
    }
    if (by !== 'FARMER') {
      await notify(order.farmerId, 'ORDER', `Order ${ref} was cancelled. Stock has been restored.`, tx);
    }
    await audit(actorId, 'ORDER_CANCELLED', `order:${order.id}`, `by=${by}; refunded=${refunded}; reason=${reason}`, tx);
    return { orderId: order.id, refunded };
  });
  return result;
}

export const short = (id: string) => id.slice(-6).toUpperCase();

/** Cancels orders that were placed but never paid within the expiry window, releasing their stock. */
export async function expireUnpaidOrders() {
  const cutoff = new Date(Date.now() - config.unpaidOrderExpiryMinutes * 60_000);
  const stale = await prisma.order.findMany({
    where: { status: 'PLACED', paymentStatus: { in: ['PENDING', 'FAILED'] }, createdAt: { lt: cutoff } },
    select: { id: true },
  });
  let n = 0;
  for (const o of stale) {
    try {
      await cancelOrder(o.id, 'Payment not completed in time', 'SYSTEM', null);
      n++;
    } catch {
      /* already changed concurrently */
    }
  }
  return n;
}
