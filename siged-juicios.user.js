// ==UserScript==
// @name         SIGED - Armado de juicios con IA (Claude)
// @namespace    https://github.com/martinferreirahca/armado-de-juicios
// @version      0.1.0
// @description  Genera juicios y promedios automáticos en la pantalla "Cierre de promedios por alumno" de SIGED usando la API de Claude.
// @author       martinferreirahca
// @match        https://*.siged.com.uy/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.anthropic.com
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuración persistente
  // ---------------------------------------------------------------------------
  const CFG_KEYS = {
    apiKey: 'siged_juicios_api_key',
    model: 'siged_juicios_model',
    maxChars: 'siged_juicios_max_chars',
    tone: 'siged_juicios_tone',
  };

  const DEFAULT_MODEL = 'claude-sonnet-4-5';
  const DEFAULT_MAX_CHARS = 500;
  const DEFAULT_TONE = 'Profesional, claro, en español rioplatense, dirigido a la familia del estudiante.';

  const cfg = {
    get apiKey() { return GM_getValue(CFG_KEYS.apiKey, ''); },
    set apiKey(v) { GM_setValue(CFG_KEYS.apiKey, v || ''); },
    get model() { return GM_getValue(CFG_KEYS.model, DEFAULT_MODEL); },
    set model(v) { GM_setValue(CFG_KEYS.model, v || DEFAULT_MODEL); },
    get maxChars() { return parseInt(GM_getValue(CFG_KEYS.maxChars, DEFAULT_MAX_CHARS), 10) || DEFAULT_MAX_CHARS; },
    set maxChars(v) { GM_setValue(CFG_KEYS.maxChars, String(v || DEFAULT_MAX_CHARS)); },
    get tone() { return GM_getValue(CFG_KEYS.tone, DEFAULT_TONE); },
    set tone(v) { GM_setValue(CFG_KEYS.tone, v || DEFAULT_TONE); },
  };

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
    if (typeof window.gx !== 'undefined' && window.gx.evt && typeof window.gx.evt.onchange === 'function') {
      try { window.gx.evt.onchange(el, new Event('change')); } catch (_) { /* ignore */ }
    }
  }

  function setFieldValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    setNativeValue(el, value);
    fireGxChange(el);
    return true;
  }

  function readGxState() {
    const input = document.querySelector('input[name="GXState"]');
    if (!input) return null;
    try { return JSON.parse(input.value); } catch (_) { return null; }
  }

  // Walks an object/array tree, calls visitor on every plain object.
  function walkObjects(node, visit, seen = new WeakSet()) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node)) visit(node);
    for (const k of Object.keys(node)) walkObjects(node[k], visit, seen);
  }

  // Devuelve un mapa ReuCod (trim) -> objeto de datos del período (con Orales/Escritos/OActividades/Mensaje/etc.)
  function collectPeriodDataFromState(state) {
    const map = new Map();
    if (!state) return map;
    walkObjects(state, (obj) => {
      if (typeof obj.ReuCod === 'string'
        && ('Orales' in obj || 'Escritos' in obj || 'OActividades' in obj || 'CalifxReuJuicio' in obj || 'Mensaje' in obj)) {
        const code = obj.ReuCod.trim();
        if (!code) return;
        // Si ya hay una entrada, conservamos la que tenga más información (más notas / Mensaje no vacío).
        const score = (o) => (o.Orales || '').length + (o.Escritos || '').length + (o.OActividades || '').length + (o.Mensaje ? 1 : 0);
        if (!map.has(code) || score(obj) > score(map.get(code))) map.set(code, obj);
      }
    });
    return map;
  }

  // Devuelve [{code, dsc, juicioText, califSelect, rowIndex}] de cada fila visible de la grilla.
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
        califSelectId: `vCALIFXREUCALIFCOD_${idx}`,
        juicioId: `vCALIFXREUJUICIO_${idx}`,
        juicio: document.getElementById(`vCALIFXREUJUICIO_${idx}`),
        califSelect: document.getElementById(`vCALIFXREUCALIFCOD_${idx}`),
      };
    });
  }

  function detectAlumno() {
    // En la página el título cambia a algo como "alumno: AMBROSIO CALVIÑO María José".
    const candidates = $$('span, h1, h2, h3, td');
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (/^alumno:\s*/i.test(t) && t.length < 120) return t.replace(/^alumno:\s*/i, '').trim();
    }
    return '';
  }

  function detectLibreta() {
    // Busca el botón/título con la libreta seleccionada (se ve normalmente arriba del listado).
    const sel = document.querySelector('[id*="LIBRETA"][id*="Caption"], [id*="Libreta"][id*="Caption"]');
    if (sel && sel.textContent) return sel.textContent.trim();
    // Fallback: buscar en el dropdown principal.
    const dd = $$('span').find(s => /Libreta\s*@/i.test(s.textContent || ''));
    return dd ? dd.textContent.trim() : '';
  }

  // ---------------------------------------------------------------------------
  // Notas / promedio
  // ---------------------------------------------------------------------------
  // Una "nota" en SIGED puede venir como número (ej. "7"), letra (ej. "MB"), o vacía.
  // Para el promedio numérico solo usamos las notas numéricas.
  function parseNotas(raw) {
    if (!raw) return [];
    return String(raw)
      .split(/[\s,;|]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function notasToNumeros(notas) {
    return notas
      .map(n => {
        const m = String(n).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
      })
      .filter(n => n !== null && !Number.isNaN(n));
  }

  function calcularPromedio(numeros) {
    if (!numeros.length) return null;
    const sum = numeros.reduce((a, b) => a + b, 0);
    return sum / numeros.length;
  }

  function elegirOpcionMasCercana(select, valor) {
    if (!select || valor == null) return null;
    const opciones = Array.from(select.options).filter(o => o.value !== '');
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
  // Llamada a la API de Claude
  // ---------------------------------------------------------------------------
  function callClaude({ alumno, libreta, periodoDsc, notasDetalle, promedio, tono, maxChars, model, apiKey }) {
    return new Promise((resolve, reject) => {
      const system = [
        'Sos un asistente que ayuda a docentes uruguayos a redactar juicios de evaluación para boletines escolares (SIGED).',
        'Escribís en español rioplatense, en tercera persona, sin emojis, evitando juicios sobre la familia y respetando la privacidad.',
        'No inventes datos: usá únicamente la información provista. No menciones nombres de tareas concretas si no se pasan.',
        `Largo máximo: ${maxChars} caracteres. Devolvé solamente el texto del juicio, sin comillas ni encabezados.`,
        `Tono solicitado: ${tono}`,
      ].join('\n');

      const userMsg = [
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

      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        data: JSON.stringify({
          model,
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: userMsg }],
        }),
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) {
              return reject(new Error(`HTTP ${res.status}: ${res.responseText.slice(0, 300)}`));
            }
            const data = JSON.parse(res.responseText);
            const text = (data.content || []).map(b => b.text || '').join('').trim();
            if (!text) return reject(new Error('Respuesta vacía de Claude'));
            resolve(text);
          } catch (e) { reject(e); }
        },
        onerror: (err) => reject(new Error(`Error de red: ${err && err.error || err}`)),
        ontimeout: () => reject(new Error('Timeout llamando a la API de Claude')),
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

    // Rendimiento: completar el select con la opción más cercana al promedio numérico.
    let rendCompletado = null;
    if (periodData.AsigPideRendimiento && promedio != null && row.califSelect) {
      const opt = elegirOpcionMasCercana(row.califSelect, promedio);
      if (opt) {
        setNativeValue(row.califSelect, opt.value);
        fireGxChange(row.califSelect);
        rendCompletado = opt.textContent.trim();
      }
    }

    // Juicio: pedirlo a Claude solo si la asignatura lo solicita y hay textarea editable.
    let juicioCompletado = null;
    if (periodData.AsigPideJuicio && row.juicio && !row.juicio.disabled) {
      const text = await callClaude({
        alumno: opts.alumno,
        libreta: opts.libreta,
        periodoDsc: row.dsc,
        notasDetalle,
        promedio,
        tono: cfg.tone,
        maxChars: cfg.maxChars,
        model: cfg.model,
        apiKey: cfg.apiKey,
      });
      const recortado = text.length > cfg.maxChars ? text.slice(0, cfg.maxChars).replace(/\s+\S*$/, '') : text;
      setNativeValue(row.juicio, recortado);
      fireGxChange(row.juicio);
      juicioCompletado = recortado;
    }

    return {
      ok: true,
      msg: `${row.dsc}: ${rendCompletado ? `Rend=${rendCompletado} ` : ''}${juicioCompletado ? '✓ juicio' : ''}`.trim() || `${row.dsc}: sin cambios`,
    };
  }

  // ---------------------------------------------------------------------------
  // UI flotante
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
        #siged-juicios-panel label{font-size:11px;color:#9ca3af;display:flex;flex-direction:column;gap:3px}
        #siged-juicios-panel input,#siged-juicios-panel textarea,#siged-juicios-panel select{
          background:#374151;color:#f9fafb;border:1px solid #4b5563;border-radius:6px;padding:6px 8px;font:inherit;width:100%;box-sizing:border-box}
        #siged-juicios-panel button.primary{background:#2563eb;color:#fff;border:0;padding:8px 12px;border-radius:6px;cursor:pointer;font-weight:600}
        #siged-juicios-panel button.primary:disabled{background:#4b5563;cursor:not-allowed}
        #siged-juicios-panel button.secondary{background:transparent;color:#93c5fd;border:1px solid #4b5563;padding:6px 10px;border-radius:6px;cursor:pointer}
        #siged-juicios-panel .row{display:flex;gap:6px}
        #siged-juicios-panel .log{max-height:140px;overflow:auto;background:#111827;border-radius:6px;padding:8px;font-size:11px;color:#d1d5db;white-space:pre-wrap}
        #siged-juicios-panel.collapsed .body{display:none}
      </style>
      <header>
        <h3>SIGED · Juicios IA</h3>
        <div>
          <button data-act="toggle" title="Minimizar">_</button>
        </div>
      </header>
      <div class="body">
        <label>API key de Claude
          <input type="password" data-fld="apiKey" placeholder="sk-ant-...">
        </label>
        <div class="row">
          <label style="flex:2">Modelo
            <select data-fld="model">
              <option value="claude-sonnet-4-5">Sonnet 4.5</option>
              <option value="claude-opus-4-7">Opus 4.7</option>
              <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
            </select>
          </label>
          <label style="flex:1">Máx. chars
            <input type="number" min="100" max="2000" data-fld="maxChars">
          </label>
        </div>
        <label>Tono / instrucciones
          <textarea rows="2" data-fld="tone"></textarea>
        </label>
        <div class="row">
          <button class="primary" data-act="run">Generar juicios del período</button>
          <button class="secondary" data-act="save">Guardar config</button>
        </div>
        <div class="log" data-fld="log">Listo. Cargá tu API key y abrí la pantalla "Cierre de promedios por alumno".</div>
      </div>
    `;
    document.body.appendChild(panel);

    const get = (sel) => panel.querySelector(sel);
    const log = (msg) => {
      const el = get('[data-fld="log"]');
      el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + el.textContent;
    };

    // Cargar config actual.
    get('[data-fld="apiKey"]').value = cfg.apiKey;
    get('[data-fld="model"]').value = cfg.model;
    get('[data-fld="maxChars"]').value = cfg.maxChars;
    get('[data-fld="tone"]').value = cfg.tone;

    panel.addEventListener('click', async (e) => {
      const act = e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'toggle') {
        panel.classList.toggle('collapsed');
        return;
      }
      if (act === 'save') {
        cfg.apiKey = get('[data-fld="apiKey"]').value.trim();
        cfg.model = get('[data-fld="model"]').value;
        cfg.maxChars = parseInt(get('[data-fld="maxChars"]').value, 10) || DEFAULT_MAX_CHARS;
        cfg.tone = get('[data-fld="tone"]').value.trim() || DEFAULT_TONE;
        log('Configuración guardada.');
        return;
      }
      if (act === 'run') {
        if (!cfg.apiKey) { log('Falta cargar la API key.'); return; }
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
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  function bootstrap() {
    buildPanel();
    // Re-construir si SIGED reemplaza el contenido (es una SPA GeneXus).
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
