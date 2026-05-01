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
    compararConAnterior: true,
    rubrica1: 'No entregó el trabajo o no presentó evidencia (ausencia de producción). Mencionar como entrega pendiente cuando corresponda.',
    rubrica24: 'Producciones insuficientes (notas menores a 5). Reconocer las dificultades pero adoptar tono CONSTRUCTIVO y POSITIVO: subrayar el margen de mejora y los aspectos puntuales a fortalecer; evitar etiquetas desmoralizantes.',
    rubrica56: 'Trabajo satisfactorio: cumple con lo solicitado.',
    rubrica78: 'Muy buen trabajo: se destaca en varios aspectos.',
    rubrica910: 'Trabajo destacado: producción de alta calidad.',
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

  // Devuelve el value crudo del input GXState. Cambia en cada postback de SIGED,
  // así que sirve como señal "la página avanzó" después de Guardar y siguiente.
  function readGxStateRaw() {
    const input = document.querySelector('input[name="GXState"]');
    return input ? input.value : null;
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

  // Saca el alumno del GXState (las captions de SIGED contienen literalmente
  // "alumno: NOMBRE APELLIDO ..."). Cae al DOM si no aparece en el state
  // (por ejemplo después del primer postback, donde GXState queda vacío).
  function detectAlumno(state) {
    state = state || readGxState();
    if (state) {
      let best = '';
      walkObjects(state, (obj) => {
        for (const v of Object.values(obj)) {
          if (typeof v !== 'string') continue;
          const m = v.match(/alumno:\s*([^<\n\r"]{2,120})/i);
          if (m) {
            const candidate = m[1].trim();
            if (candidate && candidate.length > best.length && candidate.length < 120) best = candidate;
          }
        }
      });
      if (best) return best;
    }
    // Fallback DOM: el nombre del alumno suele aparecer como caption en
    // distintos contenedores. Probamos varios. Solo consideramos elementos
    // VISIBLES — los popups (TABLETITULOCONTENIDO2/3) tienen "Atención!" o
    // "EVALUACIÓN DIAGNÓSTICA…" dentro pero están display:none, y agarrarlos
    // como "alumno" rompe todo.
    const candIds = [
      'span_TXTTITULO', 'TXTTITULO',
      'span_TXTSUBTITULO', 'TXTSUBTITULO',
      'TBL_ALUMNO', 'TBLLIBDATOS',
      'TABLETITULOCONTENIDO',
    ];
    for (const id of candIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (!isVisible(el)) continue;
      const t = (el.textContent || '').trim();
      const m = t.match(/alumno:\s*([^\n\r]{2,120})/i);
      if (m) return m[1].trim();
      // Algunos titulares solo muestran el nombre sin "alumno:".
      if (t && t.length > 4 && t.length < 120
          && /[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(t)
          && !/^cierre|^libreta|^seleccione|^atenci|^evaluaci|^promedio/i.test(t)) {
        return t;
      }
    }
    // Último recurso: cualquier span/td visible cuyo texto empiece con "alumno:".
    const all = document.querySelectorAll('span, h1, h2, h3, td, div');
    for (const el of all) {
      if (!isVisible(el)) continue;
      const t = (el.textContent || '').trim();
      if (t.length > 200) continue;
      const m = t.match(/^alumno:\s*(.+)$/i);
      if (m && m[1].length < 120) return m[1].trim();
    }
    return '';
  }

  // Igual para libreta. Se filtra explícitamente el item del menú lateral
  // ("Libreta @") que confundía al detector anterior.
  function detectLibreta(state) {
    state = state || readGxState();
    if (state) {
      let best = '';
      walkObjects(state, (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v !== 'string' || !v.trim()) continue;
          // Captions con "Libreta NN ..." o keys con LibretaDsc/LibDDsc.
          if (/^libreta\s+\S/i.test(v) && v.length < 200 && !/libreta\s*@/i.test(v)) {
            if (v.length > best.length) best = v.trim();
          }
          if (/(LibretaDsc|LibDDsc|LibretaNom|LibretaNombre)/i.test(k) && v.length < 200) {
            if (v.length > best.length) best = v.trim();
          }
        }
      });
      if (best) return best;
    }
    // DOM, evitando el menú lateral.
    const candidates = document.querySelectorAll('#TBL_ALUMNO span, #TBLLIBDATOS span, #TABLETITULOCONTENIDO span, [id*="LIBRETA"][id*="Caption"]');
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (t && t.length < 200 && !/^libreta\s*@?\s*$/i.test(t)) return t;
    }
    return '';
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
  // Clasifica las notas numéricas del período según la rúbrica solicitada:
  //   1                 -> ausencia / no entrega
  //   2..4 (< 5)        -> debe mejorar la calidad de las producciones
  //   >= 5              -> trabajo a destacar (más alto = más fuerte)
  function clasificarNotas(numeros) {
    const ausencias = numeros.filter((n) => Math.round(n) === 1).length;
    const aMejorar = numeros.filter((n) => n >= 2 && n < 5).length;
    const buenas = numeros.filter((n) => n >= 5 && n < 9).length;
    const destacadas = numeros.filter((n) => n >= 9).length;
    return { ausencias, aMejorar, buenas, destacadas, total: numeros.length };
  }

  function rubricaResumen(c, promedio) {
    if (!c.total) return 'No hay notas numéricas en el período.';
    const partes = [];
    if (c.ausencias) partes.push(`${c.ausencias} ausencia(s) / no entrega(s) — nota 1`);
    if (c.aMejorar) partes.push(`${c.aMejorar} nota(s) entre 2 y 4 — insuficientes con margen de mejora (tono positivo)`);
    if (c.buenas) partes.push(`${c.buenas} nota(s) entre 5 y 8 — satisfactorio o muy bueno`);
    if (c.destacadas) partes.push(`${c.destacadas} nota(s) de 9 o 10 — destacadas`);
    partes.push(`Promedio: ${promedio == null ? 'N/D' : promedio.toFixed(2)}`);
    return partes.join('; ') + '.';
  }

  function buildSystemPrompt(cfg) {
    const lines = [
      'Sos un asistente que ayuda a docentes uruguayos a redactar juicios de evaluación para boletines escolares (SIGED).',
      'REGLA OBLIGATORIA: el juicio se redacta SIEMPRE en tercera persona, refiriéndose al/la estudiante (por ejemplo: "demuestra", "presenta dificultades", "logra"). Nunca uses segunda persona ("vos", "tú", "usted") ni primera persona.',
      'NUNCA menciones el NOMBRE del/la estudiante dentro del juicio. El nombre se te pasa solo como contexto interno; el texto generado debe ser válido sin él (usá "el/la estudiante" o reformulá la oración).',
      'No uses emojis ni signos de exclamación múltiples. No emitas juicios sobre la familia. Respetá la privacidad.',
      'No inventes datos: usá únicamente la información provista. No menciones nombres de tareas concretas si no se pasan.',
      'Sé breve y concreto: una o dos oraciones bastan.',
      'RÚBRICA OBLIGATORIA al interpretar las notas (definida por el/la docente):',
      `  • Nota 1 (ausencia / no entrega): ${cfg.rubrica1}`,
      `  • Notas 2 a 4 (insuficientes, < 5 estricto): ${cfg.rubrica24}`,
      `  • Notas 5 a 6: ${cfg.rubrica56}`,
      `  • Notas 7 a 8: ${cfg.rubrica78}`,
      `  • Notas 9 a 10: ${cfg.rubrica910}`,
      'Distinción importante: NO confundas "1" (ausencia) con "2-4" (insuficiencia con margen de mejora). El 1 indica que no hubo evidencia/producción; el 2-4 indica que sí hubo producción pero por debajo de lo esperado.',
      'Cuando haya notas 2-4 redactá en tono CONSTRUCTIVO y POSITIVO: reconocer la dificultad, pero centrarse en el margen de mejora y aspectos a fortalecer. Evitá etiquetas desmoralizantes ("mal", "muy bajo", "preocupante").',
      'Si conviven notas en distintos rangos, equilibrá lo positivo con lo a mejorar (por ejemplo: "logra X, aunque debe profundizar en Y").',
    ];
    if (cfg.compararConAnterior) {
      lines.push('Cuando se incluya el "Historial de períodos anteriores", usalo para describir el PROCESO del/la estudiante: progreso, mantenimiento o retroceso respecto al período inmediato anterior. Evitá repetir literalmente juicios anteriores.');
    }
    lines.push(`Largo máximo: ${cfg.maxChars} caracteres. Devolvé SOLO el texto del juicio, sin comillas ni encabezados.`);
    lines.push(`Tono solicitado: ${cfg.tone}`);
    return lines.join('\n');
  }

  function buildUserMessage({ alumno, libreta, periodoDsc, notasDetalle, promedio, clasif, historial, incluirHistorial }) {
    const parts = [
      `Alumno: ${alumno || 'N/D'}`,
      `Libreta/Asignatura: ${libreta || 'N/D'}`,
      `Período evaluado: ${periodoDsc || 'N/D'}`,
      `Promedio numérico calculado: ${promedio == null ? 'sin notas numéricas' : promedio.toFixed(2)}`,
      `Resumen según rúbrica: ${rubricaResumen(clasif, promedio)}`,
      '',
      'Detalle de notas del período:',
      notasDetalle || '(sin notas registradas)',
    ];
    if (incluirHistorial && historial && historial.length) {
      parts.push('');
      parts.push('Historial de períodos anteriores (más antiguo primero):');
      for (const h of historial) {
        const piezas = [];
        if (h.rend) piezas.push(`Rend.: ${h.rend}`);
        if (h.juicio) piezas.push(`Juicio: ${h.juicio.replace(/\s+/g, ' ').slice(0, 240)}`);
        parts.push(`- ${h.dsc}: ${piezas.join(' | ') || '(sin datos cerrados)'}`);
      }
    }
    parts.push('');
    parts.push('Redactá el juicio de la asignatura para este período aplicando la rúbrica' + (incluirHistorial ? ' y, si hay datos previos, contrastá con el período anterior.' : '.'));
    return parts.join('\n');
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
    // Si viene del DOM con descripción de cada tarea, lo agregamos como
    // contexto extra para Claude (sin que vuelva a sumar duplicado).
    if (periodData.OActividadesDetalle) lines.push(`Detalle de tareas: ${periodData.OActividadesDetalle}`);
    if (periodData.NotasInsuficientes > 0) {
      lines.push(`Notas insuficientes (marcadas en SIGED): ${periodData.NotasInsuficientes}`);
    }
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

    // Marcar inputs editables (debug visual)
    if (row.califSelect && periodData.AsigPideRendimiento) {
      debugViz.mark(row.califSelect, debugViz.colors.califInput, `Rend select (${row.dsc})`);
    }
    if (row.juicio && periodData.AsigPideJuicio) {
      debugViz.mark(row.juicio, debugViz.colors.juicioInput, `Juicio textarea (${row.dsc})`);
    }

    let rendCompletado = null;
    if (periodData.AsigPideRendimiento && promedio != null && row.califSelect) {
      const opt = elegirOpcionMasCercana(row.califSelect, promedio);
      if (opt) {
        setNativeValue(row.califSelect, opt.value);
        fireGxChange(row.califSelect);
        rendCompletado = opt.textContent.trim();
        debugViz.mark(row.califSelect, debugViz.colors.filled, `✓ Rend=${rendCompletado} (avg ${promedio.toFixed(2)})`);
      }
    }

    let juicioCompletado = null;
    if (periodData.AsigPideJuicio && row.juicio && !row.juicio.disabled) {
      const clasif = clasificarNotas(numeros);
      const text = await callClaude({
        apiKey: CFG.apiKey,
        model: CFG.model,
        maxTokens: 1024,
        system: buildSystemPrompt(CFG),
        userMsg: buildUserMessage({
          alumno: opts.alumno,
          libreta: opts.libreta,
          periodoDsc: row.dsc,
          notasDetalle,
          promedio,
          clasif,
          historial: opts.historial,
          incluirHistorial: !!CFG.compararConAnterior,
        }),
      });
      const recortado = text.length > CFG.maxChars ? text.slice(0, CFG.maxChars).replace(/\s+\S*$/, '') : text;
      setNativeValue(row.juicio, recortado);
      fireGxChange(row.juicio);
      juicioCompletado = recortado;
      debugViz.mark(row.juicio, debugViz.colors.filled, `✓ Juicio (${recortado.length}c)`);
    }

    const partes = [];
    if (rendCompletado) partes.push(`Rend=${rendCompletado}`);
    if (juicioCompletado) partes.push('✓ juicio');
    return { ok: true, msg: `${row.dsc}: ${partes.join(' ') || 'sin cambios'}` };
  }

  // Construye el historial: para cada fila previa a la actual, sus datos
  // cerrados (Rend. y/o juicio guardados). Incluye solo períodos con datos.
  function historialAntesDe(rows, periodMap, currentIdx) {
    const out = [];
    for (let i = 0; i < currentIdx; i++) {
      const r = rows[i];
      const data = periodMap.get((r.code || '').trim());
      if (!data) continue;
      const rend = (data.CalifxReuCalifCod || '').trim();
      const juicio = (data.CalifxReuJuicio || '').trim();
      if (!rend && !juicio) continue;
      out.push({ dsc: r.dsc || r.code, rend, juicio });
    }
    return out;
  }

  // Procesa la grilla completa del alumno actual. Devuelve resumen.
  async function procesarAlumnoActual(log, abortSignal) {
    // Borramos marcas anteriores para no confundir alumnos.
    debugViz.clear();
    // Pequeña espera defensiva: en navegaciones GX a veces termina el
    // postback pero los grades aparecen 1-2s después por lazy-load.
    if (gxBusyAnywhere()) {
      log('   …GX todavía ocupado, espero a que termine de pintar…');
      await waitForGxIdle('BTNGUARDARYSIGUIENTE', 15000, abortSignal);
    }

    // FUENTE PRIMARIA: el DOM (FreeStyleGrid + GridjuiciosContainerTbl).
    // Es lo que el/la docente ve en pantalla y lo que el modo debug visual
    // puede pintar. GXState solo se usa como red de seguridad si el DOM
    // está completamente vacío.
    let periodMap = extractPeriodsFromDom();
    let fuente = 'DOM (FreeStyleGrid)';
    // Reintento corto si SIGED todavía está renderizando las notas.
    const algunaConNotas = (m) => Array.from(m.values()).some((p) => (p.OActividades || p.Orales || p.Escritos || '').trim().length);
    if (periodMap.size && !algunaConNotas(periodMap)) {
      log('   …no detecté notas en el primer scrapeo, espero 2s y reintento (lazy-load)…');
      await sleep(2000);
      periodMap = extractPeriodsFromDom();
    }
    // Red de seguridad: si el DOM está vacío, recurrimos a GXState.
    if (!periodMap.size) {
      log('   DOM sin períodos. Probando con GXState…');
      const state = readGxState();
      if (state) {
        periodMap = collectPeriodDataFromState(state);
        if (periodMap.size) fuente = 'GXState (fallback)';
      }
    }
    if (!periodMap.size) { log('No se encontraron datos de períodos ni en el DOM ni en GXState.'); return { ok: false }; }

    const rows = collectGridRows();
    if (!rows.length) { log('No se encontró la grilla de períodos.'); return { ok: false }; }
    const stateForName = readGxState();
    const alumno = detectAlumno(stateForName);
    const libreta = detectLibreta(stateForName);
    log(`Alumno: ${alumno || '?'} · Libreta: ${libreta || '?'} · Filas: ${rows.length} · fuente: ${fuente}`);

    // Log por período: vemos exactamente cuántas notas se extrajeron y
    // si algún período habilitado quedó sin notas (mismatch).
    log('   📊 Notas detectadas por período (desde el DOM visible):');
    for (const p of periodMap.values()) {
      const o = (p.Orales || '').trim().split(/\s+/).filter(Boolean).length;
      const e = (p.Escritos || '').trim().split(/\s+/).filter(Boolean).length;
      const a = (p.OActividades || '').trim().split(/\s+/).filter(Boolean).length;
      const total = o + e + a;
      const tag = p.EntregaHabilitada ? ' [HABILITADO]' : '';
      const aviso = p.EntregaHabilitada && total === 0 ? ' ⚠ habilitado pero sin notas detectadas' : '';
      log(`      ${p.ReuDsc || p.ReuCod}: O=${o} E=${e} A=${a}${p.RendVisible ? ` R=${p.RendVisible}` : ''}${p.NotasInsuficientes ? ` (${p.NotasInsuficientes} insuf.)` : ''}${tag}${aviso}`);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (abortSignal && abortSignal.aborted) return { ok: false, alumno, aborted: true };
      const historial = CFG.compararConAnterior ? historialAntesDe(rows, periodMap, i) : [];
      try {
        const r = await procesarFila(row, periodMap, { alumno, libreta, historial });
        log((r.ok ? '✓ ' : '· ') + r.msg);
      } catch (err) {
        log(`✗ ${row.dsc || row.code}: ${err.message}`);
      }
    }
    return { ok: true, alumno };
  }

  // ---------------------------------------------------------------------------
  // Auto-loop: procesar todos los alumnos del grupo
  // ---------------------------------------------------------------------------
  function clickLikeUser(el) {
    if (!el) return false;
    if (el.disabled) return false;
    try { el.focus(); } catch (_) { /* ignore */ }
    // 1) Llamar al onclick inline de GeneXus directamente (es lo más fiable
    //    porque el handler suele estar en el atributo, no en addEventListener).
    let viaOnclick = false;
    try {
      if (typeof el.onclick === 'function') {
        el.onclick(new MouseEvent('click', { bubbles: true, cancelable: true }));
        viaOnclick = true;
      }
    } catch (e) { console.warn('[SIGED Juicios] onclick lanzó error', e); }
    // 2) Disparar la secuencia completa de eventos de ratón para handlers
    //    registrados con addEventListener.
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }

  // Devuelve el primer elemento que matchee algún ID conocido o, si no,
  // el primer botón/input/anchor cuyo texto visible diga "Guardar y siguiente"
  // (también aceptamos "continuar"/"próximo" por si la UI lo cambia).
  function findGuardarYSiguiente() {
    const ids = [
      'BTNGUARDARYSIGUIENTE',
      'BTNGUARDARYSIGUIENTE_MPAGE',
      'BTNGUARDAR_Y_SIGUIENTE',
      'BTNGUARDARYCONTINUAR',
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && !el.disabled && el.offsetParent !== null) return el;
    }
    const candidates = $$('button, input[type="button"], input[type="submit"], a, span, div');
    for (const el of candidates) {
      if (el.disabled) continue;
      if (el.offsetParent === null) continue;
      const t = (el.value || el.textContent || '').trim().toLowerCase();
      if (!t || t.length > 60) continue;
      if (/guardar.*(siguiente|continuar|pr[oó]ximo)/i.test(t)) return el;
    }
    return null;
  }

  function clickGuardarYSiguiente() {
    const el = findGuardarYSiguiente();
    if (!el) {
      console.warn('[SIGED Juicios] no encontré botón Guardar y siguiente.');
      return false;
    }
    console.log('[SIGED Juicios] click en', el.id || el.tagName, el);
    return clickLikeUser(el);
  }

  // GeneXus marca data-gx-evt-inprogress="true" mientras procesa un evento.
  // Re-buscamos por ID en cada check porque tras el postback GX puede reemplazar
  // el <input> entero: la referencia previa queda "detached" y conserva
  // inprogress=true para siempre, lo que hacía que el wait nunca termine.
  function gxBusy(idOrEl) {
    const id = typeof idOrEl === 'string' ? idOrEl : (idOrEl && idOrEl.id) || 'BTNGUARDARYSIGUIENTE';
    const el = document.getElementById(id);
    if (!el) return false; // Botón ya no está en el DOM = el evento terminó.
    if (!document.body.contains(el)) return false;
    return el.getAttribute('data-gx-evt-inprogress') === 'true';
  }

  // GX está procesando algo si CUALQUIER elemento del DOM tiene el flag de
  // evento en curso. Útil entre alumnos: a veces el "save" termina pero GX
  // todavía está cargando datos del próximo alumno con otros evt-inprogress.
  function gxBusyAnywhere() {
    return !!document.querySelector('[data-gx-evt-inprogress="true"]');
  }

  // "Huella" del alumno actual: concatena los valores de todos los selects de
  // calificación y los textareas de juicio, más los textos numéricos que se
  // ven en las celdas. Es la señal MÁS confiable de navegación cuando GXState
  // queda en "{}" tras el primer postback (en candersen.siged.com.uy).
  function studentFingerprint() {
    const califs = $$('select[id^="vCALIFXREUCALIFCOD_"]')
      .map((s) => s.value || '').join(',');
    const juicios = $$('textarea[id^="vCALIFXREUJUICIO_"]')
      .map((t) => t.value || '').join('|');
    const cells = $$('#GridjuiciosContainerTbl span.ReadonlyAttributeNoBlock')
      .map((s) => (s.textContent || '').trim()).filter(Boolean).join(' ');
    return `${califs}#${juicios}#${cells}`;
  }

  async function waitForGxIdle(idOrEl, timeoutMs, abortSignal) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (abortSignal && abortSignal.aborted) return { aborted: true };
      // También cerramos popups que pudieran estar abiertos del estado anterior.
      autoConfirmPopup();
      if (!gxBusy(idOrEl)) return { idle: true };
      await sleep(300);
    }
    return { timeout: true };
  }

  // Espera a que GX procese un evento del botón: primero ve el flag in-progress
  // arriba, después abajo. Si el flag nunca subió suponemos que el click no
  // disparó nada.
  async function waitForGxEventComplete(idOrEl, timeoutMs, abortSignal, log) {
    const id = typeof idOrEl === 'string' ? idOrEl : (idOrEl && idOrEl.id) || 'BTNGUARDARYSIGUIENTE';
    const t0 = Date.now();
    let sawBusy = false;
    let lastLog = 0;
    let confirmados = 0;
    let dumpedAt = 0;
    while (Date.now() - t0 < timeoutMs) {
      if (abortSignal && abortSignal.aborted) return { aborted: true };
      // Si GX abrió un popup de confirmación lo aceptamos automáticamente.
      const auto = autoConfirmPopup();
      if (auto) {
        if (auto.confirmed) {
          confirmados += 1;
          if (log) log(`   ↩ confirmé popup ("${auto.text.slice(0, 80)}…") con ${auto.button || 'botón afirmativo'}`);
          // Esperamos un poco a que GX procese la confirmación.
          await sleep(500);
          continue;
        }
        if (log) log(`   ⚠ Popup activo sin botón afirmativo: "${auto.text.slice(0, 120)}"`);
        return { popup: auto.text };
      }
      const busy = gxBusy(id);
      if (busy) sawBusy = true;
      if (sawBusy && !busy) return { complete: true, confirmados };
      const elapsedMs = Date.now() - t0;
      if (Date.now() - lastLog > 5000 && log) {
        const elapsed = Math.round(elapsedMs / 1000);
        log(`   …esperando a GeneXus (${elapsed}s, busy=${busy})`);
        lastLog = Date.now();
      }
      // Si llevamos mucho tiempo en busy=true sin popup detectable, volcamos
      // un diagnóstico para entender qué pide SIGED.
      if (busy && elapsedMs > 15000 && !dumpedAt && log) {
        dumpedAt = elapsedMs;
        log('   ⚠ GeneXus lleva 15s ocupado sin popup detectable. Volcado de diagnóstico:');
        dumpDiagnostic(log);
      }
      await sleep(300);
    }
    return { timeout: true, sawBusy, confirmados };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Devuelve un snapshot de "qué encontré en la pantalla", útil para diagnóstico.
  function inspectPage() {
    const stateRaw = readGxStateRaw();
    const hasGxState = !!stateRaw;
    const stateSize = stateRaw ? stateRaw.length : 0;
    let state = null;
    if (stateRaw) { try { state = JSON.parse(stateRaw); } catch (_) {} }
    const tbl = document.getElementById('GridjuiciosContainerTbl');
    const rows = tbl ? tbl.querySelectorAll('tbody > tr[id^="GridjuiciosContainerRow_"]').length : 0;
    const periodMap = state ? collectPeriodDataFromState(state) : new Map();
    const periods = periodMap.size;
    // Conteos auxiliares: cuántos objetos tienen ReuCod (aunque no matcheen
    // los criterios completos), cuántos colDatosReu, etc.
    let reuCodCount = 0, colDatosReuCount = 0;
    const reuCodSamples = [];
    if (state) {
      walkObjects(state, (obj) => {
        if (typeof obj.ReuCod === 'string') {
          reuCodCount += 1;
          if (reuCodSamples.length < 5) {
            const keys = Object.keys(obj).slice(0, 12);
            reuCodSamples.push(`${obj.ReuCod.trim()} → keys: [${keys.join(', ')}]`);
          }
        }
        if (Array.isArray(obj.colDatosReu)) colDatosReuCount += 1;
      });
    }
    const topKeys = state ? Object.keys(state).slice(0, 20) : [];
    return {
      hasGxState, stateSize, hasTable: !!tbl, rows, periods,
      reuCodCount, colDatosReuCount, reuCodSamples, topKeys, state,
    };
  }

  // Devuelve true cuando hay grilla con filas y períodos disponibles.
  // Acepta períodos vía GXState o vía scraping DOM como fallback.
  function gridReady() {
    const i = inspectPage();
    if (!i.hasGxState || !i.hasTable || i.rows <= 0) return false;
    if (i.periods > 0) return true;
    // Fallback DOM: si SIGED no rellenó el SDT pero hay filas, probamos a
    // extraer del HTML rendido. Si conseguimos al menos un período habilitado
    // (o cualquier período con código), consideramos la página lista.
    const domMap = extractPeriodsFromDom();
    return domMap.size > 0;
  }

  async function waitForGridReady(timeoutMs, abortSignal) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (abortSignal && abortSignal.aborted) return { ready: false, aborted: true };
      // La grilla se considera lista solo si tiene datos Y GeneXus no está
      // procesando NINGÚN evento (ningún input/botón con evt-inprogress).
      if (gridReady() && !gxBusyAnywhere()) return { ready: true };
      await sleep(400);
    }
    return { ready: false, timeout: true };
  }

  // Considera "visible" si tiene caja real en pantalla (offsetParent puede ser
  // null para elementos con position:fixed aunque sí se vean).
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }

  // Popups REALES de SIGED (modales overlay). El span id="DIAG" NO es un popup,
  // es un label permanente de la sección "Evaluación diagnóstica interdisciplinaria"
  // del cuerpo de la página, por eso no entra en esta lista.
  // Mapeo conocido (instancia candersen):
  //   SECTIONPOPUP        → mensajes generales, botón BTNCONTINUARPOPUP "Continuar"
  //   SECTIONPOPUPDIAG    → popup diagnóstico,  botón BTNCERRARPOPUPDIAG  "Cerrar"
  //   TBMENSAJE_MPAGE     → master page (sesión por expirar), botón BTNCERRARMASTARDE_MPAGE
  // NO incluimos TABLEPANELES_MPAGE: ese es el contenedor permanente del cuerpo
  // de la página; tomarlo como popup hace que escanee toda la barra de
  // herramientas y termine clickeando BTNGUARDARYANTERIOR.
  const POPUP_MAP = [
    { container: 'SECTIONPOPUPDIAG', confirmBtn: 'BTNCERRARPOPUPDIAG' },
    { container: 'SECTIONPOPUP',     confirmBtn: 'BTNCONTINUARPOPUP' },
    { container: 'TBMENSAJE_MPAGE',  confirmBtn: 'BTNCERRARMASTARDE_MPAGE' },
  ];

  // Botones que JAMÁS deben tratarse como confirmación de popup: son los de la
  // barra principal y los del menú lateral. Si el detector se confunde, esta
  // lista evita un loop catastrófico (clickear "anterior" mientras se intenta
  // guardar y avanzar).
  const TOOLBAR_BTN_BLACKLIST = new Set([
    'BTNGUARDARYSIGUIENTE',
    'BTNGUARDARYANTERIOR',
    'BTNGUARDAR',
    'BTNGUARDARSIN',
    'BTNCANCELAR',
    'BTNREGRESAR',
    'BTNATRAS',
    'BTNBUSCAR',
    'BTNLIMPIAR',
    'BTNSALIR_MPAGE',
    'BTNCERRAR_MPAGE',
  ]);

  function popupVisible() {
    for (const p of POPUP_MAP) {
      const el = document.getElementById(p.container);
      if (!el || !isVisible(el)) continue;
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      return { id: p.container, text: txt.slice(0, 200), el, knownBtn: p.confirmBtn };
    }
    return null;
  }

  // Vuelco diagnóstico completo. Imprime contenedores, botones, y un
  // resumen del GXState (top-level keys, conteos de ReuCod y colDatosReu,
  // ejemplos de objetos con ReuCod). Lo usamos cuando algo se traba.
  function dumpDiagnostic(log) {
    const insp = inspectPage();
    log(`     GXState: present=${insp.hasGxState} size=${insp.stateSize} chars`);
    log(`     Top keys: [${insp.topKeys.join(', ')}]`);
    log(`     ReuCod en state: ${insp.reuCodCount} objetos · colDatosReu arrays: ${insp.colDatosReuCount} · períodos detectados: ${insp.periods}`);
    if (insp.reuCodSamples.length) {
      log('     Muestras de objetos con ReuCod:');
      for (const s of insp.reuCodSamples) log(`       - ${s}`);
    }
    log(`     Grilla: tabla=${insp.hasTable}, filas=${insp.rows}`);

    const containers = [
      'SECTIONPOPUP', 'SECTIONPOPUPDIAG', 'TBMSJPOPUP', 'TBMSJPOPUPDIAG',
      'TBMENSAJE_MPAGE', 'TABLEDIAGNOSTICO', 'TBLANTECEDENTES', 'DIAG',
      'TABLEPANELES_MPAGE', 'SECTION1_MPAGE',
    ];
    for (const id of containers) {
      const el = document.getElementById(id);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const len = (el.textContent || '').trim().length;
      const r = el.getBoundingClientRect();
      log(`     #${id}: visible=${isVisible(el)} display=${cs.display} chars=${len} box=${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const btns = Array.from(document.querySelectorAll('button, input[type=button], input[type=submit]'));
    const candidates = btns
      .filter((b) => isVisible(b) && !TOOLBAR_BTN_BLACKLIST.has(b.id) && !b.disabled)
      .map((b) => `${b.id || '?'}="${(b.value || b.textContent || '').trim().slice(0, 40)}"`);
    log(`     visibles: ${candidates.slice(0, 25).join(', ') || '(ninguno)'}`);
    log('     [F12 Console] hay un dump completo con outerHTML y GXState raw.');
    try {
      console.log('[SIGED Juicios] dumpDiagnostic — completo', {
        inspect: insp,
        rawState: readGxStateRaw(),
        popups: containers.map((id) => {
          const el = document.getElementById(id);
          return el ? { id, visible: isVisible(el), display: getComputedStyle(el).display, len: (el.textContent || '').trim().length, html: el.outerHTML.slice(0, 800) } : { id, present: false };
        }),
        buttons: candidates,
        gridRows: collectGridRows().map((r) => ({ idx: r.idx, code: r.code, dsc: r.dsc, hasJuicio: !!r.juicio, hasCalif: !!r.califSelect })),
      });
    } catch (_) {}
  }

  // Helpers de scrapping de la grilla real de notas (FreeStyleGrid) ----------
  // Estructura observada (capturada con el modo scrapping del panel):
  //   table.FreeStyleGrid > tbody > tr > td.beTableEvalFiltro:nth-of-type(N)
  //     └─ table.beTableLibretaEval
  //        ├─ tr.beTableLibretaCabezalEval > td > table > tbody > tr > td
  //        │    └─ span.ReadonlyAttribute  ← nombre del período
  //        └─ tr > td > table.beTableLibretaDatosEval
  //           └─ tbody
  //              ├─ tr (header: Orales | Escritas | O.Act | R)
  //              └─ tr (data row con <td><span>6</span><span>8</span>…</td> por columna)

  function collectTooltipText(el) {
    const parts = [
      el.getAttribute('title'),
      el.getAttribute('data-content'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-original-title'),
      el.getAttribute('data-tip'),
    ].map((s) => (s || '').trim()).filter(Boolean);
    return Array.from(new Set(parts)).join(' — ');
  }

  function extractNotesFromCell(td, columnLabel) {
    if (!td) return [];
    const out = [];
    const spans = td.querySelectorAll('span');
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (!t) continue;
      if (!/^\d{1,2}([.,]\d{1,2})?$/.test(t)) {
        if (t && t.length < 40) debugViz.mark(s, debugViz.colors.noteSkip, `descartada: "${t}"`);
        continue;
      }
      const num = parseFloat(t.replace(',', '.'));
      if (Number.isNaN(num) || num < 0 || num > 10) {
        debugViz.mark(s, debugViz.colors.noteSkip, `fuera rango: ${t}`);
        continue;
      }
      const tooltip = collectTooltipText(s);
      // SIGED marca con la clase ColorTextoBaja las notas que cuentan como
      // insuficientes/ausencias (típicamente 1). La detección la pasamos a
      // Claude como contexto extra.
      const cls = (typeof s.className === 'string') ? s.className : '';
      const colorBaja = /ColorTextoBaja/i.test(cls);
      const tip = tooltip + (colorBaja ? (tooltip ? ' — ' : '') + 'marcada como insuficiente' : '');
      const labelTip = tip ? ` ${tip.slice(0, 30)}…` : '';
      debugViz.mark(s, debugViz.colors.note, `${columnLabel || 'nota'}: ${t}${labelTip}`);
      out.push({ value: t, num, tooltip: tip, columna: columnLabel || '', colorBaja });
    }
    return out;
  }

  // Devuelve un mapa { periodName -> { orales, escritas, oAct, rendText } }
  // leyendo la grilla de notas FreeStyleGrid del cuerpo de la página.
  function gradesFromFreeStyleGrid() {
    const map = new Map();
    const grids = document.querySelectorAll('table.FreeStyleGrid, table[class*="FreeStyleGrid"]');
    for (const grid of grids) {
      const periodCells = grid.querySelectorAll('td[class*="beTableEvalFiltro"]');
      for (const cell of periodCells) {
        const evalTbl = cell.querySelector('table[class*="beTableLibretaEval"]');
        if (!evalTbl) continue;
        const nameSpan = evalTbl.querySelector('table[class*="beTableLibretaCabezalEval"] span');
        const name = (nameSpan && nameSpan.textContent.trim()) || '';
        if (!name) continue;
        debugViz.mark(nameSpan, debugViz.colors.period, `período: ${name}`);
        const dataTbl = evalTbl.querySelector('table[class*="beTableLibretaDatosEval"]');
        if (!dataTbl) continue;
        const trs = dataTbl.querySelectorAll(':scope > tbody > tr');
        if (trs.length < 2) continue;
        const dataRow = trs[trs.length - 1];
        const tds = dataRow.querySelectorAll(':scope > td');
        const orales = extractNotesFromCell(tds[0], 'Orales');
        const escritas = extractNotesFromCell(tds[1], 'Escritas');
        const oAct = extractNotesFromCell(tds[2], 'O.Act');
        const rendCell = tds[3];
        const rendSpan = rendCell ? rendCell.querySelector('span') : null;
        const rendText = (rendSpan && rendSpan.textContent.trim()) || '';
        if (rendCell && rendText) {
          debugViz.mark(rendSpan || rendCell, debugViz.colors.rendCell, `R visible: ${rendText}`);
        }
        map.set(name.trim(), { orales, escritas, oAct, rendText });
      }
    }
    return map;
  }

  // Búsqueda tolerante: trim, case-insensitive, partial match. Importante
  // porque a veces el nombre que muestra GridjuiciosContainerTbl tiene espacios
  // de relleno que no aparecen en la grilla de notas.
  function lookupGrades(grades, dsc) {
    if (!dsc) return null;
    if (grades.has(dsc)) return grades.get(dsc);
    const t = (dsc || '').trim();
    if (grades.has(t)) return grades.get(t);
    const lower = t.toLowerCase();
    for (const [k, v] of grades) {
      if ((k || '').trim().toLowerCase() === lower) return v;
    }
    for (const [k, v] of grades) {
      const kn = (k || '').trim().toLowerCase();
      if (!kn || !lower) continue;
      if (kn.includes(lower) || lower.includes(kn)) return v;
    }
    return null;
  }

  // Fallback: combina la grilla de notas (FreeStyleGrid) con la grilla de
  // entrada (GridjuiciosContainerTbl) que tiene los <select> y <textarea>
  // editables. Las cruzamos por nombre de período.
  function extractPeriodsFromDom() {
    const map = new Map();
    const grades = gradesFromFreeStyleGrid();
    const rows = $$('#GridjuiciosContainerTbl > tbody > tr[id^="GridjuiciosContainerRow_"]');
    for (const tr of rows) {
      const idx = (tr.id.match(/_(\d+)$/) || [])[1];
      const reuCodEl = document.getElementById(`span_vREUCOD_${idx}`);
      const reuCod = (reuCodEl && reuCodEl.textContent.trim()) || '';
      if (!reuCod) continue;
      const dscEl = document.getElementById(`span_CTLREUDSC1_${idx}`);
      const dsc = (dscEl && dscEl.textContent.trim()) || '';

      const califSel = document.getElementById(`vCALIFXREUCALIFCOD_${idx}`);
      const juicioTa = document.getElementById(`vCALIFXREUJUICIO_${idx}`);
      const enabledCalif = !!califSel && !califSel.disabled
        && getComputedStyle(califSel).display !== 'none';
      const enabledJuicio = !!juicioTa && !juicioTa.disabled
        && getComputedStyle(juicioTa).display !== 'none';
      const habilitado = enabledCalif || enabledJuicio;

      const g = lookupGrades(grades, dsc) || { orales: [], escritas: [], oAct: [], rendText: '' };
      const all = [...g.orales, ...g.escritas, ...g.oAct];
      const detalle = all
        .map((n) => {
          const partes = [];
          if (n.columna) partes.push(n.columna);
          if (n.tooltip) partes.push(n.tooltip);
          return partes.length ? `${n.value} (${partes.join(': ')})` : n.value;
        })
        .join(' · ');

      map.set(reuCod.trim(), {
        ReuCod: reuCod,
        ReuDsc: dsc,
        Orales: g.orales.map((n) => n.value).join(' '),
        Escritos: g.escritas.map((n) => n.value).join(' '),
        OActividades: g.oAct.map((n) => n.value).join(' '),
        OActividadesDetalle: detalle,
        Mensaje: habilitado ? 'Período habilitado (DOM)' : 'Período no habilitado',
        AsigPideRendimiento: !!califSel,
        AsigPideJuicio: !!juicioTa,
        EntregaHabilitada: habilitado,
        CalifxReuJuicio: juicioTa ? juicioTa.value : '',
        CalifxReuCalifCod: califSel ? califSel.value : (g.rendText || ''),
        RendVisible: g.rendText,
        // Cantidad de notas con ColorTextoBaja (insuficientes) — útil para Claude.
        NotasInsuficientes: all.filter((n) => n.colorBaja).length,
        InasInjustificadas: '',
        InasJustificadas: '',
        InasFictas: '',
      });
    }
    return map;
  }

  // Busca el botón a clickear para cerrar el popup. Primero el conocido por
  // contenedor; después IDs típicos; después texto afirmativo. Nunca devuelve
  // un botón de la barra principal (TOOLBAR_BTN_BLACKLIST).
  function findPopupConfirmButton(popup) {
    const safe = (el) => el && !el.disabled && isVisible(el) && !TOOLBAR_BTN_BLACKLIST.has(el.id);

    if (popup && popup.knownBtn) {
      const el = document.getElementById(popup.knownBtn);
      if (safe(el)) return el;
    }
    const ids = [
      'BTNCERRARPOPUPDIAG', 'BTNCONTINUARPOPUP',
      'BTNACEPTARPOPUP', 'BTNACEPTAR', 'BTNSI', 'BTNCONTINUAR', 'BTNGUARDARPOPUP',
      'BTNENTENDIDO_MPAGE', 'BTNCERRARMASTARDE_MPAGE',
      'BTNCERRARPOPUP', 'BTNVOLVER',
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (safe(el)) return el;
    }
    // Solo escaneamos texto DENTRO del popup activo (no en toda la página).
    if (!popup || !popup.el) return null;
    // Quitamos "guardar" del regex porque colisiona con la barra principal
    // (BTNGUARDARYSIGUIENTE/ANTERIOR). Solo aceptamos textos típicos de un
    // botón de popup.
    const positivos = /^(s[ií]|aceptar|continuar|ok|confirmar|entendido)\b/i;
    const negativos = /^(cerrar(\s+m[aá]s\s+tarde)?|m[aá]s\s+tarde|saltar|omitir|salir|volver|cancelar|cerrar)\b/i;
    let firstNeg = null;
    const btns = popup.el.querySelectorAll('button, input[type=button], input[type=submit], a, span, div[role=button]');
    for (const btn of btns) {
      if (!safe(btn)) continue;
      const t = (btn.value || btn.textContent || btn.title || '').trim();
      if (!t || t.length > 60) continue;
      if (positivos.test(t)) return btn;
      if (negativos.test(t) && !firstNeg) firstNeg = btn;
    }
    return firstNeg;
  }

  function autoConfirmPopup() {
    const pop = popupVisible();
    if (!pop) return null;
    const btn = findPopupConfirmButton(pop);
    if (!btn) {
      try { console.warn('[SIGED Juicios] popup sin botón confirmable:', pop.id, pop.el.outerHTML.slice(0, 1500)); } catch (_) {}
      return { confirmed: false, text: pop.text };
    }
    clickLikeUser(btn);
    return { confirmed: true, text: pop.text, button: btn.id || (btn.value || btn.textContent || '').trim() };
  }

  // Espera a que el GXState (input hidden de GeneXus) cambie, indicando que
  // SIGED hizo el postback y cargó al siguiente alumno; después espera a que
  // la grilla quede lista de nuevo.
  // Espera la navegación al siguiente alumno usando dos señales en paralelo:
  //   1) GXState raw cambia (funciona en la primera transición).
  //   2) studentFingerprint cambia (funciona siempre, incluso si GXState
  //      queda como "{}" después del primer save — caso real en candersen).
  // Cuando alguna cambia, esperamos a que GX no esté ocupado y que la grilla
  // del nuevo alumno tenga datos para procesarla.
  async function waitForNextStudent(prevStateRaw, prevFingerprint, timeoutMs, abortSignal, log) {
    const t0 = Date.now();
    let navDetected = false;
    let lastLog = 0;
    let lastDumpAt = 0;
    while (Date.now() - t0 < timeoutMs) {
      if (abortSignal && abortSignal.aborted) return { changed: false, aborted: true };
      const pop = popupVisible();
      if (pop) return { changed: false, popup: `${pop.id}: ${pop.text}` };

      if (!navDetected) {
        const curState = readGxStateRaw();
        const curFp = studentFingerprint();
        if ((curState && curState !== prevStateRaw) || (curFp && curFp !== prevFingerprint)) {
          navDetected = true;
          if (log) {
            const motivo = (curState && curState !== prevStateRaw) ? 'GXState cambió' : 'huella del alumno cambió';
            log(`   → navegación detectada (${motivo}); esperando que termine de pintar la grilla…`);
          }
        }
      } else if (gridReady() && !gxBusyAnywhere()) {
        return { changed: true };
      }

      const elapsed = Date.now() - t0;
      if (elapsed - lastLog > 10000 && log) {
        const fase = navDetected ? 'cargando próximo alumno' : 'esperando navegación';
        const diag = inspectPage();
        log(`   …${fase} (${Math.round(elapsed / 1000)}s, busy=${gxBusyAnywhere()}, filas=${diag.rows}, períodos=${diag.periods}, gxSize=${diag.stateSize})`);
        lastLog = elapsed;
      }
      if (navDetected && elapsed - lastDumpAt > 30000 && log) {
        log(`   ▼ auto-dump (${Math.round(elapsed / 1000)}s):`);
        dumpDiagnostic(log);
        lastDumpAt = elapsed;
      }
      await sleep(500);
    }
    return { changed: false, timeout: !navDetected, gridStuck: navDetected };
  }

  async function procesarTodos(log, abortSignal) {
    const procesados = new Set();
    let i = 0;
    let firstIteration = true;
    while (true) {
      if (abortSignal.aborted) { log('⏹ Detenido por el usuario.'); return; }

      // En la primera iteración no bloqueamos esperando: si algo falta lo
      // diagnosticamos. En las siguientes (después del save+navegación) sí
      // esperamos a que SIGED termine de cargar el siguiente alumno.
      if (!firstIteration) {
        const ready = await waitForGridReady(20000, abortSignal);
        if (ready.aborted) { log('⏹ Detenido por el usuario.'); return; }
        if (!ready.ready) {
          const diag = inspectPage();
          log(`Tras el guardado la grilla no se repobló (gxState=${diag.hasGxState}, tabla=${diag.hasTable}, filas=${diag.rows}, períodos=${diag.periods}). Asumo fin de grupo.`);
          return;
        }
      } else {
        // Diagnóstico inicial visible para el usuario.
        const diag = inspectPage();
        log(`Estado inicial: gxState=${diag.hasGxState}, tabla=${diag.hasTable}, filas=${diag.rows}, períodos=${diag.periods}.`);
        if (!diag.hasTable) {
          log('No encontré la tabla "GridjuiciosContainerTbl". ¿Estás en "Cerrar Prom. por Alumno" con un alumno abierto?');
          return;
        }
        if (diag.rows === 0) {
          log('La tabla existe pero no tiene filas. Abrí un alumno y volvé a intentar.');
          return;
        }
        if (diag.periods === 0) {
          // GXState vacío (típico tras recargar o tras varios saves).
          // Antes de fallar probamos el scrapeo DOM de la grilla FreeStyleGrid.
          const domMap = extractPeriodsFromDom();
          if (domMap.size === 0) {
            log('La tabla tiene filas pero ni GXState ni el DOM (FreeStyleGrid) traen datos de períodos. Detengo.');
            return;
          }
          log(`   ℹ GXState vacío; uso fallback DOM (${domMap.size} períodos detectados). Sigo adelante.`);
        }
      }
      firstIteration = false;

      i += 1;
      log(`\n— Alumno #${i} —`);
      const stateBefore = readGxStateRaw();
      let res;
      try {
        res = await procesarAlumnoActual(log, abortSignal);
      } catch (err) {
        log(`✗ error procesando alumno: ${err.message || err}`);
        res = { ok: false, error: true };
      }
      if (res.aborted) { log('⏹ Detenido por el usuario.'); return; }
      if (!res.ok) {
        log('No pude procesar este alumno; intento avanzar igual con "Guardar y siguiente"…');
      }

      if (res.alumno && procesados.has(res.alumno)) {
        log(`⏹ "${res.alumno}" ya estaba procesado. Asumo fin de grupo.`);
        return;
      }
      if (res.alumno) procesados.add(res.alumno);

      // Antes de clickear, esperamos a que ningún postback de los onchange
      // (Rend, Juicio) siga en vuelo. data-gx-evt-inprogress=true en cualquier
      // botón GX significa "GeneXus ocupado". Pasamos el ID (no el elemento)
      // porque GX puede reemplazar el <input> en el DOM tras cada postback y
      // queremos siempre re-leer el botón fresco.
      const btnSaveInicial = findGuardarYSiguiente();
      if (!btnSaveInicial) { log('No encontré el botón "Guardar y siguiente". Detengo.'); return; }
      const btnSaveId = btnSaveInicial.id || 'BTNGUARDARYSIGUIENTE';
      const idle1 = await waitForGxIdle(btnSaveId, 20000, abortSignal);
      if (idle1.aborted) { log('⏹ Detenido por el usuario.'); return; }
      if (!idle1.idle) {
        log('GeneXus sigue procesando los cambios después de 20s. Reintento igual…');
      }
      // Capturamos la huella DESPUÉS del fill y justo antes del click. Si la
      // capturáramos al inicio (antes del fill) terminaría siendo similar al
      // estado en que SIGED renderiza al alumno SIGUIENTE (campos vacíos),
      // y waitForNextStudent nunca detectaría la navegación.
      const fingerprintBefore = studentFingerprint();
      if (abortSignal.aborted) { log('⏹ Detenido por el usuario antes de guardar.'); return; }

      const clicked = clickGuardarYSiguiente();
      if (!clicked) { log('No pude clickear "Guardar y siguiente". Detengo.'); return; }
      log('💾 Guardando y avanzando al siguiente alumno…');

      // Esperamos a que GX procese el evento (flag busy on -> off).
      const ev = await waitForGxEventComplete(btnSaveId, 90000, abortSignal, log);
      if (ev.aborted) { log('⏹ Detenido por el usuario.'); return; }
      if (ev.popup) { log(`SIGED mostró un popup que no pude confirmar: "${ev.popup.slice(0, 200)}". Detengo para que lo revises a mano.`); return; }
      if (ev.timeout) {
        if (!ev.sawBusy) {
          log('El click no levantó el flag GX-busy: vuelvo a clickear con foco+Enter…');
          const btnAhora = document.getElementById(btnSaveId);
          if (btnAhora) {
            try { btnAhora.focus(); } catch (_) {}
            btnAhora.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
            btnAhora.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
            btnAhora.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
          }
          const ev2 = await waitForGxEventComplete(btnSaveId, 60000, abortSignal, log);
          if (ev2.aborted) { log('⏹ Detenido por el usuario.'); return; }
          if (ev2.popup) { log(`Popup sin botón afirmativo: "${ev2.popup.slice(0, 200)}". Detengo.`); return; }
          if (!ev2.complete) { log('Sigue sin completarse. Detengo.'); return; }
        } else {
          log('GeneXus no terminó el guardado tras 90s. Detengo.');
          return;
        }
      } else if (ev.confirmados) {
        log(`   (cerré ${ev.confirmados} popup(s) de SIGED)`);
      }

      // GX terminó el evento; ahora esperamos a que la grilla se repueble
      // con el siguiente alumno (o el GXState cambie, o aparezca un popup).
      // Timeout generoso porque candersen.siged es un sitio lento.
      const wait = await waitForNextStudent(stateBefore, fingerprintBefore, 90000, abortSignal, log);
      if (wait.aborted) { log('⏹ Detenido por el usuario.'); return; }
      if (wait.popup) {
        log(`SIGED mostró un mensaje: "${wait.popup}". Detengo para que lo revises a mano.`);
        return;
      }
      if (wait.gridStuck) {
        log('SIGED postbackeó pero la grilla no terminó de cargar tras 90s. Volcado de diagnóstico:');
        dumpDiagnostic(log);
        log('Asumo fin de grupo.');
        return;
      }
      if (!wait.changed) {
        log('No detecté postback tras 90s. Detengo (¿último alumno o error?).');
        return;
      }
      // Settle wait: damos 5 segundos extra después de que SIGED carga el
      // siguiente alumno para que termine los onchange iniciales
      // (recálculo de promedios, habilitación de campos, etc.).
      log('   ⏳ esperando 5s a que SIGED termine de pintar al próximo alumno…');
      await sleep(5000);
      const nuevo = detectAlumno();
      log(`→ Nuevo alumno: ${nuevo || '(sin nombre detectado)'}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Debug visual: pinta los elementos que la extensión toca con colores y
  // etiquetas, para ver qué scrapea y qué ignora.
  // ---------------------------------------------------------------------------
  const debugViz = {
    active: false,
    marks: [],
    colors: {
      period: '#3b82f6',     // azul - nombre del período
      note: '#22c55e',       // verde - nota numérica usada
      noteSkip: '#ef4444',   // rojo - candidato descartado
      rendCell: '#eab308',   // amarillo - celda R (promedio visible)
      califInput: '#f97316', // naranja - select de Rend (editable)
      juicioInput: '#a855f7',// morado - textarea de Juicio (editable)
      filled: '#10b981',     // verde fuerte - campo completado por nosotros
      ignored: '#6b7280',    // gris - fila procesada pero período no habilitado
    },
    mark(el, color, label) {
      if (!this.active || !el || !el.style) return;
      const original = { outline: el.style.outline, offset: el.style.outlineOffset };
      el.style.outline = `2px solid ${color}`;
      el.style.outlineOffset = '1px';
      let badge = null;
      if (label) {
        badge = document.createElement('div');
        badge.className = 'siged-debug-badge';
        badge.textContent = label;
        badge.style.background = color;
        const r = el.getBoundingClientRect();
        badge.style.top = `${r.top + window.scrollY - 14}px`;
        badge.style.left = `${r.left + window.scrollX}px`;
        document.body.appendChild(badge);
      }
      this.marks.push({ el, badge, original });
    },
    clear() {
      for (const m of this.marks) {
        if (m.el && m.el.style) {
          m.el.style.outline = m.original.outline || '';
          m.el.style.outlineOffset = m.original.offset || '';
        }
        if (m.badge && m.badge.parentNode) m.badge.parentNode.removeChild(m.badge);
      }
      this.marks = [];
    },
    activate() {
      this.active = true;
      if (!document.getElementById('siged-debug-style')) {
        const s = document.createElement('style');
        s.id = 'siged-debug-style';
        s.textContent = `
          .siged-debug-badge{position:absolute;color:#fff;font:10px/1 system-ui,sans-serif;
            padding:2px 4px;border-radius:3px;z-index:2147483646;pointer-events:none;
            white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3);max-width:240px;
            overflow:hidden;text-overflow:ellipsis}
        `;
        document.head.appendChild(s);
      }
    },
    deactivate() {
      this.active = false;
      this.clear();
    },
  };

  // ---------------------------------------------------------------------------
  const scrap = { active: false, hoverEl: null, captures: [] };

  function cssPath(el) {
    const path = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && path.length < 8) {
      let sel = cur.tagName.toLowerCase();
      if (cur.id) { path.unshift(`#${cur.id}`); break; }
      const cls = (typeof cur.className === 'string')
        ? cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        : '';
      if (cls) sel += `.${cls}`;
      const parent = cur.parentNode;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      path.unshift(sel);
      cur = cur.parentNode;
    }
    return path.join(' > ');
  }

  function scrapHighlight(el) {
    el._sigedSavedOutline = el.style.outline;
    el._sigedSavedOffset = el.style.outlineOffset;
    el.style.outline = '2px solid #22c55e';
    el.style.outlineOffset = '2px';
  }
  function scrapUnhighlight(el) {
    el.style.outline = el._sigedSavedOutline || '';
    el.style.outlineOffset = el._sigedSavedOffset || '';
    delete el._sigedSavedOutline;
    delete el._sigedSavedOffset;
  }

  function scrapHoverHandler(e) {
    if (!scrap.active) return;
    const t = e.target;
    if (!t || t === scrap.hoverEl) return;
    if (t.closest && t.closest('#siged-juicios-panel')) return;
    if (scrap.hoverEl) scrapUnhighlight(scrap.hoverEl);
    scrapHighlight(t);
    scrap.hoverEl = t;
  }

  function scrapClickHandler(e) {
    if (!scrap.active) return;
    const el = e.target;
    if (!el || (el.closest && el.closest('#siged-juicios-panel'))) return;
    e.preventDefault();
    e.stopPropagation();
    const sugerido = el.id ? `#${el.id}` : el.tagName.toLowerCase();
    const comment = window.prompt(`Comentario sobre "${sugerido}" (qué hace este elemento, qué dato extraer):`, '');
    if (comment === null) return; // cancel
    const cap = {
      n: scrap.captures.length + 1,
      comment: comment.trim(),
      tagName: el.tagName,
      id: el.id || null,
      name: el.getAttribute('name') || null,
      classes: (typeof el.className === 'string') ? el.className.trim() : null,
      selector: cssPath(el),
      text: (el.textContent || '').trim().slice(0, 500),
      value: (el.value !== undefined && el.value !== null) ? String(el.value).slice(0, 500) : null,
      attrs: {},
      tooltipAttrs: {},
      visible: isVisible(el),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      html: (el.outerHTML || '').slice(0, 3000),
      timestamp: new Date().toISOString(),
    };
    // Atributos completos.
    for (const a of el.attributes || []) {
      cap.attrs[a.name] = (a.value || '').slice(0, 500);
      if (/^(title|aria-label|data-content|data-original-title|data-tip|data-tooltip|alt)$/i.test(a.name)) {
        cap.tooltipAttrs[a.name] = a.value;
      }
    }
    scrap.captures.push(cap);
    panelLog(`📌 capturé #${cap.n} "${cap.id || cap.tagName.toLowerCase()}"${cap.comment ? ` — ${cap.comment.slice(0, 60)}` : ''}`);
    refreshScrapStatus();
    // Flash visual.
    scrapUnhighlight(el);
    setTimeout(() => { scrapHighlight(el); setTimeout(() => scrapUnhighlight(el), 250); }, 80);
  }

  function scrapingActivate() {
    scrap.active = true;
    document.addEventListener('mousemove', scrapHoverHandler, true);
    document.addEventListener('click', scrapClickHandler, true);
    document.body.style.cursor = 'crosshair';
    panelLog('🔧 Modo scrapping activado. Hacé click en cualquier elemento para capturarlo.');
  }
  function scrapingDeactivate() {
    scrap.active = false;
    document.removeEventListener('mousemove', scrapHoverHandler, true);
    document.removeEventListener('click', scrapClickHandler, true);
    if (scrap.hoverEl) scrapUnhighlight(scrap.hoverEl);
    scrap.hoverEl = null;
    document.body.style.cursor = '';
    panelLog('🔧 Modo scrapping desactivado.');
  }

  async function scrapingExport() {
    if (!scrap.captures.length) {
      panelLog('No hay capturas. Activá el inspector y clickeá elementos.');
      return;
    }
    const payload = {
      url: location.href,
      capturedAt: new Date().toISOString(),
      captures: scrap.captures,
    };
    const text = JSON.stringify(payload, null, 2);
    let copiado = false;
    try { await navigator.clipboard.writeText(text); copiado = true; } catch (_) {}
    panelLog(`📋 ${scrap.captures.length} captura(s) ${copiado ? 'copiadas al portapapeles' : 'listas en F12 Console'}.`);
    console.log('[SIGED Juicios] capturas:', payload);
  }

  function scrapingClear() {
    scrap.captures = [];
    panelLog('🗑 Capturas limpiadas.');
    refreshScrapStatus();
  }

  // log y refreshScrapStatus se enlazan al panel construido más abajo.
  let panelLog = (m) => console.log('[SIGED Juicios]', m);
  let refreshScrapStatus = () => {};

  // ---------------------------------------------------------------------------
  // Panel flotante
  // ---------------------------------------------------------------------------
  function buildPanel() {
    if (document.getElementById('siged-juicios-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'siged-juicios-panel';
    panel.innerHTML = `
      <style>
        #siged-juicios-panel{position:fixed!important;bottom:16px!important;right:16px!important;left:auto!important;top:auto!important;
          z-index:2147483647!important;background:#1f2937;color:#f9fafb;display:block!important;visibility:visible!important;
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
        <button class="primary" data-act="run">Generar juicios (alumno actual)</button>
        <button class="primary alt" data-act="run-all">Procesar todo el grupo (auto)</button>
        <button class="danger" data-act="stop" hidden>⏹ Detener</button>
        <button class="secondary" data-act="diag">🔍 Diagnóstico ahora</button>
        <label class="check-row">
          <input type="checkbox" data-fld="debug-toggle">
          🐞 Modo debug visual (pinta lo que toca)
        </label>
        <div class="legend" data-fld="debug-legend" hidden></div>
        <details class="scrap">
          <summary>🔧 Modo scrapping (avanzado)</summary>
          <div class="scrap-body">
            <div class="status" data-fld="scrap-status">0 capturas</div>
            <div class="row2">
              <button class="secondary" data-act="scrap-toggle">Activar inspector</button>
              <button class="secondary" data-act="scrap-export">📋 Exportar</button>
              <button class="secondary" data-act="scrap-clear">🗑 Limpiar</button>
            </div>
            <p class="hint">Hacé click en cualquier elemento de la página y agregale un comentario. Después usá <em>Exportar</em> para copiar todo al portapapeles y pegarlo en el chat.</p>
          </div>
        </details>
        <div class="log" data-fld="log">Listo.</div>
      </div>
    `;
    document.body.appendChild(panel);

    // Estilos extra para los botones nuevos.
    const extra = document.createElement('style');
    extra.textContent = `
      #siged-juicios-panel button.primary.alt{background:#059669}
      #siged-juicios-panel button.primary.alt:disabled{background:#4b5563}
      #siged-juicios-panel button.danger{background:#dc2626;color:#fff;border:0;padding:8px 12px;border-radius:6px;cursor:pointer;font-weight:600}
      #siged-juicios-panel button.secondary{background:#4b5563;color:#f9fafb;border:0;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px}
      #siged-juicios-panel label.check-row{display:flex;align-items:center;gap:6px;font-size:12px;color:#f9fafb;margin-top:2px;cursor:pointer}
      #siged-juicios-panel label.check-row input{margin:0}
      #siged-juicios-panel .legend{display:flex;flex-wrap:wrap;gap:4px;font-size:10px;background:#0f172a;padding:6px;border-radius:6px}
      #siged-juicios-panel .legend .ch{display:inline-flex;align-items:center;gap:3px;padding:2px 5px;border-radius:3px;color:#fff}
      #siged-juicios-panel details.scrap{background:#111827;border-radius:6px;padding:6px 8px;margin-top:6px;font-size:11px}
      #siged-juicios-panel details.scrap summary{cursor:pointer;color:#93c5fd;font-weight:600}
      #siged-juicios-panel details.scrap .scrap-body{padding-top:6px;display:flex;flex-direction:column;gap:6px}
      #siged-juicios-panel details.scrap .row2{display:flex;gap:4px;flex-wrap:wrap}
      #siged-juicios-panel details.scrap .row2 button{flex:1;min-width:60px}
      #siged-juicios-panel details.scrap p.hint{margin:4px 0 0;color:#9ca3af;font-size:10px;line-height:1.3}
      #siged-juicios-panel details.scrap.active summary::after{content:" · ACTIVO";color:#22c55e}
    `;
    panel.appendChild(extra);

    const log = (msg) => {
      const el = panel.querySelector('[data-fld="log"]');
      el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + el.textContent;
    };
    panelLog = log;

    // Debug toggle
    const dbgToggle = panel.querySelector('[data-fld="debug-toggle"]');
    const dbgLegend = panel.querySelector('[data-fld="debug-legend"]');
    if (dbgToggle) {
      dbgToggle.addEventListener('change', () => {
        if (dbgToggle.checked) {
          debugViz.activate();
          log('🐞 Debug visual: ON. Las marcas aparecen al procesar.');
          dbgLegend.hidden = false;
          dbgLegend.innerHTML = `
            <span class="ch" style="background:${debugViz.colors.period}">período</span>
            <span class="ch" style="background:${debugViz.colors.note}">nota usada</span>
            <span class="ch" style="background:${debugViz.colors.noteSkip}">descartada</span>
            <span class="ch" style="background:${debugViz.colors.rendCell}">R visible</span>
            <span class="ch" style="background:${debugViz.colors.califInput}">Rend input</span>
            <span class="ch" style="background:${debugViz.colors.juicioInput}">Juicio input</span>
            <span class="ch" style="background:${debugViz.colors.filled}">completado</span>
            <button class="secondary" data-act="debug-clear" style="margin-top:4px">🧹 Limpiar marcas</button>
          `;
        } else {
          debugViz.deactivate();
          log('🐞 Debug visual: OFF.');
          dbgLegend.hidden = true;
          dbgLegend.innerHTML = '';
        }
      });
    }

    refreshScrapStatus = () => {
      const s = panel.querySelector('[data-fld="scrap-status"]');
      if (s) s.textContent = `${scrap.captures.length} captura(s)`;
      const det = panel.querySelector('details.scrap');
      if (det) det.classList.toggle('active', scrap.active);
      const btn = panel.querySelector('[data-act="scrap-toggle"]');
      if (btn) btn.textContent = scrap.active ? 'Desactivar inspector' : 'Activar inspector';
    };
    refreshScrapStatus();

    const refreshStatus = () => {
      const s = panel.querySelector('[data-fld="cfg-status"]');
      if (CFG.apiKey) {
        const partes = [`Modelo: ${CFG.model}`, `Máx ${CFG.maxChars} chars`, '3ra persona'];
        if (CFG.compararConAnterior) partes.push('+ contraste con período anterior');
        s.textContent = partes.join(' · ');
      } else {
        s.innerHTML = 'Falta API key. Abrí el ícono de la extensión para configurarla.';
      }
    };

    let abortController = null;
    const setRunning = (running) => {
      panel.querySelector('[data-act="run"]').disabled = running;
      panel.querySelector('[data-act="run-all"]').disabled = running;
      panel.querySelector('[data-act="stop"]').hidden = !running;
    };

    panel.addEventListener('click', async (e) => {
      const act = e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'toggle') { panel.classList.toggle('collapsed'); return; }
      if (act === 'stop') {
        if (abortController) abortController.abort();
        return;
      }
      if (act === 'diag') {
        log('🔍 Diagnóstico de la pantalla actual:');
        dumpDiagnostic(log);
        log('   (HTML completo y GXState raw en F12 → Console)');
        return;
      }
      if (act === 'scrap-toggle') {
        if (scrap.active) scrapingDeactivate(); else scrapingActivate();
        refreshScrapStatus();
        return;
      }
      if (act === 'debug-clear') { debugViz.clear(); log('🐞 Marcas borradas.'); return; }
      if (act === 'scrap-export') { await scrapingExport(); return; }
      if (act === 'scrap-clear') { scrapingClear(); return; }
      if (act === 'run' || act === 'run-all') {
        await loadConfig();
        refreshStatus();
        if (!CFG.apiKey) { log('Falta API key. Configurala desde el ícono de la extensión.'); return; }

        if (act === 'run-all') {
          const ok = window.confirm(
            'Esto va a procesar TODOS los alumnos del grupo:\n' +
            '- generar Rend. y Juicio para cada uno con IA\n' +
            '- guardar automáticamente con "Guardar y siguiente"\n\n' +
            'Vas a poder detenerlo con el botón "Detener" en cualquier momento, ' +
            'pero los alumnos ya guardados quedan guardados en SIGED.\n\n' +
            '¿Continuar?'
          );
          if (!ok) return;
        }

        abortController = new AbortController();
        setRunning(true);
        try {
          if (act === 'run') {
            await procesarAlumnoActual(log, abortController.signal);
            log('Listo. Revisá la grilla y, si está OK, presioná "Guardar y siguiente" en SIGED.');
          } else {
            await procesarTodos(log, abortController.signal);
            log('— Fin del recorrido del grupo —');
          }
        } catch (err) {
          log(`✗ ${err.message || err}`);
        } finally {
          setRunning(false);
          abortController = null;
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
    // Solo el frame principal monta el panel; si SIGED usa iframes la grilla
    // está en este mismo top window (la captura de referencia así lo indica).
    if (window.top !== window.self) return;
    if (!document.body) {
      // body todavía no listo: reintentar.
      setTimeout(bootstrap, 200);
      return;
    }
    console.log('[SIGED Juicios] content.js cargado en', location.href);
    buildPanel();
    // MutationObserver por si la SPA reemplaza el DOM…
    try {
      const obs = new MutationObserver(() => {
        if (!document.getElementById('siged-juicios-panel')) buildPanel();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (_) { /* ignore */ }
    // …y un setInterval defensivo por si el observer muere o si el body se
    // reemplaza completo (pasa con algunos postbacks de GeneXus).
    setInterval(() => {
      if (!document.body) return;
      if (!document.getElementById('siged-juicios-panel')) buildPanel();
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
