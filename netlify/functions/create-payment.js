// netlify/functions/create-payment.js
//
// Crea una preferencia de pago (checkout) de Mercado Pago para una campaña.
// El Access Token de Mercado Pago SOLO vive aquí (variable de entorno de Netlify),
// nunca en el HTML/JS del navegador.
//
// Variable de entorno requerida en Netlify (Site settings → Environment variables):
//   MP_ACCESS_TOKEN = tu Access Token de Mercado Pago (AG Elite Models)

const SB = 'https://vzgzalcvkzttsrjlisfs.supabase.co';
const SK = 'sb_publishable_bek0hK20motWCQ4a5qznEA_GmyXhs93'; // misma anon key ya pública en panel.html

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido.' }) };
  }

  let campanaId, clienteId;
  try {
    const body = JSON.parse(event.body || '{}');
    campanaId = body.campanaId;
    clienteId = body.clienteId;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cuerpo inválido.' }) };
  }
  if (!campanaId || !clienteId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos (campanaId, clienteId).' }) };
  }
  if (!process.env.MP_ACCESS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar MP_ACCESS_TOKEN en Netlify.' }) };
  }

  try {
    // 1. Leer la campaña real desde Supabase — NUNCA confiar en un monto enviado por el navegador.
    const campRes = await fetch(
      `${SB}/rest/v1/campanas?id=eq.${encodeURIComponent(campanaId)}&select=*`,
      { headers: { apikey: SK, Authorization: `Bearer ${SK}` } }
    );
    const camps = await campRes.json();
    const camp = camps[0];

    if (!camp) return { statusCode: 404, body: JSON.stringify({ error: 'Campaña no encontrada.' }) };
    if (camp.cliente_id !== clienteId) return { statusCode: 403, body: JSON.stringify({ error: 'No autorizado para pagar esta campaña.' }) };
    if (camp.status !== 'aprobada') return { statusCode: 400, body: JSON.stringify({ error: 'La campaña aún no está aprobada.' }) };
    if (camp.pago_estado === 'pagado') return { statusCode: 400, body: JSON.stringify({ error: 'Esta campaña ya fue pagada.' }) };

    const total = Math.round(Number(camp.valor_total) || 0);
    if (total <= 0) return { statusCode: 400, body: JSON.stringify({ error: 'La campaña no tiene un valor definido.' }) };

    const siteUrl = process.env.URL || 'https://agelitemodels.netlify.app';

    // 2. Crear la preferencia en Mercado Pago.
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [
          {
            title: `Campaña AG Elite Models: ${camp.titulo}`,
            quantity: 1,
            unit_price: total,
            currency_id: 'COP',
          },
        ],
        external_reference: camp.id,
        back_urls: {
          success: `${siteUrl}/panel.html?pago=success&campana=${camp.id}`,
          failure: `${siteUrl}/panel.html?pago=failure&campana=${camp.id}`,
          pending: `${siteUrl}/panel.html?pago=pending&campana=${camp.id}`,
        },
        auto_return: 'approved',
        notification_url: `${siteUrl}/.netlify/functions/mp-webhook`,
      }),
    });

    if (!mpRes.ok) {
      const detail = await mpRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Mercado Pago rechazó la solicitud.', detail }) };
    }
    const pref = await mpRes.json();

    // 3. Guardar el preference_id para trazabilidad (no confirma el pago, solo lo registra).
    await fetch(`${SB}/rest/v1/campanas?id=eq.${encodeURIComponent(camp.id)}`, {
      method: 'PATCH',
      headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ mp_preference_id: pref.id }),
    });

    return { statusCode: 200, body: JSON.stringify({ init_point: pref.init_point }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno.', detail: String(e) }) };
  }
};
