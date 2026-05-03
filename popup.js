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
  // Modo de generación: 'ia' (solo IA), 'banco' (solo banco) o 'mixto' (banco + IA respaldo).
  modoGeneracion: 'ia',
  bancoJuicios: '',
  bancoPlataformaAddendum: 'No debe descuidar las entregas en plataforma.',
  rubrica1: 'No entregó el trabajo o no presentó evidencia (ausencia de producción). Mencionar como entrega pendiente cuando corresponda.',
  rubrica24: 'Producciones insuficientes (notas menores a 5). Reconocer las dificultades pero adoptar tono CONSTRUCTIVO y POSITIVO: subrayar el margen de mejora y los aspectos puntuales a fortalecer; evitar etiquetas desmoralizantes.',
  rubrica56: 'Trabajo satisfactorio: cumple con lo solicitado.',
  rubrica78: 'Muy buen trabajo: se destaca en varios aspectos.',
  rubrica910: 'Trabajo destacado: producción de alta calidad.',
};

const FIELDS = [
  'apiKey', 'model', 'maxChars', 'tone',
  'compararConAnterior',
  'rendUsarRango', 'rendMin', 'rendMax',
  'modoGeneracion', 'bancoJuicios', 'bancoPlataformaAddendum',
  'rubrica1', 'rubrica24', 'rubrica56', 'rubrica78', 'rubrica910',
];

// Por proveedor recordamos qué API key cargó el docente y qué modelo eligió,
// así puede alternar sin pegar la key cada vez.
const PER_PROVIDER_KEYS = 'siged_provider_keys'; // { providerId: { apiKey, model } }

// Mensajes de ayuda según el modo elegido.
const HINTS = {
  ia: 'Cada juicio se genera con la IA del proveedor seleccionado. Necesitás API key.',
  banco: 'Solo se usan los juicios que pegaste abajo. NO necesitás API key. Asegurate de cubrir todas las notas posibles.',
  mixto: 'Si la nota tiene juicios en el banco, se usa el banco; si no, se llama a la IA. Necesitás API key como respaldo.',
};

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

function refreshModoHint() {
  const modo = $('modoGeneracion').value;
  const el = $('modoHint');
  if (el) el.textContent = HINTS[modo] || '';
}

async function load() {
  const stored = await chrome.storage.local.get(null);
  const cfg = Object.assign({}, DEFAULTS, stored);

  // Migración desde versiones anteriores que usaban dos checkboxes:
  //   usarBanco=true,  bancoFallbackIA=true  → 'mixto'
  //   usarBanco=true,  bancoFallbackIA=false → 'banco'
  //   usarBanco=false                        → 'ia'
  if (cfg.modoGeneracion == null && (typeof cfg.usarBanco !== 'undefined' || typeof cfg.bancoFallbackIA !== 'undefined')) {
    if (cfg.usarBanco) cfg.modoGeneracion = cfg.bancoFallbackIA === false ? 'banco' : 'mixto';
    else cfg.modoGeneracion = 'ia';
  }
  if (!['ia', 'banco', 'mixto'].includes(cfg.modoGeneracion)) cfg.modoGeneracion = DEFAULTS.modoGeneracion;

  populateProviders(cfg.provider || DEFAULTS.provider);
  const perProvider = (await chrome.storage.local.get(PER_PROVIDER_KEYS))[PER_PROVIDER_KEYS] || {};
  const providerId = $('provider').value;
  const remembered = perProvider[providerId] || {};
  populateModels(providerId, remembered.model || cfg.model);
  refreshProviderHelp(providerId);

  for (const k of FIELDS) {
    if (k === 'apiKey' || k === 'model') continue;
    setFieldValue(k, cfg[k] ?? DEFAULTS[k]);
  }
  setFieldValue('apiKey', remembered.apiKey || cfg.apiKey || '');
  refreshModoHint();
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

  // Validación según modo:
  const modo = cfg.modoGeneracion || 'ia';
  const necesitaIA = modo === 'ia' || modo === 'mixto';
  const necesitaBanco = modo === 'banco' || modo === 'mixto';
  const faltaIA = necesitaIA && !cfg.apiKey;
  const faltaBanco = necesitaBanco && !(cfg.bancoJuicios || '').trim();
  if (faltaIA && faltaBanco) {
    showStatus('⚠ Configuración guardada, pero faltan API key y banco.', 'err');
  } else if (faltaIA) {
    showStatus(`⚠ Modo "${modo}": falta la API key del proveedor ${SIGED_PROVIDERS[providerId].label}.`, 'err');
  } else if (faltaBanco) {
    showStatus(`⚠ Modo "${modo}": el banco de juicios está vacío.`, 'err');
  } else {
    const desc = modo === 'ia' ? `IA (${SIGED_PROVIDERS[providerId].label})`
      : modo === 'banco' ? 'Banco solamente (sin IA)'
      : `Mixto (banco + ${SIGED_PROVIDERS[providerId].label} de respaldo)`;
    showStatus(`Configuración guardada ✓ · ${desc}`, 'ok');
  }
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

  $('provider').addEventListener('change', async () => {
    const providerId = $('provider').value;
    const stored = (await chrome.storage.local.get(PER_PROVIDER_KEYS))[PER_PROVIDER_KEYS] || {};
    const remembered = stored[providerId] || {};
    populateModels(providerId, remembered.model);
    refreshProviderHelp(providerId);
    setFieldValue('apiKey', remembered.apiKey || '');
  });

  $('modoGeneracion').addEventListener('change', refreshModoHint);
});
