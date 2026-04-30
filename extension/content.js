// Content script: corre en *.siged.com.uy. Inyecta un panel flotante,
// lee la grilla de períodos y completa Rend./Juicio en cada fila.
// La llamada a la API de Claude se delega al service worker (background.js).

(function () {
  'use strict';

  const DEFAULTS = {
    apiKey: '',
    model: 'claude-sonnet-4-5',
    maxChars: 280,
    tone: 'Profesional, claro, conciso, en español rioplatense. Siempre en TERCERA PERSONA refiriéndose al/la estudiante (nunca "vos", "tú" ni "usted"). Evitar adjetivos exagerados y opiniones sobre la familia.',
  };

  // ---------------------------------------------------------------------------
  // Configuración (chrome.storage.local)
  // ---------------------------------------------------------------------------
  let CFG = { ...DEFAULTS };

  async function loadConfig() {
    const stored = await chrome.storage.local.get(DEFAULTS);
    CFG = { ...DEFAULTS, ...stored };
    return CFG;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const k of Object.keys(changes)) {
      if (k in CFG) CFG[k] = changes[k].newValue;
    }
  });

  // ---------------------------------------------------------------------------
  // Utilidades de DOM / GeneXus
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  }

  function fireGxChange(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function readGxState() {
    const input = document.querySelector('input[name="GXState"]');
    if (!input) return null;
    try { return JSON.parse(input.value); } catch { return null; }
  }

  function walkObjects(node, visit, seen = new WeakSet()) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node)) visit(node);
    for (const k of Object.keys(node)) walkObjects(node[k], visit, seen);
  }

  function collectPeriodDataFromState(state) {
    const map = new Map();
    if (!state) return map;
    walkObjects(state, (obj) => {
      if (typeof obj.ReuCod === 'string'
        && ('Orales' in obj || 'Escritos' in obj || 'OActividades' in obj || 'CalifxReuJuicio' in obj || 'Mensaje' in obj)) {
        const code = obj.ReuCod.trim();
        if (!code) return;
        const score = (o) => (o.Orales || '').length + (o.Escritos || '').length + (o.OActividades || '').length + (o.Mensaje ? 1 : 0);
        if (!map.has(code) || score(obj) > score(map.get(code))) map.set(code, obj);
      }
    });
    return map;
  }

  function collectGridRows() {
    return $$('#GridjuiciosContainerTbl > tbody > tr[id^="GridjuiciosContainerRow_"]').map((tr) => {
      const idx = (tr.id.match(/_(\d+)$/) || [])[1];
      const codeSpan = document.getElementById(`span_vREUCOD_${idx}`);
      const dscSpan = document.getElementById(`span_CTLREUDSC1_${idx}`);
      return {
        idx,
        row: tr,
        code: (codeSpan && codeSpan.textContent.trim()) || '',
        dsc: (dscSpan && dscSpan.textContent.trim()) || '',
        califSelect: document.getElementById(`vCALIFXREUCALIFCOD_${idx}`),
        juicio: document.getElementById(`vCALIFXREUJUICIO_${idx}`),
      };
    });
  }

  function detectAlumno() {
    const candidates = $$('span, h1, h2, h3, td');
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (/^alumno:\s*/i.test(t) && t.length < 120) return t.replace(/^alumno:\s*/i, '').trim();
    }
    return '';
  }

  function detectLibreta() {
    const sel = document.querySelector('[id*="LIBRETA"][id*="Caption"], [id*="Libreta"][id*="Caption"]');
    if (sel && sel.textContent) return sel.textContent.trim();
    const dd = $$('span').find((s) => /Libreta\s*@/i.test(s.textContent || ''));
    return dd ? dd.textContent.trim() : '';
  }

  // ---------------------------------------------------------------------------
  // Notas / promedio
  // ---------------------------------------------------------------------------
  function parseNotas(raw) {
    if (!raw) return [];
    return String(raw).split(/[\s,;|]+/).map((s) => s.trim()).filter(Boolean);
  }

  function notasToNumeros(notas) {
    return notas
      .map((n) => {
        const m = String(n).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
      })
      .filter((n) => n !== null && !Number.isNaN(n));
  }

  function calcularPromedio(numeros) {
    if (!numeros.length) return null;
    return numeros.reduce((a, b) => a + b, 0) / numeros.length;
  }

  function elegirOpcionMasCercana(select, valor) {
    if (!select || valor == null) return null;
    const opciones = Array.from(select.options).filter((o) => o.value !== '');
    if (!opciones.length) return null;
    let mejor = null;
    let mejorDist = Infinity;
    for (const opt of opciones) {
      const txt = (opt.textContent || '').replace(',', '.');
      const m = txt.match(/-?\d+(?:\.\d+)?/);
      if (!m) continue;
      const num = parseFloat(m[0]);
      const d = Math.abs(num - valor);
      if (d < mejorDist) { mejorDist = d; mejor = opt; }
    }
    return mejor;
  }

  // ---------------------------------------------------------------------------
  // Construcción de prompt y llamada al background
  // ---------------------------------------------------------------------------
  function buildSystemPrompt(maxChars, tone) {
    return [
      'Sos un asistente que ayuda a docentes uruguayos a redactar juicios de evaluación para boletines escolares (SIGED).',
      'REGLA OBLIGATORIA: el juicio se redacta SIEMPRE en tercera persona, refiriéndose al/la estudiante (por ejemplo: "demuestra", "presenta dificultades", "logra"). Nunca uses segunda persona ("vos", "tú", "usted") ni primera persona.',
      'No uses emojis ni signos de exclamación múltiples. No emitas juicios sobre la familia. Respetá la privacidad.',
      'No inventes datos: usá únicamente la información provista. No menciones nombres de tareas concretas si no se pasan.',
      'Sé breve y concreto: una o dos oraciones bastan.',
      `Largo máximo: ${maxChars} caracteres. Devolvé SOLO el texto del juicio, sin comillas ni encabezados.`,
      `Tono solicitado: ${tone}`,
    ].join('\n');
  }

  function buildUserMessage({ alumno, libreta, periodoDsc, notasDetalle, promedio }) {
    return [
      `Alumno: ${alumno || 'N/D'}`,
      `Libreta/Asignatura: ${libreta || 'N/D'}`,
      `Período evaluado: ${periodoDsc || 'N/D'}`,
      `Promedio numérico calculado: ${promedio == null ? 'sin notas numéricas' : promedio.toFixed(2)}`,
      '',
      'Detalle de notas del período:',
      notasDetalle || '(sin notas registradas)',
      '',
      'Redactá el juicio de la asignatura para este período.',
    ].join('\n');
  }

  function callClaude(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'callClaude', payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res) return reject(new Error('Sin respuesta del background'));
        if (!res.ok) return reject(new Error(res.error || 'Error desconocido'));
        resolve(res.text);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Procesamiento de filas
  // ---------------------------------------------------------------------------
  function buildNotasDetalle(periodData) {
    if (!periodData) return '';
    const lines = [];
    const orales = parseNotas(periodData.Orales);
    const escritos = parseNotas(periodData.Escritos);
    const otras = parseNotas(periodData.OActividades);
    if (orales.length) lines.push(`Orales: ${orales.join(', ')}`);
    if (escritos.length) lines.push(`Escritos: ${escritos.join(', ')}`);
    if (otras.length) lines.push(`Otras actividades: ${otras.join(', ')}`);
    if (periodData.InasInjustificadas || periodData.InasJustificadas || periodData.InasFictas) {
      lines.push(`Inasistencias - injustif.: ${periodData.InasInjustificadas || 0}, justif.: ${periodData.InasJustificadas || 0}, fictas: ${periodData.InasFictas || 0}`);
    }
    if (periodData.CalifxReuJuicio) lines.push(`Juicio previo: ${periodData.CalifxReuJuicio}`);
    return lines.join('\n');
  }

  function todasLasNotasNumericas(periodData) {
    if (!periodData) return [];
    return [
      ...notasToNumeros(parseNotas(periodData.Orales)),
      ...notasToNumeros(parseNotas(periodData.Escritos)),
      ...notasToNumeros(parseNotas(periodData.OActividades)),
    ];
  }

  function periodoHabilitado(periodData) {
    if (!periodData) return false;
    if (typeof periodData.EntregaHabilitada === 'boolean') return periodData.EntregaHabilitada;
    const m = (periodData.Mensaje || '').toLowerCase();
    return m.includes('habilitado') && !m.includes('no habilitado');
  }

  async function procesarFila(row, periodMap, opts) {
    const periodData = periodMap.get((row.code || '').trim());
    if (!periodData) return { ok: false, msg: `Sin datos para ${row.code}` };
    if (!periodoHabilitado(periodData)) return { ok: false, msg: `Período no habilitado (${row.dsc})` };
    if (!row.juicio && !row.califSelect) return { ok: false, msg: `Fila sin campos editables (${row.dsc})` };

    const notasDetalle = buildNotasDetalle(periodData);
    const numeros = todasLasNotasNumericas(periodData);
    const promedio = calcularPromedio(numeros);

    let rendCompletado = null;
    if (periodData.AsigPideRendimiento && promedio != null && row.califSelect) {
      const opt = elegirOpcionMasCercana(row.califSelect, promedio);
      if (opt) {
        setNativeValue(row.califSelect, opt.value);
        fireGxChange(row.califSelect);
        rendCompletado = opt.textContent.trim();
      }
    }

    let juicioCompletado = null;
    if (periodData.AsigPideJuicio && row.juicio && !row.juicio.disabled) {
      const text = await callClaude({
        apiKey: CFG.apiKey,
        model: CFG.model,
        maxTokens: 1024,
        system: buildSystemPrompt(CFG.maxChars, CFG.tone),
        userMsg: buildUserMessage({
          alumno: opts.alumno,
          libreta: opts.libreta,
          periodoDsc: row.dsc,
          notasDetalle,
          promedio,
        }),
      });
      const recortado = text.length > CFG.maxChars ? text.slice(0, CFG.maxChars).replace(/\s+\S*$/, '') : text;
      setNativeValue(row.juicio, recortado);
      fireGxChange(row.juicio);
      juicioCompletado = recortado;
    }

    const partes = [];
    if (rendCompletado) partes.push(`Rend=${rendCompletado}`);
    if (juicioCompletado) partes.push('✓ juicio');
    return { ok: true, msg: `${row.dsc}: ${partes.join(' ') || 'sin cambios'}` };
  }

  // ---------------------------------------------------------------------------
  // Panel flotante
  // ---------------------------------------------------------------------------
  function buildPanel() {
    if (document.getElementById('siged-juicios-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'siged-juicios-panel';
    panel.innerHTML = `
      <style>
        #siged-juicios-panel{position:fixed;bottom:16px;right:16px;z-index:99999;background:#1f2937;color:#f9fafb;
          font:13px/1.4 system-ui,sans-serif;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);width:340px;overflow:hidden}
        #siged-juicios-panel header{background:#111827;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;cursor:move}
        #siged-juicios-panel header h3{margin:0;font-size:14px;font-weight:600}
        #siged-juicios-panel header button{background:transparent;border:0;color:#9ca3af;font-size:16px;cursor:pointer}
        #siged-juicios-panel .body{padding:12px;display:flex;flex-direction:column;gap:8px}
        #siged-juicios-panel .status{font-size:11px;color:#9ca3af}
        #siged-juicios-panel button.primary{background:#2563eb;color:#fff;border:0;padding:8px 12px;border-radius:6px;cursor:pointer;font-weight:600}
        #siged-juicios-panel button.primary:disabled{background:#4b5563;cursor:not-allowed}
        #siged-juicios-panel .log{max-height:160px;overflow:auto;background:#111827;border-radius:6px;padding:8px;font-size:11px;color:#d1d5db;white-space:pre-wrap}
        #siged-juicios-panel.collapsed .body{display:none}
      </style>
      <header>
        <h3>SIGED · Juicios IA</h3>
        <button data-act="toggle" title="Minimizar">_</button>
      </header>
      <div class="body">
        <div class="status" data-fld="cfg-status">Cargando configuración…</div>
        <button class="primary" data-act="run">Generar juicios del período</button>
        <div class="log" data-fld="log">Listo.</div>
      </div>
    `;
    document.body.appendChild(panel);

    const log = (msg) => {
      const el = panel.querySelector('[data-fld="log"]');
      el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + el.textContent;
    };

    const refreshStatus = () => {
      const s = panel.querySelector('[data-fld="cfg-status"]');
      if (CFG.apiKey) {
        s.textContent = `Modelo: ${CFG.model} · Máx ${CFG.maxChars} chars · 3ra persona`;
      } else {
        s.innerHTML = 'Falta API key. Abrí el ícono de la extensión para configurarla.';
      }
    };

    panel.addEventListener('click', async (e) => {
      const act = e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'toggle') { panel.classList.toggle('collapsed'); return; }
      if (act === 'run') {
        await loadConfig();
        refreshStatus();
        if (!CFG.apiKey) { log('Falta API key. Configurala desde el ícono de la extensión.'); return; }
        const btn = e.target;
        btn.disabled = true;
        try {
          const state = readGxState();
          if (!state) { log('No se encontró GXState. ¿Estás en la pantalla de cierre por alumno?'); return; }
          const periodMap = collectPeriodDataFromState(state);
          if (!periodMap.size) { log('No se encontraron datos de períodos en GXState.'); return; }
          const rows = collectGridRows();
          if (!rows.length) { log('No se encontró la grilla de períodos.'); return; }
          const alumno = detectAlumno();
          const libreta = detectLibreta();
          log(`Alumno: ${alumno || '?'} · Libreta: ${libreta || '?'} · Filas: ${rows.length}`);
          for (const row of rows) {
            try {
              const r = await procesarFila(row, periodMap, { alumno, libreta });
              log((r.ok ? '✓ ' : '· ') + r.msg);
            } catch (err) {
              log(`✗ ${row.dsc || row.code}: ${err.message}`);
            }
          }
          log('Listo. Revisá la grilla y, si está OK, presioná "Guardar y continuar" en SIGED.');
        } finally {
          btn.disabled = false;
        }
      }
    });

    // Drag & drop simple en el header.
    const header = panel.querySelector('header');
    let drag = null;
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.left = `${e.clientX - drag.dx}px`;
      panel.style.top = `${e.clientY - drag.dy}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { drag = null; });

    loadConfig().then(refreshStatus);
    chrome.storage.onChanged.addListener(refreshStatus);
  }

  function bootstrap() {
    buildPanel();
    const obs = new MutationObserver(() => {
      if (!document.getElementById('siged-juicios-panel')) buildPanel();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
