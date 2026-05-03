const DEFAULTS = {
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-sonnet-4-5',
  maxChars: 280,
  tone: 'Profesional, claro, conciso, en español rioplatense. Siempre en TERCERA PERSONA refiriéndose al/la estudiante (nunca "vos", "tú" ni "usted"). Evitar adjetivos exagerados y opiniones sobre la familia.',
  compararConAnterior: true,
  rendUsarRango: false,
  rendMin: 4,
  rendMax: 7,
  usarBanco: false,
  bancoJuicios: '',
  bancoFallbackIA: true,
  bancoPlataformaAddendum: 'No debe descuidar las entregas en plataforma.',
  rubrica1: 'No entregó el trabajo o no presentó evidencia (ausencia de producción). Mencionar como entrega pendiente cuando corresponda.',
  rubrica24: 'Producciones insuficientes (notas menores a 5). Reconocer las dificultades pero adoptar tono CONSTRUCTIVO y POSITIVO: subrayar el margen de mejora y los aspectos puntuales a fortalecer; evitar etiquetas desmoralizantes.',
  rubrica56: 'Trabajo satisfactorio: cumple con lo solicitado.',
  rubrica78: 'Muy buen trabajo: se destaca en varios aspectos.',
  rubrica910: 'Trabajo destacado: producción de alta calidad.',
};

// Por proveedor recordamos qué API key cargó el docente y qué modelo eligió,
// así puede alternar sin pegar la key cada vez.
const PER_PROVIDER_KEYS = 'siged_provider_keys'; // { providerId: { apiKey, model } }

const FIELDS = [
  'apiKey', 'model', 'maxChars', 'tone',
  'compararConAnterior',
  'rendUsarRango', 'rendMin', 'rendMax',
  'usarBanco', 'bancoJuicios', 'bancoFallbackIA', 'bancoPlataformaAddendum',
  'rubrica1', 'rubrica24', 'rubrica56', 'rubrica78', 'rubrica910',
];

const $ = (id) => document.getElementById(id);

function setFieldValue(id, value) {
  const el = $(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value == null ? '' : String(value);
}

function getFieldValue(id) {
  const el = $(id);
  if (!el) return undefined;
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') {
    const n = parseFloat((el.value || '').replace(',', '.'));
    return Number.isNaN(n) ? 0 : n;
  }
  return (el.value || '').trim();
}

function populateProviders(currentId) {
  const sel = $('provider');
  sel.innerHTML = '';
  for (const id of Object.keys(SIGED_PROVIDERS)) {
    const p = SIGED_PROVIDERS[id];
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.label + (p.free ? ' 🆓' : '');
    sel.appendChild(opt);
  }
  sel.value = currentId in SIGED_PROVIDERS ? currentId : 'anthropic';
}

function populateModels(providerId, currentModel) {
  const sel = $('model');
  sel.innerHTML = '';
  const p = SIGED_PROVIDERS[providerId];
  if (!p) return;
  for (const m of p.models) {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  // Si el modelo guardado no existe en este proveedor, usamos el primero.
  if (currentModel && Array.from(sel.options).some((o) => o.value === currentModel)) {
    sel.value = currentModel;
  } else {
    sel.selectedIndex = 0;
  }
}

function refreshProviderHelp(providerId) {
  const p = SIGED_PROVIDERS[providerId];
  if (!p) return;
  const help = $('apiKeyHelp');
  if (help) {
    help.href = p.apiKeyUrl;
    help.textContent = `¿Cómo obtenerla? (${p.apiKeyUrl})`;
  }
  const ak = $('apiKey');
  if (ak) ak.placeholder = p.apiKeyHint || 'API key';
}

async function load() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  populateProviders(cfg.provider || DEFAULTS.provider);
  // Cargar key/modelo por proveedor si existen.
  const perProvider = (await chrome.storage.local.get(PER_PROVIDER_KEYS))[PER_PROVIDER_KEYS] || {};
  const providerId = $('provider').value;
  const remembered = perProvider[providerId] || {};
  populateModels(providerId, remembered.model || cfg.model);
  refreshProviderHelp(providerId);

  // Carga de campos generales.
  for (const k of FIELDS) {
    if (k === 'apiKey' || k === 'model') continue;
    setFieldValue(k, cfg[k] ?? DEFAULTS[k]);
  }
  // ApiKey: la del proveedor actual (no la global).
  setFieldValue('apiKey', remembered.apiKey || cfg.apiKey || '');
}

function showStatus(msg, cls) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'hint ' + (cls || '');
}

async function save() {
  const providerId = $('provider').value || DEFAULTS.provider;
  const cfg = {};
  for (const k of FIELDS) cfg[k] = getFieldValue(k);
  cfg.provider = providerId;
  cfg.maxChars = Math.max(80, Math.min(2000, cfg.maxChars || DEFAULTS.maxChars));
  if (!cfg.tone) cfg.tone = DEFAULTS.tone;
  cfg.rendMin = Math.max(1, Math.min(10, cfg.rendMin || DEFAULTS.rendMin));
  cfg.rendMax = Math.max(1, Math.min(10, cfg.rendMax || DEFAULTS.rendMax));
  if (cfg.rendMin >= cfg.rendMax) {
    cfg.rendUsarRango = false;
    showStatus('⚠ Rango Rend inválido (min ≥ max). Lo deshabilité.', 'err');
  }
  for (const k of ['rubrica1', 'rubrica24', 'rubrica56', 'rubrica78', 'rubrica910']) {
    if (!cfg[k]) cfg[k] = DEFAULTS[k];
  }
  await chrome.storage.local.set(cfg);

  // Guardamos también la key/modelo por proveedor para que el docente pueda
  // alternar entre proveedores sin re-pegar la key cada vez.
  const stored = (await chrome.storage.local.get(PER_PROVIDER_KEYS))[PER_PROVIDER_KEYS] || {};
  stored[providerId] = { apiKey: cfg.apiKey, model: cfg.model };
  await chrome.storage.local.set({ [PER_PROVIDER_KEYS]: stored });

  showStatus(cfg.apiKey || cfg.usarBanco
    ? `Configuración guardada ✓ (proveedor: ${SIGED_PROVIDERS[providerId].label})`
    : 'Configuración guardada (falta API key o activá el banco).',
    cfg.apiKey || cfg.usarBanco ? 'ok' : 'err');
}

async function reset() {
  await chrome.storage.local.set(DEFAULTS);
  await chrome.storage.local.set({ [PER_PROVIDER_KEYS]: {} });
  await load();
  showStatus('Valores restaurados a los defaults.', 'ok');
}

document.addEventListener('DOMContentLoaded', async () => {
  await load();
  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', reset);

  // Cuando cambia el proveedor, actualizamos modelos, ayuda y key recordada.
  $('provider').addEventListener('change', async () => {
    const providerId = $('provider').value;
    const stored = (await chrome.storage.local.get(PER_PROVIDER_KEYS))[PER_PROVIDER_KEYS] || {};
    const remembered = stored[providerId] || {};
    populateModels(providerId, remembered.model);
    refreshProviderHelp(providerId);
    setFieldValue('apiKey', remembered.apiKey || '');
  });
});
