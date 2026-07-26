// Página de opciones (pantalla completa). Guarda/lee chrome.storage.local.
// Reemplaza al popup como UI principal de configuración.

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
  modoGeneracion: 'ia',
  bancoJuicios: '',
  bancoPlataformaAddendum: 'No debe descuidar las entregas en plataforma.',
  bancoComponer: true,
  bancoConectoresContraste: 'Sin embargo\nNo obstante\nAun así',
  bancoConectoresRefuerzo: 'Asimismo\nAdemás\nA su vez',
  bancoNCAddendum: 'Ha quedado pendiente la entrega de varias tareas; se necesita contar con más evidencias de su trabajo para valorar mejor su proceso.',
  bancoEstructura: 'general',
  bancoOrales: '',
  bancoEscritas: '',
  bancoOtras: '',
  bancoRecomendaciones: '',
  bancoConectoresSecuencia: 'Asimismo\nPor su parte\nA su vez\nDel mismo modo',
  snModo: 'mencionar',
  snUmbral: 2,
  rubrica1: 'No entregó el trabajo o no presentó evidencia (ausencia de producción). Mencionar como entrega pendiente cuando corresponda.',
  rubrica24: 'Producciones insuficientes (notas menores a 5). Reconocer las dificultades pero adoptar tono CONSTRUCTIVO y POSITIVO: subrayar el margen de mejora y los aspectos puntuales a fortalecer; evitar etiquetas desmoralizantes.',
  rubrica56: 'Trabajo satisfactorio: cumple con lo solicitado.',
  rubrica78: 'Muy buen trabajo: se destaca en varios aspectos.',
  rubrica910: 'Trabajo destacado: producción de alta calidad.',
  plantillaActividades: '',
  plantillaConectores: 'Asimismo\nAdemás\nPor otra parte\nA su vez',
  plantilla1: 'No presentó evidencias de trabajo en {actividades}. Se espera que regularice las entregas pendientes.\nTiene pendiente la entrega de {actividad}. Es importante que retome el trabajo para poder valorar sus aprendizajes.',
  plantilla24: 'Participó de {actividades}, aunque sus producciones aún no alcanzan lo esperado. Con mayor dedicación puede mejorar la calidad de sus trabajos.\nRealizó {actividad} con dificultades. {conector}, se observa margen para fortalecer la comprensión de los contenidos trabajados.',
  plantilla56: 'Realizó {actividades} cumpliendo con lo solicitado. {conector}, puede animarse a profundizar sus producciones.\nAlcanzó un desempeño satisfactorio en {actividad}, cumpliendo con las consignas planteadas.',
  plantilla78: 'Muy buen desempeño en {actividades}. Demuestra compromiso y comprensión de los contenidos trabajados.\nRealizó {actividad} con muy buen nivel. {conector}, se destaca su constancia en las propuestas del período.',
  plantilla910: 'Se destaca por la excelente calidad de sus producciones en {actividades}. Demuestra dominio de los contenidos y gran compromiso.\nTrabajo destacado en {actividad}. Sus producciones reflejan dedicación, creatividad y comprensión profunda.',
};

const FIELDS = [
  'apiKey', 'model', 'maxChars', 'tone',
  'compararConAnterior',
  'rendUsarRango', 'rendMin', 'rendMax',
  'modoGeneracion', 'bancoJuicios', 'bancoPlataformaAddendum',
  'bancoComponer', 'bancoConectoresContraste', 'bancoConectoresRefuerzo', 'bancoNCAddendum',
  'bancoEstructura', 'bancoOrales', 'bancoEscritas', 'bancoOtras', 'bancoRecomendaciones',
  'bancoConectoresSecuencia', 'snModo', 'snUmbral',
  'rubrica1', 'rubrica24', 'rubrica56', 'rubrica78', 'rubrica910',
  'plantillaActividades', 'plantillaConectores',
  'plantilla1', 'plantilla24', 'plantilla56', 'plantilla78', 'plantilla910',
];

const PLANTILLA_BANDAS = ['plantilla1', 'plantilla24', 'plantilla56', 'plantilla78', 'plantilla910'];
const RUBRICA_CAMPOS = ['rubrica1', 'rubrica24', 'rubrica56', 'rubrica78', 'rubrica910'];

const PER_PROVIDER_KEYS = 'siged_provider_keys'; // { providerId: { apiKey, model } }
const BASES_KEY = 'siged_bases';                 // { nombre: { savedAt, cfg } }

const HINTS = {
  ia: 'Cada juicio se genera con la IA del proveedor seleccionado. Necesitás API key (pestaña «Proveedor de IA»).',
  banco: 'Solo se usan los juicios del banco. NO necesitás API key. Asegurate de cubrir todas las notas posibles.',
  plantilla: 'Los juicios se arman con tus frases + las actividades del período. NO necesitás API key. Configuralo en «Generador de plantillas».',
  mixto: 'Si la nota tiene juicios en el banco, se usa el banco; si no, se llama a la IA. Necesitás API key como respaldo.',
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Helpers de formulario (modoGeneracion son radios; el resto, inputs con id)
// ---------------------------------------------------------------------------
function setFieldValue(id, value) {
  if (id === 'modoGeneracion') {
    const radio = document.querySelector(`input[name="modoGeneracion"][value="${value}"]`)
      || document.querySelector('input[name="modoGeneracion"][value="ia"]');
    if (radio) radio.checked = true;
    return;
  }
  const el = $(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value == null ? '' : String(value);
}

function getFieldValue(id) {
  if (id === 'modoGeneracion') {
    const checked = document.querySelector('input[name="modoGeneracion"]:checked');
    return checked ? checked.value : 'ia';
  }
  const el = $(id);
  if (!el) return undefined;
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') {
    const n = parseFloat((el.value || '').replace(',', '.'));
    return Number.isNaN(n) ? 0 : n;
  }
  return (el.value || '').trim();
}

function showStatus(el, msg, cls) {
  el.textContent = msg;
  el.className = 'status ' + (cls || '');
  if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.className = 'status'; } }, 6000);
}

