// netlify/functions/match-models.js
//
// Agente de casting con IA: lee el brief de una campaña y el catálogo de
// modelos aprobadas, y sugiere cuáles calzan mejor, con motivo y score.
//
// Usa la API de Claude (Anthropic). La API key SOLO vive aquí (variable de
// entorno de Netlify), nunca en el HTML/JS del navegador.
//
// Variable de entorno requerida en Netlify (Site settings → Environment variables):
//   ANTHROPIC_API_KEY = tu API key de la consola de Anthropic

const SB = 'https://vzgzalcvkzttsrjlisfs.supabase.co';
const SK = 'sb_publishable_bek0hK20motWCQ4a5qznEA_GmyXhs93'; // misma anon key ya pública en panel.html

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido.' }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar ANTHROPIC_API_KEY en Netlify.' }) };
  }

  let campanaId;
  try {
    const body = JSON.parse(event.body || '{}');
    campanaId = body.campanaId;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cuerpo inválido.' }) };
  }
  if (!campanaId) return { statusCode: 400, body: JSON.stringify({ error: 'Falta campanaId.' }) };

  try {
    // 1. Traer la campaña real desde Supabase.
    const campRes = await fetch(`${SB}/rest/v1/campanas?id=eq.${encodeURIComponent(campanaId)}&select=*`, {
      headers: { apikey: SK, Authorization: `Bearer ${SK}` },
    });
    const camps = await campRes.json();
    const camp = camps[0];
    if (!camp) return { statusCode: 404, body: JSON.stringify({ error: 'Campaña no encontrada.' }) };

    // 2. Traer modelos aprobadas — solo los campos que importan para decidir (sin fotos, para no inflar el prompt).
    const fields = 'id,nombre_artistico,nombre_completo,edad,ciudad,nacionalidad,estatura,medidas,talla_ropa,cabello,ojos,tatuajes,categorias,experiencia,disponible_viajar,pasaporte,internacional,whatsapp';
    const modsRes = await fetch(`${SB}/rest/v1/models?status=eq.aprobada&select=${fields}`, {
      headers: { apikey: SK, Authorization: `Bearer ${SK}` },
    });
    const models = await modsRes.json();
    if (!models.length) {
      return { statusCode: 200, body: JSON.stringify({ sugerencias: [], nota: 'No hay modelos aprobadas en el catálogo.' }) };
    }

    // 3. Armar el prompt.
    const briefing = {
      titulo: camp.titulo, tipo: camp.tipo, ciudad: camp.ciudad, fecha: camp.fecha,
      num_modelos: camp.num_modelos, perfil_buscado: camp.perfil_buscado, descripcion: camp.descripcion,
    };
    const catalogo = models.map(m => ({
      id: m.id, nombre: m.nombre_artistico || m.nombre_completo, edad: m.edad, ciudad: m.ciudad,
      nacionalidad: m.nacionalidad, estatura: m.estatura, medidas: m.medidas, talla: m.talla_ropa,
      cabello: m.cabello, ojos: m.ojos, tatuajes: m.tatuajes, categorias: m.categorias,
      experiencia: m.experiencia, disponible_viajar: m.disponible_viajar, pasaporte: m.pasaporte,
      internacional: m.internacional,
    }));

    const system = `Eres el agente de casting de AG Elite Models, una agencia de modelos. Tu trabajo es revisar el brief de una campaña y el catálogo de modelos aprobadas, y sugerir cuáles calzan mejor para ese proyecto específico.
Responde SOLO con un JSON válido, sin texto antes ni después ni bloques de código, con esta forma exacta:
{"sugerencias":[{"id":"<id del modelo>","score":<número 0-100>,"motivo":"<una frase corta y concreta de por qué calza>"}]}
Ordena por score descendente. Sugiere como máximo 8 modelos. Solo incluye a quienes realmente tengan sentido para el brief — no rellenes la lista si no calzan bien. Si ninguno calza, devuelve una lista vacía.`;

    const userMsg = `BRIEF DE LA CAMPAÑA:\n${JSON.stringify(briefing, null, 2)}\n\nCATÁLOGO DE MODELOS DISPONIBLES:\n${JSON.stringify(catalogo, null, 2)}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Error consultando la IA.', detail }) };
    }
    const aiData = await aiRes.json();
    const rawText = (aiData.content || []).map(b => b.text || '').join('').trim();

    let parsed;
    try {
      const clean = rawText.replace(/^```json\s*|```\s*$/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'La IA no devolvió un JSON válido.', raw: rawText }) };
    }

    const sugerencias = (parsed.sugerencias || [])
      .map(s => {
        const m = models.find(x => x.id === s.id);
        return m ? { ...s, nombre: m.nombre_artistico || m.nombre_completo, ciudad: m.ciudad, whatsapp: m.whatsapp } : null;
      })
      .filter(Boolean);

    // 4. Cachear el resultado en la campaña, para no tener que regenerar cada vez que se abre el detalle.
    await fetch(`${SB}/rest/v1/campanas?id=eq.${encodeURIComponent(camp.id)}`, {
      method: 'PATCH',
      headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ sugerencias_ia: sugerencias, sugerencias_ia_at: Date.now() }),
    });

    return { statusCode: 200, body: JSON.stringify({ sugerencias }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno.', detail: String(e) }) };
  }
};
