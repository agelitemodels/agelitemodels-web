// netlify/functions/business-insights.js
//
// Agente de estadísticas: recibe los números reales de la agencia (ya calculados
// en el panel — facturación, comisiones, catálogo de modelos, campañas) y le pide
// a Claude que redacte un resumen ejecutivo profesional con hallazgos y
// recomendaciones concretas.
//
// La API key SOLO vive aquí (variable de entorno de Netlify), nunca en el HTML/JS.
//
// Variable de entorno requerida en Netlify:
//   ANTHROPIC_API_KEY = tu API key de la consola de Anthropic

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido.' }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar ANTHROPIC_API_KEY en Netlify.' }) };
  }

  let stats;
  try {
    const body = JSON.parse(event.body || '{}');
    stats = body.stats;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cuerpo inválido.' }) };
  }
  if (!stats) return { statusCode: 400, body: JSON.stringify({ error: 'Faltan los datos de la agencia.' }) };

  try {
    const system = `Eres el analista de negocio de AG Elite Models, una agencia de modelos en Medellín, Colombia. Te dan un JSON con las cifras reales de la agencia (finanzas, catálogo de modelos, campañas) y debes escribir un resumen ejecutivo breve y profesional en español, dirigido al dueño de la agencia.

Reglas:
- Nunca inventes cifras que no estén en los datos. Usa exactamente los números que te dan.
- Sé concreto: menciona cifras reales (en pesos colombianos con formato "$ 1.234.567"), no solo términos vagos.
- Estructura la respuesta en párrafos cortos (2-4 frases cada uno), sin encabezados ni markdown, sin viñetas — texto plano corrido, párrafo por párrafo, separados por saltos de línea.
- Cubre en este orden: (1) un vistazo general de cómo va el negocio, (2) lo financiero (facturación, comisión ganada vs. por cobrar, qué tan sano se ve el flujo de caja), (3) el catálogo de modelos (tamaño, cuántas están en revisión, si hay ciudades donde conviene reclutar más), (4) una o dos recomendaciones concretas y accionables para el dueño esta semana.
- Tono: directo, profesional, como un asesor de confianza — ni genérico ni excesivamente entusiasta. Si algún número es preocupante (por ejemplo mucho dinero pendiente de cobro), dilo con franqueza.
- Máximo 6 párrafos en total.`;

    const userMsg = `Estos son los datos actuales de la agencia:\n\n${JSON.stringify(stats, null, 2)}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 900,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Error consultando la IA.', detail }) };
    }
    const aiData = await aiRes.json();
    const analisis = (aiData.content || []).map(b => b.text || '').join('').trim();

    return { statusCode: 200, body: JSON.stringify({ analisis }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno.', detail: String(e) }) };
  }
};