// ---------------------------------------------------------------------------
// Navegación por pestañas
// ---------------------------------------------------------------------------
function initTabs() {
  const nav = $('nav');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    const tab = btn.getAttribute('data-tab');
    for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    for (const s of document.querySelectorAll('section.tab')) {
      s.classList.toggle('visible', s.getAttribute('data-tab') === tab);
    }
    history.replaceState(null, '', '#' + tab);
  });
  // Deep-link: options.html#plantillas abre esa pestaña directo.
  const hash = (location.hash || '').slice(1);
  if (hash) {
    const btn = nav.querySelector(`button[data-tab="${hash}"]`);
    if (btn) btn.click();
  }
}

// ---------------------------------------------------------------------------
// Proveedores / modelos (igual que el popup viejo)
// ---------------------------------------------------------------------------
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
  const el = $('modoHint');
  if (el) el.textContent = HINTS[getFieldValue('modoGeneracion')] || '';
}

// ---------------------------------------------------------------------------
// Banco: parseo (mismo formato que content.js) + chips de cobertura
// ---------------------------------------------------------------------------
function parseBancoJuicios(text) {
  const map = new Map();
  if (!text) return map;
  let currentGrade = null;
  let currentList = [];
  const flush = () => {
    if (currentGrade !== null && currentList.length) {
      map.set(currentGrade, (map.get(currentGrade) || []).concat(currentList));
    }
    currentList = [];
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^nota\s+(\d{1,2})\b/i);
    if (m) { flush(); currentGrade = parseInt(m[1], 10); continue; }
    if (/^aclaraci[oó]n/i.test(line) || /^plataforma/i.test(line)) { flush(); currentGrade = null; continue; }
    if (currentGrade !== null && line.length > 5) currentList.push(line);
  }
  flush();
  return map;
}

// Chips de cobertura por nota para cualquier textarea con formato de banco.
const COVERAGE_MAP = [
  ['bancoJuicios', 'bancoCoverage'],
  ['bancoOrales', 'covOrales'],
  ['bancoEscritas', 'covEscritas'],
  ['bancoOtras', 'covOtras'],
  ['bancoRecomendaciones', 'covRecomendaciones'],
];

function renderCoverage(fieldId, contId) {
  const cont = $(contId);
  if (!cont) return;
  const bank = parseBancoJuicios(getFieldValue(fieldId));
  cont.innerHTML = '';
  if (![...bank.keys()].length) {
    cont.innerHTML = '<span class="chip">Banco vacío</span>';
    return;
  }
  for (let n = 1; n <= 10; n++) {
    const count = (bank.get(n) || []).length;
    const chip = document.createElement('span');
    chip.className = 'chip ' + (count ? 'ok' : 'miss');
    chip.textContent = count ? `Nota ${n} · ${count}` : `Nota ${n} · falta`;
    cont.appendChild(chip);
  }
}

function refreshBancoCoverage() {
  for (const [fieldId, contId] of COVERAGE_MAP) renderCoverage(fieldId, contId);
}

