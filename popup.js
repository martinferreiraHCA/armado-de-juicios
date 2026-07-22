// Popup: resumen rápido del estado + acceso a la página de configuración
// completa (options.html). Toda la edición se hace en la página de opciones.

const MODO_LABEL = {
  ia: '🤖 Solo IA',
  banco: '🗂️ Banco de juicios',
  plantilla: '📝 Plantillas (sin IA)',
  mixto: '🔀 Mixto (banco + IA)',
};

const PLANTILLA_BANDAS = ['plantilla1', 'plantilla24', 'plantilla56', 'plantilla78', 'plantilla910'];

function abrirOpciones(hash) {
  const url = chrome.runtime.getURL('options.html') + (hash ? '#' + hash : '');
  chrome.tabs.create({ url });
  window.close();
}

async function pintarEstado() {
  const cfg = await chrome.storage.local.get(null);
  let modo = cfg.modoGeneracion;
  if (!['ia', 'banco', 'plantilla', 'mixto'].includes(modo)) modo = 'ia';

  const tieneBanco = !!(cfg.bancoJuicios || '').trim();
  const tienePlantillas = PLANTILLA_BANDAS.some((k) => !!(cfg[k] || '').trim());
  const perProvider = cfg.siged_provider_keys || {};
  const provider = cfg.provider || 'anthropic';
  const apiKey = (perProvider[provider] || {}).apiKey || cfg.apiKey || '';

  const listo = (modo === 'ia' && !!apiKey)
    || (modo === 'banco' && tieneBanco)
    || (modo === 'plantilla' && tienePlantillas)
    || (modo === 'mixto' && (!!apiKey || tieneBanco));

  const provLabel = (typeof SIGED_PROVIDERS !== 'undefined' && SIGED_PROVIDERS[provider])
    ? SIGED_PROVIDERS[provider].label : provider;

  document.getElementById('estadoModo').textContent = MODO_LABEL[modo] || modo;
  const det = document.getElementById('estadoDet');
  const caja = document.getElementById('estado');
  if (listo) {
    const partes = [];
    if (modo === 'ia' || modo === 'mixto') partes.push(provLabel);
    if (modo === 'banco' || modo === 'mixto') partes.push('banco cargado');
    if (modo === 'plantilla') partes.push('frases configuradas');
    partes.push(`máx ${cfg.maxChars || 280} caracteres`);
    det.textContent = '✓ Listo para generar · ' + partes.join(' · ');
    caja.classList.remove('warn');
  } else {
    const falta = modo === 'banco' ? 'el banco está vacío'
      : modo === 'plantilla' ? 'no hay frases configuradas'
      : modo === 'mixto' ? 'falta API key y/o banco'
      : 'falta la API key';
    det.textContent = '⚠ Falta configurar: ' + falta;
    caja.classList.add('warn');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  pintarEstado();
  document.getElementById('abrirConfig').addEventListener('click', () => abrirOpciones(''));
  for (const btn of document.querySelectorAll('.atajos button')) {
    btn.addEventListener('click', () => abrirOpciones(btn.getAttribute('data-tab')));
  }
});
