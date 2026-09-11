export const thresholds = Object.freeze([0, 0, 0, 0, 0, 2, 4, 6, 8, 10, 12, 14]);
export const requiredDocuments = Object.freeze(['terms', 'privacy', 'profile']);
export function validRoom(id, weeks) {
  const match = /^MFP-RM-(\d{3})$/.exec(id || '');
  const n = match ? Number(match[1]) : 0;
  return n >= 1 && n <= thresholds.length && Number.isInteger(weeks) && weeks >= thresholds[n - 1];
}
export function hasAccess(subscription, priceId, now = Date.now() / 1000) {
  const items = subscription?.items?.data || [];
  return subscription?.status === 'active' && items.length === 1 &&
    items[0].price?.id === priceId && items[0].quantity === 1 &&
    items[0].current_period_end > now && subscription.latest_invoice?.status === 'paid';
}
export function validOffer(price, coupon, live) {
  return price?.active === true && price.livemode === live && price.currency === 'eur' &&
    price.unit_amount === 1999 && price.type === 'recurring' &&
    price.recurring?.interval === 'month' && price.recurring.interval_count === 1 &&
    price.tax_behavior === 'inclusive' && coupon?.valid === true && coupon.livemode === live &&
    coupon.amount_off === 500 && coupon.currency === 'eur' && !coupon.percent_off &&
    coupon.duration === 'repeating' && coupon.duration_in_months === 3 &&
    (!coupon.applies_to?.products || coupon.applies_to.products.includes(typeof price.product === 'string' ? price.product : price.product?.id));
}
export function documentsReady(documents) {
  return documents.length === 3 && requiredDocuments.every(kind => documents.some(d =>
    d.kind === kind && d.approved_at && d.active && typeof d.body === 'string' && d.body.trim().length > 0));
}
export function acceptedCurrent(documents, acceptances) {
  return documentsReady(documents) && documents.every(d => acceptances.some(a => a.document_id === d.id));
}