// ---------------------------------------------------------------------------
// Preview del generador de plantillas (misma lógica que content.js)
// ---------------------------------------------------------------------------
const parseLineas = (t) => String(t || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

function listaNatural(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
}

function generarEjemploPlantilla(banda, variante) {
  const templates = parseLineas(getFieldValue(banda));
  if (!templates.length) return null;
  let text = templates[variante % templates.length];
  const actividades = parseLineas(getFieldValue('plantillaActividades'));
  const conectores = parseLineas(getFieldValue('plantillaConectores'));
  const fallback = 'las actividades propuestas en el período';
  let ai = variante;
  let ci = variante;
  text = text.replace(/\{actividades\}/gi, () => actividades.length ? listaNatural(actividades) : fallback);
  text = text.replace(/\{actividad\}/gi, () => actividades.length ? actividades[(ai++) % actividades.length] : fallback);
  text = text.replace(/\{conector\}/gi, () => conectores.length ? conectores[(ci++) % conectores.length] : 'Además');
  text = text.replace(/\{nota\}/gi, '7');
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : null;
}

function previewPlantillas() {
  const cont = $('plantillaPreview');
  const nombres = { plantilla1: 'Nota 1', plantilla24: 'Notas 2-4', plantilla56: 'Notas 5-6', plantilla78: 'Notas 7-8', plantilla910: 'Notas 9-10' };
  cont.innerHTML = '';
  let alguno = false;
  for (const banda of PLANTILLA_BANDAS) {
    const variantes = parseLineas(getFieldValue(banda)).length;
    for (let v = 0; v < Math.min(variantes, 2); v++) {
      const txt = generarEjemploPlantilla(banda, v);
      if (!txt) continue;
      alguno = true;
      const div = document.createElement('div');
      div.className = 'pv-item';
      const b = document.createElement('span');
      b.className = 'pv-nota';
      b.textContent = nombres[banda] + (variantes > 1 ? ` (var. ${v + 1})` : '');
      div.appendChild(b);
      div.appendChild(document.createTextNode(txt));
      cont.appendChild(div);
    }
  }
  if (!alguno) cont.innerHTML = '<span class="hint">No hay frases configuradas todavía.</span>';
  cont.hidden = false;
}

// ---------------------------------------------------------------------------
// Asistente de prompts (sin API): genera texto para pegar en una IA gratuita
// y parsea la respuesta para cargarla en la config.
// ---------------------------------------------------------------------------
function contextoComun() {
  const asig = getFieldValue('promptAsignatura');
  const nivel = getFieldValue('promptNivel');
  const acts = parseLineas(getFieldValue('promptActividades'));
  const contenidos = parseLineas(getFieldValue('promptContenidos'));
  const criterios = parseLineas(getFieldValue('promptCriterios'));
  const lines = [
    'Sos un docente uruguayo con experiencia redactando juicios de evaluación para boletines escolares (SIGED).',
    `Contexto: asignatura «${asig || 'la asignatura'}»${nivel ? `, nivel «${nivel}»` : ''}.`,
  ];
  if (contenidos.length) lines.push('Contenidos dictados en el período: ' + contenidos.join('; ') + '.');
  if (criterios.length) lines.push('Lo que el/la docente quiere evaluar (criterios de logro): ' + criterios.join('; ') + '.');
  if (acts.length) lines.push('Actividades realizadas en el período: ' + acts.join('; ') + '.');
  lines.push(
    'Reglas de redacción OBLIGATORIAS:',
    '- Siempre en TERCERA PERSONA («demuestra», «logra», «presenta dificultades»). Nunca «vos», «tú» ni «usted».',
    '- NUNCA mencionar el nombre del/la estudiante.',
    '- Español rioplatense, profesional, sin emojis ni exclamaciones.',
    `- Cada juicio de máximo ${getFieldValue('maxChars') || 280} caracteres (una o dos oraciones).`,
    '- Para notas insuficientes (2 a 4): tono constructivo y positivo, centrado en el margen de mejora.',
    '- La nota 1 significa ausencia o no entrega (no confundir con insuficiencia).',
  );
  return lines;
}

// Estilo institucional de los juicios (orientaciones MCN de Ed. Secundaria):
// descriptivos, en clave de proceso, con niveles de avance y cierre con
// sugerencias de superación.
const ESTILO_MCN = [
  'ESTILO OBLIGATORIO de los juicios (formato institucional MCN):',
  '- Descriptivos y en clave de PROCESO: qué procesos cognitivos, desempeños y aprendizajes evidencia, y qué competencias desarrolla (especificando cuáles).',
  '- Usar niveles de avance (destacado, significativo, moderado, escaso, mínimo), siempre en relación con el propio punto de partida del/la estudiante.',
  '- Reconocer avances y señalar oportunidades de superación en tono constructivo.',
  '- PROHIBIDO: hablar de «rendimiento», «aceptable / no aceptable», «satisfactorio», «buen alumno», describir solo resultados, o mencionar competencias sin especificar cuáles.',
  '- Sin etiquetas ni diagnósticos («déficit atencional», «preste atención»); sin lenguaje coloquial; tercera persona singular; ortografía y puntuación impecables.',
];

function reglasFrasesEncadenables() {
  return [
    'IMPORTANTE — la extensión CONCATENA las frases automáticamente, por eso cada frase debe:',
    '- ser UNA oración completa y autónoma, en tercera persona singular;',
    '- leer bien tanto al inicio del juicio como después de un conector seguido de coma (se le baja la mayúscula inicial automáticamente);',
    '- NO empezar con conectores (sin embargo, además, por otra parte, etc.) ni referirse a otra oración;',
    '- NO mencionar la nota numérica ni la palabra «nota»;',
    '- variar los inicios entre las variantes de una misma nota (que no empiecen todas con el mismo verbo) y usar verbos de desempeño precisos (identifica, explica, argumenta, elabora, transfiere, produce);',
    '- redacción fluida y natural, con sintaxis impecable en español rioplatense formal: concordancias correctas, sin muletillas ni frases telegráficas, y cada frase cerrada con punto;',
    '- opcionalmente puede incluir los placeholders literales {actividad} (una actividad puntual) o {actividades} (todas enumeradas).',
  ];
}

function buildPrompt() {
  const tipo = getFieldValue('promptTipo');
  const variantes = Math.max(1, Math.min(10, getFieldValue('promptVariantes') || 3));
  const lines = contextoComun();
  if (tipo === 'secuencia') {
    const orales = getFieldValue('promptOrales');
    const escritas = getFieldValue('promptEscritas');
    const otras = getFieldValue('promptOtras');
    lines.push(
      '',
      'La libreta tiene tres ítems con notas del 1 al 10: «Orales», «Escritas» y «Otras actuaciones (O. Act.)».',
      `En este período, «Orales» evaluó: ${orales || 'participación en clase, aportes e intercambios orales'}.`,
      `«Escritas» evaluó: ${escritas || 'producciones y evaluaciones escritas'}.`,
      `«Otras actuaciones» evaluó: ${otras || 'tareas, proyectos, actitudes y trabajo en clase'}.`,
      '',
      'TAREA (dos pasos):',
      'PASO 1 — CRITERIOS: a partir de los contenidos dictados y de lo que se quiere evaluar, definí (para vos, sin escribirlo en la salida) qué demuestra un/a estudiante en cada ítem para cada nivel: nota 1 (ausencia / no entrega), 2 a 4 (en proceso), 5 a 6 (avance moderado), 7 a 8 (avance significativo), 9 a 10 (avance destacado).',
      `PASO 2 — BANCOS: escribí, para CADA uno de los tres ítems, un banco de frases para TODAS las notas del 1 al 10 con ${Math.max(3, variantes)} variantes por nota, donde cada frase hable del desempeño en ESE ítem (lo oral en Orales, lo escrito en Escritas, tareas/actitudes en O. Act.), graduada según el criterio del nivel. Escribí además un cuarto banco de RECOMENDACIONES para las notas 1 a 10 (${Math.max(3, variantes)} variantes por nota): una sugerencia u oportunidad de superación que CIERRA el juicio («Continúe trabajando…», «Se sugiere que…», «Es preciso que…», «Confíe en su potencial y…»), acorde al nivel del promedio.`,
      '',
      ...ESTILO_MCN,
      '',
      ...reglasFrasesEncadenables(),
      '',
      'FORMATO DE SALIDA (exacto, texto plano, sin markdown, sin numeración, sin comillas):',
      'ORALES',
      'Nota 1',
      '<frase variante 1>',
      '<frase variante 2>',
      '…',
      'Nota 2',
      '…',
      '(y así hasta Nota 10)',
      'ESCRITAS',
      'Nota 1',
      '…',
      '(y así hasta Nota 10)',
      'OTRAS',
      'Nota 1',
      '…',
      '(y así hasta Nota 10)',
      'RECOMENDACIONES',
      'Nota 1',
      '…',
      '(y así hasta Nota 10)',
      'No agregues ningún texto antes ni después.',
    );
    return lines.join('\n');
  }
  if (tipo === 'logro') {
    lines.push(
      '',
      'TAREA (dos pasos):',
      'PASO 1 — RÚBRICA: a partir de los contenidos dictados y de lo que el/la docente quiere evaluar, definí el CRITERIO DE LOGRO de cada banda de notas: qué demuestra concretamente un/a estudiante de esa banda respecto de esos contenidos y criterios. Bandas: nota 1 (ausencia / no entrega), 2 a 4 (en proceso, con margen de mejora), 5 a 6 (satisfactorio), 7 a 8 (muy bueno), 9 a 10 (destacado).',
      `PASO 2 — BANCO: escribí un banco de juicios para TODAS las notas del 1 al 10, con ${variantes} variantes distintas por nota, donde cada frase refleje el criterio de logro de su banda aplicado a los contenidos dictados (graduá dentro de la banda: un 4 muestra más avance que un 2, un 10 más que un 9).`,
      '',
      'La extensión COMPONE el juicio automáticamente según la distribución de notas del/la estudiante: elige una frase por su nota más frecuente y, si el desempeño es dispar, encadena una segunda frase de otra banda unida con un conector («Sin embargo, …», «Asimismo, …»).',
      '',
      ...ESTILO_MCN,
      '- Nombrar contenidos o desempeños concretos, no generalidades.',
      '',
      ...reglasFrasesEncadenables(),
      '',
      'FORMATO DE SALIDA (exacto, texto plano, sin markdown, sin numeración, sin comillas):',
      'RUBRICA',
      'Nota 1: <criterio de logro>',
      'Notas 2 a 4: <criterio de logro>',
      'Notas 5 a 6: <criterio de logro>',
      'Notas 7 a 8: <criterio de logro>',
      'Notas 9 a 10: <criterio de logro>',
      'BANCO',
      'Nota 1',
      '<frase variante 1>',
      '<frase variante 2>',
      '…',
      'Nota 2',
      '<frase variante 1>',
      '…',
      '(y así hasta Nota 10)',
      'No agregues ningún texto antes ni después.',
    );
    return lines.join('\n');
  }
  if (tipo === 'banco') {
    lines.push(
      '',
      `TAREA: escribí un banco de juicios para TODAS las notas del 1 al 10, con ${variantes} variantes distintas por nota (así no se repiten entre alumnos).`,
      'CALIDAD DE REDACCIÓN: cada frase debe ser UNA oración completa y autónoma en tercera persona, con sintaxis impecable en español rioplatense formal. La extensión puede encadenar dos frases con un conector («Sin embargo, …», «Asimismo, …»), así que ninguna frase debe empezar con conectores ni referirse a otra oración, y todas deben leer bien tanto al inicio del juicio como después de un conector. Variá los inicios entre variantes, no menciones la nota numérica y cerrá cada frase con punto.',
      'FORMATO DE SALIDA (exacto, texto plano, sin markdown, sin numeración, sin comillas):',
      'Nota 1',
      '<juicio variante 1>',
      '<juicio variante 2>',
      '…',
      'Nota 2',
      '<juicio variante 1>',
      '…',
      '(y así hasta Nota 10)',
      'No agregues ningún texto antes ni después del banco.',
    );
  } else if (tipo === 'rubrica') {
    lines.push(
      '',
      'TAREA: escribí descripciones de rúbrica (qué significa cada rango de notas) para esta asignatura. Son instrucciones para interpretar notas, no juicios.',
      'FORMATO DE SALIDA (exacto, texto plano, sin markdown):',
      'Nota 1: <descripción>',
      'Notas 2 a 4: <descripción>',
      'Notas 5 a 6: <descripción>',
      'Notas 7 a 8: <descripción>',
      'Notas 9 a 10: <descripción>',
      'No agregues ningún texto antes ni después.',
    );
  } else {
    lines.push(
      '',
      `TAREA: escribí ${variantes} frases-plantilla por banda de nota para un generador automático de juicios. Cada frase debe incluir al menos uno de estos placeholders literales: {actividad} (una actividad puntual), {actividades} (todas las actividades enumeradas) o {conector} (conector al inicio de una segunda oración, va seguido de coma).`,
      'FORMATO DE SALIDA (exacto, texto plano, sin markdown, sin numeración):',
      'Banda 1',
      '<frase variante 1>',
      '…',
      'Banda 2-4',
      '…',
      'Banda 5-6',
      '…',
      'Banda 7-8',
      '…',
      'Banda 9-10',
      '…',
      'No agregues ningún texto antes ni después.',
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Limpieza de respuestas de IA pegadas: quita markdown (títulos, negritas,
// viñetas) y descarta líneas de "charla" del chatbot (cierres tipo «Espero que
// te resulten útiles», preguntas al usuario) que no son frases de banco. Se
// aplica ANTES de parsear y también a lo que se guarda, así el parser estricto
// de content.js encuentra las líneas «Nota N» aunque la IA haya usado markdown.
const CHARLA_IA_RE = /(espero que|te (resulten|sirvan|sean [uú]tiles|ayuden)|me avis[aá]s|avisame|av[ií]same|h[aá]zmelo saber|hazme saber|si (necesit[aá]s|quer[eé]s|precis[aá]s|dese[aá]s)|¡?[eé]xitos|suerte con|aqu[ií] (tienes|ten[eé]s)|a continuaci[oó]n)/i;

function limpiarLineaIA(raw) {
  return String(raw)
    .replace(/^[\s>]*[*#-]+\s*/, '') // viñetas y títulos markdown
    .replace(/[*`]/g, '')            // negritas / itálicas / código
    .replace(/__/g, '')
    .trimEnd();
}

function limpiarRespuestaIA(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .map(limpiarLineaIA)
    .filter((l) => !CHARLA_IA_RE.test(l) && !/\?\s*$/.test(l))
    .join('\n');
}

// Parsea líneas «Nota 1: …» / «Notas 2 a 4: …» y las carga en los campos de
// la rúbrica. Devuelve cuántas bandas reconoció.
function parsearRubricaEnCampos(texto) {
  const patrones = [
    [/^nota\s*1\s*[:\-–]\s*(.+)$/i, 'rubrica1'],
    [/^notas?\s*2\s*(?:a|-|–)\s*4\s*[:\-–]\s*(.+)$/i, 'rubrica24'],
    [/^notas?\s*5\s*(?:a|-|–)\s*6\s*[:\-–]\s*(.+)$/i, 'rubrica56'],
    [/^notas?\s*7\s*(?:a|-|–)\s*8\s*[:\-–]\s*(.+)$/i, 'rubrica78'],
    [/^notas?\s*9\s*(?:a|-|–)\s*10\s*[:\-–]\s*(.+)$/i, 'rubrica910'],
  ];
  let cargadas = 0;
  for (const raw of texto.split(/\r?\n/)) {
    const line = raw.replace(/^[*#\s>-]+/, '').trim();
    for (const [re, campo] of patrones) {
      const m = line.match(re);
      if (m) { setFieldValue(campo, m[1].trim()); cargadas++; break; }
    }
  }
  return cargadas;
}

function aplicarRespuesta() {
  const tipo = getFieldValue('promptTipo');
  const texto = limpiarRespuestaIA(getFieldValue('respuestaIA'));
  const st = $('respuestaStatus');
  if (!texto.trim()) { showStatus(st, '⚠ Pegá primero la respuesta de la IA.', 'err'); return; }

  if (tipo === 'secuencia') {
    // La respuesta trae cuatro secciones (ORALES, ESCRITAS, OTRAS y
    // RECOMENDACIONES), cada una con bloques «Nota N».
    const secciones = { orales: [], escritas: [], otras: [], recomendaciones: [] };
    const headers = [
      [/^orales?$/i, 'orales'],
      [/^escrit[ao]s?$/i, 'escritas'],
      [/^(otras(\s+actuaciones)?|o\.?\s*act(uaciones)?\.?)$/i, 'otras'],
      [/^recomendaci[oó]n(es)?(\s+finales?)?$/i, 'recomendaciones'],
    ];
    let actual = null;
    for (const raw of texto.split(/\r?\n/)) {
      // Para detectar headers toleramos decoraciones, dos puntos y paréntesis
      // finales: «ORALES:», «OTRAS ACTUACIONES (O. ACT.)», «Recomendaciones
      // finales», etc.
      const limpia = raw.replace(/^[*#>\s=-]+/, '').replace(/[*#\s=-]+$/, '')
        .replace(/\s*\([^)]*\)\s*$/, '').replace(/[:.\s]+$/, '').trim();
      const header = headers.find(([re]) => re.test(limpia));
      if (header) { actual = header[1]; continue; }
      // Línea corta toda en mayúsculas que no es «Nota N»: un encabezado que
      // no reconocemos. Cortamos la sección para no contaminar el banco
      // anterior con frases ajenas (el faltante se reporta en el estado).
      if (limpia && limpia.length <= 40 && !/\d/.test(limpia)
          && limpia === limpia.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(limpia)) {
        actual = null;
        continue;
      }
      if (actual) secciones[actual].push(raw);
    }
    const campos = { orales: 'bancoOrales', escritas: 'bancoEscritas', otras: 'bancoOtras', recomendaciones: 'bancoRecomendaciones' };
    const resumen = [];
    const problemas = [];
    let algo = false;
    for (const [sec, campo] of Object.entries(campos)) {
      const cuerpo = secciones[sec].join('\n').trim();
      const bank = parseBancoJuicios(cuerpo);
      const notas = [...bank.keys()];
      if (!notas.length) { problemas.push(`la sección ${sec.toUpperCase()} está vacía o sin líneas «Nota N»`); continue; }
      setFieldValue(campo, cuerpo);
      algo = true;
      const faltan = [];
      for (let n = 1; n <= 10; n++) if (!bank.has(n)) faltan.push(n);
      resumen.push(`${sec} ${notas.length}/10`);
      if (faltan.length) problemas.push(`en ${sec} faltan las notas ${faltan.join(', ')}`);
    }
    if (!algo) {
      showStatus(st, '⚠ No encontré las secciones ORALES / ESCRITAS / OTRAS / RECOMENDACIONES. Revisá que la IA haya respetado el formato.', 'err');
      return;
    }
    setFieldValue('bancoEstructura', 'categorias');
    refreshBancoCoverage();
    showStatus(st, `✓ Bancos cargados (${resumen.join(' · ')}) y estructura «Secuencia por ítem» activada.${problemas.length ? ' ⚠ ' + problemas.join('; ') + '.' : ''} Revisá la pestaña Banco y apretá «Guardar configuración».`, problemas.length ? 'err' : 'ok');
    return;
  }

  if (tipo === 'logro') {
    // La respuesta trae dos secciones: RUBRICA y BANCO, separadas por una
    // línea «BANCO».
    const partes = texto.split(/^[#*=>\s-]*banco[\s=:-]*$/im);
    if (partes.length < 2) {
      showStatus(st, '⚠ No encontré la línea «BANCO» que separa la rúbrica del banco. Revisá que la IA haya respetado el formato.', 'err');
      return;
    }
    const cargadas = parsearRubricaEnCampos(partes[0]);
    const bancoTxt = partes.slice(1).join('\n').trim();
    const bank = parseBancoJuicios(bancoTxt);
    const notas = [...bank.keys()].sort((a, b) => a - b);
    if (!notas.length) {
      showStatus(st, '⚠ En la sección BANCO no encontré líneas «Nota N». Revisá el formato.', 'err');
      return;
    }
    setFieldValue('bancoJuicios', bancoTxt);
    refreshBancoCoverage();
    const faltan = [];
    for (let n = 1; n <= 10; n++) if (!bank.has(n)) faltan.push(n);
    const problemas = [];
    if (cargadas < 5) problemas.push(`solo reconocí ${cargadas} de 5 bandas de la rúbrica`);
    if (faltan.length) problemas.push(`faltan las notas ${faltan.join(', ')} en el banco`);
    showStatus(st, `✓ Rúbrica (${cargadas} bandas) y banco (notas ${notas.join(', ')}) cargados.${problemas.length ? ' ⚠ ' + problemas.join('; ') + '.' : ''} Revisá las pestañas Rúbrica y Banco y apretá «Guardar configuración».`, problemas.length ? 'err' : 'ok');
    return;
  }

  if (tipo === 'banco') {
    const bank = parseBancoJuicios(texto);
    const notas = [...bank.keys()].sort((a, b) => a - b);
    if (!notas.length) {
      showStatus(st, '⚠ No encontré líneas «Nota N». Revisá que la IA haya respetado el formato.', 'err');
      return;
    }
    setFieldValue('bancoJuicios', texto);
    refreshBancoCoverage();
    const faltan = [];
    for (let n = 1; n <= 10; n++) if (!bank.has(n)) faltan.push(n);
    showStatus(st, `✓ Banco cargado (notas ${notas.join(', ')}).${faltan.length ? ` Faltan: ${faltan.join(', ')}.` : ''} Revisá la pestaña Banco y apretá «Guardar configuración».`, faltan.length ? 'err' : 'ok');
    return;
  }

  if (tipo === 'rubrica') {
    const cargadas = parsearRubricaEnCampos(texto);
    if (!cargadas) {
      showStatus(st, '⚠ No encontré líneas «Nota 1: …» / «Notas 2 a 4: …». Revisá el formato.', 'err');
    } else {
      showStatus(st, `✓ ${cargadas} descripción(es) cargadas en la pestaña Rúbrica. Revisalas y apretá «Guardar configuración».`, 'ok');
    }
    return;
  }

  // plantillas
  const bandas = { '1': 'plantilla1', '2-4': 'plantilla24', '5-6': 'plantilla56', '7-8': 'plantilla78', '9-10': 'plantilla910' };
  const acumulado = {};
  let actual = null;
  for (const raw of texto.split(/\r?\n/)) {
    const line = raw.replace(/^[*#\s>-]+/, '').trim();
    if (!line) continue;
    const m = line.match(/^banda\s*(\d{1,2}(?:\s*(?:a|-|–)\s*\d{1,2})?)/i);
    if (m) {
      const key = m[1].replace(/\s*(?:a|–)\s*/gi, '-').replace(/\s+/g, '');
      actual = bandas[key] || null;
      continue;
    }
    if (actual && line.length > 5) (acumulado[actual] = acumulado[actual] || []).push(line);
  }
  const cargadas = Object.keys(acumulado);
  if (!cargadas.length) {
    showStatus(st, '⚠ No encontré encabezados «Banda 1», «Banda 2-4», etc. Revisá el formato.', 'err');
    return;
  }
  for (const campo of cargadas) setFieldValue(campo, acumulado[campo].join('\n'));
  showStatus(st, `✓ Frases cargadas en ${cargadas.length} banda(s) del Generador de plantillas. Revisalas y apretá «Guardar configuración».`, 'ok');
}

// ---------------------------------------------------------------------------
// Mis bases: perfiles con nombre + export/import
// ---------------------------------------------------------------------------
function snapshotActual() {
  const cfg = {};
  for (const k of FIELDS) {
    if (k === 'apiKey') continue; // nunca guardamos la key en una base
    cfg[k] = getFieldValue(k);
  }
  cfg.provider = $('provider').value;
  return cfg;
}

async function getBases() {
  return (await chrome.storage.local.get(BASES_KEY))[BASES_KEY] || {};
}

async function renderBases() {
  const bases = await getBases();
  const cont = $('listaBases');
  const nombres = Object.keys(bases).sort();
  if (!nombres.length) {
    cont.innerHTML = '<p class="hint">Todavía no guardaste ninguna base.</p>';
    return;
  }
  cont.innerHTML = '';
  for (const nombre of nombres) {
    const item = document.createElement('div');
    item.className = 'base-item';
    const fecha = bases[nombre].savedAt ? new Date(bases[nombre].savedAt).toLocaleDateString('es-UY') : '';
    const modo = (bases[nombre].cfg || {}).modoGeneracion || '';
    item.innerHTML = `
      <span class="bname"></span>
      <span class="bmeta">${modo ? 'modo ' + modo : ''}${fecha ? ' · ' + fecha : ''}</span>
      <button class="btn secondary small" data-load>Cargar</button>
      <button class="btn danger small" data-del>Borrar</button>`;
    item.querySelector('.bname').textContent = nombre;
    item.querySelector('[data-load]').addEventListener('click', async () => {
      const cfg = bases[nombre].cfg || {};
      populateProviders(cfg.provider || DEFAULTS.provider);
      populateModels($('provider').value, cfg.model);
      refreshProviderHelp($('provider').value);
      for (const k of FIELDS) {
        if (k === 'apiKey') continue;
        if (k in cfg) setFieldValue(k, cfg[k]);
      }
      refreshModoHint();
      refreshBancoCoverage();
      showStatus($('basesStatus'), `✓ Base «${nombre}» cargada en el formulario. Apretá «Guardar configuración» para activarla.`, 'ok');
    });
    item.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`¿Borrar la base «${nombre}»?`)) return;
      const b = await getBases();
      delete b[nombre];
      await chrome.storage.local.set({ [BASES_KEY]: b });
      await renderBases();
      showStatus($('basesStatus'), `Base «${nombre}» borrada.`, 'ok');
    });
    cont.appendChild(item);
  }
}

async function guardarBase() {
  const nombre = getFieldValue('baseNombre');
  const st = $('basesStatus');
  if (!nombre) { showStatus(st, '⚠ Poné un nombre para la base.', 'err'); return; }
  const bases = await getBases();
  if (bases[nombre] && !confirm(`Ya existe una base «${nombre}». ¿Sobrescribirla?`)) return;
  bases[nombre] = { savedAt: Date.now(), cfg: snapshotActual() };
  await chrome.storage.local.set({ [BASES_KEY]: bases });
  setFieldValue('baseNombre', '');
  await renderBases();
  showStatus(st, `✓ Base «${nombre}» guardada.`, 'ok');
}

async function exportarBases() {
  const data = {
    tipo: 'siged-juicios-config',
    version: 1,
    exportadoEl: new Date().toISOString(),
    config: snapshotActual(),
    bases: await getBases(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'siged-juicios-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showStatus($('basesStatus'), '✓ Archivo exportado (sin API keys).', 'ok');
}

async function importarBases(file) {
  const st = $('basesStatus');
  try {
    const data = JSON.parse(await file.text());
    if (data.tipo !== 'siged-juicios-config') throw new Error('formato');
    if (data.bases && typeof data.bases === 'object') {
      const actuales = await getBases();
      await chrome.storage.local.set({ [BASES_KEY]: { ...actuales, ...data.bases } });
      await renderBases();
    }
    if (data.config && typeof data.config === 'object') {
      for (const k of FIELDS) {
        if (k === 'apiKey') continue;
        if (k in data.config) setFieldValue(k, data.config[k]);
      }
      refreshModoHint();
      refreshBancoCoverage();
    }
    showStatus(st, '✓ Importado. Revisá el formulario y apretá «Guardar configuración».', 'ok');
  } catch (_) {
    showStatus(st, '⚠ El archivo no parece un export válido de esta extensión.', 'err');
  }
}

// ---------------------------------------------------------------------------
// Cargar / guardar configuración principal
// ---------------------------------------------------------------------------
async function load() {
  const stored = await chrome.storage.local.get(null);
  const cfg = Object.assign({}, DEFAULTS, stored);
  if (!['ia', 'banco', 'plantilla', 'mixto'].includes(cfg.modoGeneracion)) {
    if (cfg.usarBanco) cfg.modoGeneracion = cfg.bancoFallbackIA === false ? 'banco' : 'mixto';
    else cfg.modoGeneracion = 'ia';
  }

  populateProviders(cfg.provider || DEFAULTS.provider);
  const perProvider = stored[PER_PROVIDER_KEYS] || {};
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
  refreshBancoCoverage();
  await renderBases();
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
  cfg.snUmbral = Math.max(1, Math.min(20, cfg.snUmbral || DEFAULTS.snUmbral));
  const st = $('status');
  if (cfg.rendMin >= cfg.rendMax && cfg.rendUsarRango) {
    cfg.rendUsarRango = false;
    showStatus(st, '⚠ Rango Rend inválido (min ≥ max). Lo deshabilité.', 'err');
  }
  for (const k of RUBRICA_CAMPOS) if (!cfg[k]) cfg[k] = DEFAULTS[k];
  await chrome.storage.local.set(cfg);

  const stored = (await chrome.storage.local.get(PER_PROVIDER_KEYS))[PER_PROVIDER_KEYS] || {};
  stored[providerId] = { apiKey: cfg.apiKey, model: cfg.model };
  await chrome.storage.local.set({ [PER_PROVIDER_KEYS]: stored });

  const modo = cfg.modoGeneracion || 'ia';
  const necesitaIA = modo === 'ia' || modo === 'mixto';
  const tieneBanco = !!(cfg.bancoJuicios || '').trim()
    || (cfg.bancoEstructura === 'categorias'
        && ['bancoOrales', 'bancoEscritas', 'bancoOtras'].some((k) => !!(cfg[k] || '').trim()));
  const tienePlantillas = PLANTILLA_BANDAS.some((k) => !!(cfg[k] || '').trim());
  const faltaIA = necesitaIA && !cfg.apiKey;
  const faltaBanco = (modo === 'banco' || modo === 'mixto') && !tieneBanco;
  const faltaPlantillas = modo === 'plantilla' && !tienePlantillas;
  if (faltaIA && faltaBanco) showStatus(st, '⚠ Guardado, pero faltan API key y banco.', 'err');
  else if (modo === 'ia' && faltaIA) showStatus(st, `⚠ Modo IA: falta la API key de ${SIGED_PROVIDERS[providerId].label}.`, 'err');
  else if (modo === 'banco' && faltaBanco) showStatus(st, '⚠ Modo banco: el banco está vacío.', 'err');
  else if (faltaPlantillas) showStatus(st, '⚠ Modo plantillas: no hay frases configuradas.', 'err');
  else {
    const desc = modo === 'ia' ? `IA (${SIGED_PROVIDERS[providerId].label})`
      : modo === 'banco' ? 'Banco (sin IA)'
      : modo === 'plantilla' ? 'Plantillas (sin IA)'
      : `Mixto (banco + ${SIGED_PROVIDERS[providerId].label})`;
    showStatus(st, `✓ Configuración guardada · ${desc}`, 'ok');
  }
}

async function reset() {
  if (!confirm('¿Restaurar todos los valores por defecto? (No borra tus bases guardadas ni las API keys por proveedor.)')) return;
  await chrome.storage.local.set(DEFAULTS);
  await load();
  showStatus($('status'), 'Valores restaurados a los defaults.', 'ok');
}

// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
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

  for (const radio of document.querySelectorAll('input[name="modoGeneracion"]')) {
    radio.addEventListener('change', refreshModoHint);
  }

  for (const [fieldId, contId] of COVERAGE_MAP) {
    const el = $(fieldId);
    if (el) el.addEventListener('input', () => renderCoverage(fieldId, contId));
  }
  $('previewPlantillas').addEventListener('click', previewPlantillas);

  $('generarPrompt').addEventListener('click', () => {
    $('promptResultado').value = buildPrompt();
    showStatus($('promptStatus'), '✓ Prompt generado. Copialo y pegalo en tu IA preferida.', 'ok');
  });
  $('copiarPrompt').addEventListener('click', async () => {
    const txt = $('promptResultado').value;
    if (!txt) { showStatus($('promptStatus'), '⚠ Generá el prompt primero.', 'err'); return; }
    await navigator.clipboard.writeText(txt);
    showStatus($('promptStatus'), '✓ Copiado al portapapeles.', 'ok');
  });
  $('aplicarRespuesta').addEventListener('click', aplicarRespuesta);

  $('guardarBase').addEventListener('click', guardarBase);
  $('exportarBases').addEventListener('click', exportarBases);
  $('importarBases').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importarBases(f);
    e.target.value = '';
  });
});
