'use strict';

const { receiptExpiry, signReceiptToken, readReceiptToken } = require('../helpers/receiptLinkToken');

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Lo que se enseña sin sesión: nada de consumerInfo ni clientSecret. */
function publicReceipt(tx) {
  const device = (Array.isArray(tx.device) ? tx.device : []).map((d) => ({
    deviceType: d?.deviceType ?? null,
    deviceNeeded: Number(d?.deviceNeeded ?? 0),
    deviceValue: money(d?.deviceValue),
  }));
  return {
    paymentIntent: tx.paymentIntent,
    active: tx.active !== false,
    status: tx.active === false ? 'refunded' : 'active',
    device,
    amount: money(device.reduce((sum, d) => sum + d.deviceValue * d.deviceNeeded, 0)),
    currency: 'usd',
    provider: tx.provider ?? null,
    eventSelected: tx.eventSelected ?? null,
    event_id: tx.event_id ?? null,
    date: tx.date ?? null,
    type: tx.type ?? null,
  };
}

function createReceiptLinkHandlers({ Transaction, Event, logger, now = () => new Date() }) {
  /**
   * POST /receipt-link — la propiedad del pago ya la comprobó
   * requirePaymentOwnership (req.paymentOwnership); aquí se ata el token a esa
   * compañía.
   */
  const issueReceiptLink = async (req, res) => {
    try {
      const paymentIntent = req.body?.paymentIntent;
      // La compañía DUEÑA del pago: la del contexto si lo es, si no la primera
      // registrada (super_user de plataforma emitiendo para otra compañía).
      const own = req.paymentOwnership ?? {};
      const owners = own.owners ?? [];
      const company = owners.find((o) => String(o) === String(own.companyId)) ?? owners[0] ?? null;
      const tx = await Transaction.findOne({ paymentIntent, ...(company ? { company: String(company) } : {}) })
        .select('event_id')
        .lean();
      if (!tx) return res.status(404).json({ ok: false, msg: 'Transaction not found' });

      const event = tx.event_id
        ? await Event.findById(tx.event_id).select('eventInfoDetail.dateBegin eventInfoDetail.dateEnd').lean().catch(() => null)
        : null;
      const expiresAt = receiptExpiry(event?.eventInfoDetail ?? {}, now());
      const token = signReceiptToken({ paymentIntent, company: String(company ?? '') }, expiresAt, now());
      if (!token) {
        return res.status(410).json({
          ok: false,
          msg: 'The event ended more than 30 days ago: this receipt can no longer be shared by link.',
          expiresAt,
        });
      }
      return res.status(200).json({ ok: true, token, expiresAt });
    } catch (error) {
      logger.error('receipt link: issue failed', { error: error.message });
      return res.status(500).json({ ok: false, msg: 'Could not create the receipt link' });
    }
  };

  /** GET /receipt — público, solo con el token del QR. */
  const getPublicReceipt = async (req, res) => {
    const token = req.query?.rt || (typeof req.header === 'function' ? req.header('x-receipt-token') : undefined);
    const claims = readReceiptToken(token);
    if (!claims) {
      return res.status(401).json({ ok: false, msg: 'This receipt link is invalid or has expired.' });
    }
    try {
      const tx = await Transaction.findOne({
        paymentIntent: claims.pi,
        ...(claims.company ? { company: claims.company } : {}),
      }).lean();
      if (!tx) return res.status(404).json({ ok: false, msg: 'Receipt not found' });
      return res.status(200).json({ ok: true, receipt: publicReceipt(tx), expiresAt: new Date(claims.exp * 1000) });
    } catch (error) {
      logger.error('receipt link: read failed', { error: error.message });
      return res.status(500).json({ ok: false, msg: 'Could not load the receipt' });
    }
  };

  return { issueReceiptLink, getPublicReceipt, publicReceipt };
}

module.exports = { createReceiptLinkHandlers, publicReceipt };
