// Service worker MV3: hace la llamada a la API del proveedor de IA elegido
// (evita CORS desde la página) y devuelve el texto al content script.

importScripts('providers.js');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  // Mensaje genérico nuevo
  if (msg.type === 'callAi') {
    callAi(msg.payload)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  // Compatibilidad con versiones previas: callClaude → forzamos proveedor anthropic.
  if (msg.type === 'callClaude') {
    const payload = Object.assign({}, msg.payload, { provider: 'anthropic' });
    callAi(payload)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
});

async function callAi({ provider, apiKey, model, system, userMsg, maxTokens }) {
  const id = provider || 'anthropic';
  const p = SIGED_PROVIDERS[id];
  if (!p) throw new Error(`Proveedor desconocido: ${id}`);
  if (!apiKey) throw new Error(`Falta API key del proveedor ${p.label || id}.`);
  if (!model) throw new Error(`Falta modelo (proveedor: ${id}).`);

  const url = p.url(model, apiKey);
  const headers = p.headers(apiKey);
  const body = p.body(model, system, userMsg, maxTokens || 1024);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`[${p.label || id}] HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`[${p.label || id}] respuesta no JSON: ${raw.slice(0, 200)}`); }
  const text = p.extract(data);
  if (!text) throw new Error(`[${p.label || id}] respuesta vacía. Cuerpo: ${raw.slice(0, 200)}`);
  return text;
}
