// netlify/functions/mp-webhook.js
//
// Mercado Pago llama esta URL cuando un pago cambia de estado.
// Nunca confiamos en el aviso por sí solo: siempre re-consultamos el pago
// directamente contra la API de Mercado Pago usando el Access Token antes
// de marcar algo como pagado. Así una llamada falsa a esta URL no puede
// marcar una campaña como pagada sin que el pago sea real y esté aprobado.

const SB = 'https://vzgzalcvkzttsrjlisfs.supabase.co';
const SK = 'sb_publishable_bek0hK20motWCQ4a5qznEA_GmyXhs93';

exports.handler = async function (event) {
  try {
    const params = event.queryStringParameters || {};
    let paymentId = params['data.id'] || params.id;
    let topic = params.type || params.topic;

    if (!paymentId && event.body) {
      try {
        const body = JSON.parse(event.body);
        paymentId = (body.data && body.data.id) || paymentId;
        topic = body.type || topic;
      } catch (_) {}
    }

    // Solo nos interesan notificaciones de pago.
    if (!paymentId || (topic && topic !== 'payment')) {
      return { statusCode: 200, body: 'ignored' };
    }
    if (!process.env.MP_ACCESS_TOKEN) {
      return { statusCode: 200, body: 'missing-token' };
    }

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) return { statusCode: 200, body: 'payment-not-found' };
    const payment = await mpRes.json();

    if (payment.status === 'approved' && payment.external_reference) {
      await fetch(`${SB}/rest/v1/campanas?id=eq.${encodeURIComponent(payment.external_reference)}`, {
        method: 'PATCH',
        headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          pago_estado: 'pagado',
          mp_payment_id: String(payment.id),
          pagado_at: Date.now(),
        }),
      });
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    // Siempre respondemos 200 para que Mercado Pago no reintente indefinidamente.
    return { statusCode: 200, body: 'error-handled' };
  }
};
