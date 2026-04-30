const DEFAULTS = {
  apiKey: '',
  model: 'claude-sonnet-4-5',
  maxChars: 280,
  tone: 'Profesional, claro, conciso, en español rioplatense. Siempre en TERCERA PERSONA refiriéndose al/la estudiante (nunca "vos", "tú" ni "usted"). Evitar adjetivos exagerados y opiniones sobre la familia.',
};

const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  $('apiKey').value = cfg.apiKey || '';
  $('model').value = cfg.model || DEFAULTS.model;
  $('maxChars').value = cfg.maxChars || DEFAULTS.maxChars;
  $('tone').value = cfg.tone || DEFAULTS.tone;
}

function showStatus(msg, cls) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'hint ' + (cls || '');
}

async function save() {
  const cfg = {
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    maxChars: Math.max(80, Math.min(2000, parseInt($('maxChars').value, 10) || DEFAULTS.maxChars)),
    tone: $('tone').value.trim() || DEFAULTS.tone,
  };
  await chrome.storage.local.set(cfg);
  showStatus(cfg.apiKey ? 'Configuración guardada ✓' : 'Configuración guardada (falta API key).', cfg.apiKey ? 'ok' : 'err');
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('save').addEventListener('click', save);
});
