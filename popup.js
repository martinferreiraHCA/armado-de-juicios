const DEFAULTS = {
  apiKey: '',
  model: 'claude-sonnet-4-5',
  maxChars: 280,
  tone: 'Profesional, claro, conciso, en español rioplatense. Siempre en TERCERA PERSONA refiriéndose al/la estudiante (nunca "vos", "tú" ni "usted"). Evitar adjetivos exagerados y opiniones sobre la familia.',
  compararConAnterior: true,
  rubrica1: 'No entregó el trabajo o no presentó evidencia (ausencia de producción). Mencionar como entrega pendiente cuando corresponda.',
  rubrica24: 'Producciones insuficientes (notas menores a 5). Reconocer las dificultades pero adoptar tono CONSTRUCTIVO y POSITIVO: subrayar el margen de mejora y los aspectos puntuales a fortalecer; evitar etiquetas desmoralizantes.',
  rubrica56: 'Trabajo satisfactorio: cumple con lo solicitado.',
  rubrica78: 'Muy buen trabajo: se destaca en varios aspectos.',
  rubrica910: 'Trabajo destacado: producción de alta calidad.',
};

const FIELDS = [
  'apiKey', 'model', 'maxChars', 'tone',
  'compararConAnterior',
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
  if (el.type === 'number') return parseInt(el.value, 10) || 0;
  return el.value.trim();
}

async function load() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  for (const k of FIELDS) {
    setFieldValue(k, cfg[k] ?? DEFAULTS[k]);
  }
}

function showStatus(msg, cls) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'hint ' + (cls || '');
}

async function save() {
  const cfg = {};
  for (const k of FIELDS) cfg[k] = getFieldValue(k);
  cfg.maxChars = Math.max(80, Math.min(2000, cfg.maxChars || DEFAULTS.maxChars));
  if (!cfg.tone) cfg.tone = DEFAULTS.tone;
  // Si una rúbrica queda vacía, mantenemos el default para no romper el prompt.
  for (const k of ['rubrica1', 'rubrica24', 'rubrica56', 'rubrica78', 'rubrica910']) {
    if (!cfg[k]) cfg[k] = DEFAULTS[k];
  }
  await chrome.storage.local.set(cfg);
  showStatus(cfg.apiKey ? 'Configuración guardada ✓' : 'Configuración guardada (falta API key).', cfg.apiKey ? 'ok' : 'err');
}

async function reset() {
  await chrome.storage.local.set(DEFAULTS);
  await load();
  showStatus('Valores restaurados a los defaults.', 'ok');
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', reset);
});
