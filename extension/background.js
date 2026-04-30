// Service worker MV3: hace la llamada a la API de Claude (evita CORS desde la página)
// y devuelve el texto del juicio al content script.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'callClaude') {
    callClaude(msg.payload)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // mantener canal abierto para respuesta async
  }
});

async function callClaude({ apiKey, model, system, userMsg, maxTokens }) {
  if (!apiKey) throw new Error('Falta API key de Claude');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 1024,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Respuesta no JSON: ${raw.slice(0, 200)}`); }
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  if (!text) throw new Error('Respuesta vacía de Claude');
  return text;
}
