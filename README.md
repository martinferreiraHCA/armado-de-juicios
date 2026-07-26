# SIGED · Armado de juicios con IA

Extensión de Chrome (Manifest V3) que automatiza el cierre de promedios y la
redacción de juicios en SIGED (`*.siged.com.uy`) usando la API de Claude.

Sobre la pantalla **Libreta @ → Cerrar Prom. por Alumno**, agrega un panel
flotante que lee las notas del período habilitado, calcula el rendimiento
numérico y genera el juicio de la asignatura llamando a Claude. Puede
procesar un alumno a la vez o iterar automáticamente hasta el último alumno
del grupo.

## Instalación (Chrome / Edge / Brave)

1. Cloná o descargá este repo.
   ```
   git clone https://github.com/martinferreiraHCA/armado-de-juicios.git
   ```
2. Abrí `chrome://extensions` (o `edge://extensions`, `brave://extensions`).
3. Activá **Modo de desarrollador** (arriba a la derecha).
4. **Cargar descomprimida** → seleccioná la carpeta del repo.
5. La extensión queda activa solo en `https://*.siged.com.uy/*`.

## Configuración

Click en el ícono de la extensión → **⚙️ Abrir configuración completa**.
Se abre una página de opciones a pantalla completa con pestañas:

- **🎛️ Modo de generación** — cómo se redactan los juicios:
  - **📝 Plantillas (sin IA)**: redacción natural armada con tus propias
    frases y las actividades del período. Gratis, sin API key.
  - **🗂️ Banco de juicios**: juicios ya escritos por vos, uno por nota.
    Gratis, sin API key.
  - **🤖 Solo IA**: cada juicio lo redacta el proveedor elegido
    (necesita API key).
  - **🔀 Mixto**: banco si la nota está, IA como respaldo.
- **📝 Generador de plantillas** — actividades del período + frases por
  banda de nota con sintaxis configurable. Placeholders: `{actividad}`
  (una actividad, rota entre alumnos), `{actividades}` (todas enumeradas
  como «X, Y y Z»), `{conector}` (rota entre conectores) y `{nota}`.
  Botón «Ver ejemplos generados» para previsualizar.
- **🗂️ Banco de juicios** — con chips de cobertura por nota (verde = tiene
  variantes, rojo = falta) y dos estructuras:
  - **Secuencia por ítem** (Orales → Escritas → O. Act.): cada columna de
    la libreta con notas aporta una frase de su propio banco según el
    promedio de ese ítem; las frases se encadenan con conectores elegidos
    por cómo evoluciona el nivel entre ítems (baja → contraste «Sin
    embargo, …»; sube → refuerzo «Asimismo, …»; se mantiene → secuencia
    «Por su parte, …»). Un ítem sin notas se omite. El juicio cierra con
    la aclaración de S/N (configurable: mencionar si se llega a un umbral
    —por defecto 2 celdas sin nota—, u omitir) y una **recomendación
    final** elegida según el promedio general del período.
  - **Banco general** con **composición según la distribución de notas**:
    cuenta cuántas notas de cada valor (1 a 10) tiene el período y
    concatena frases del banco con conectores. La nota principal es la más
    repetida (moda; empate → la más cercana al promedio); si otra banda
    (2-4, 5-6, 7-8, 9-10) concentra al menos 2 notas o el 25% del total se
    agrega una frase secundaria unida con conector de contraste o refuerzo.
  Las ausencias (nota 1) se cubren con el adendum de entregas pendientes;
  las celdas S/N o N/C se cuentan y disparan la aclaración configurada.
  Las frases de todos los bancos admiten los mismos placeholders que las
  plantillas.
- **✨ Asistente de prompts (sin API)** — genera un prompt listo para pegar
  en cualquier IA gratuita (ChatGPT, Gemini, Claude web…) que produce el
  banco completo, la rúbrica o las frases de plantillas; pegás la respuesta
  de vuelta y se carga sola en la configuración. Sin API key ni costos.
  El modo **«Secuencia por ítem»** parte de lo que redacta el/la docente —
  *lo que diste en el período*, *lo que querés evaluar* y qué significó
  cada ítem de la libreta (Orales / Escritas / O. Act.) — y genera un
  prompt que produce los tres bancos por ítem más las recomendaciones
  finales, con varias variantes por nota, en el estilo institucional MCN
  (juicios descriptivos, en clave de proceso, con niveles de avance —
  destacado, significativo, moderado, escaso, mínimo—, competencias
  especificadas y cierre con sugerencias de superación; sin «rendimiento»,
  «satisfactorio» ni etiquetas). Al pegar la respuesta se cargan los cuatro
  bancos de una sola vez y se activa la estructura de secuencia.
  El modo **«Banco + rúbrica desde mis criterios de logro»** hace lo mismo
  para el banco general: la IA define el criterio de logro de cada banda de
  notas y escribe el banco completo con frases pensadas para la composición
  automática (oraciones autónomas, sin conectores iniciales, que leen bien
  solas o encadenadas con «Sin embargo, …» / «Asimismo, …»); al pegar la
  respuesta se cargan la rúbrica y el banco de una sola vez.
- **📊 Rúbrica** — qué significa cada rango de notas (instrucción
  obligatoria para el modo IA).
- **🎨 Estilo y Rend.** — tono, largo máximo, contraste con períodos
  anteriores y prorrateo del Rend.
- **🤖 Proveedor de IA** — proveedor, modelo y API key (solo para los
  modos IA y Mixto). La key se guarda con `chrome.storage.local` y se
  recuerda por proveedor.
- **💾 Mis bases** — guardá la configuración actual con un nombre (por
  asignatura, grupo o período), cargala cuando quieras, y exportá/importá
  todo a un archivo JSON para respaldar o compartir con colegas (las API
  keys nunca se exportan).

### Cómo conseguir la API key (solo modos IA / Mixto)

1. Entrá al sitio del proveedor (el link «¿Cómo obtenerla?» de la pestaña
   Proveedor te lleva directo). Varios tienen plan gratuito (Gemini, Groq,
   OpenRouter…).
2. Creá una key y pegala en la pestaña **Proveedor de IA**.

## Uso en SIGED

1. Entrá a `https://candersen.siged.com.uy/sigedx/homebackend.aspx` ya
   logueado.
2. Panel lateral → **Libreta @** → **Cerrar Prom. por Alumno**.
3. Elegí la libreta (asignatura) en el desplegable
   *Seleccione una libreta…*.
4. Abrí el primer alumno: aparece la grilla con todos los períodos.
5. Abajo a la derecha vas a ver el panel **SIGED · Juicios IA** con dos
   botones:

   - **Generar juicios (alumno actual)** — completa Rend. y Juicio del
     alumno abierto. Vos guardás manualmente.
   - **Procesar todo el grupo (auto)** — completa al alumno actual,
     presiona `Guardar y siguiente` (`BTNGUARDARYSIGUIENTE`) y repite hasta
     el último.

6. Mientras corre el modo automático aparece un botón **⏹ Detener**.
   Al apretarlo se corta antes del próximo guardado. Los alumnos ya
   guardados quedan guardados en SIGED (no hay deshacer).
7. El loop se detiene solo cuando:
   - El nombre del alumno no cambia tras el guardado (último alumno).
   - SIGED muestra un popup (lo informa en el log y para).
   - El alumno actual ya fue procesado en esta corrida (anti loop infinito).
   - El usuario aprieta **Detener**.

## Privacidad

- La API key se guarda con `chrome.storage.local` (solo tu perfil de
  navegador).
- La llamada a `api.anthropic.com` la hace el service worker
  (`background.js`) y se envían: nombre del alumno, libreta/asignatura,
  período evaluado y detalle de notas. No se mandan datos de otros alumnos.
- Los `host_permissions` están limitados a `*.siged.com.uy` y
  `api.anthropic.com`.

## Rúbrica aplicada al juicio

Se le pasa a Claude la siguiente rúbrica como instrucción obligatoria, además
de un resumen calculado localmente con los conteos del período:

- Nota igual a `1` → ausencia o no entrega del trabajo (se menciona como
  entrega pendiente).
- Notas entre `2` y `4` (cualquier nota menor a 5) → "debe mejorar la calidad
  de sus producciones".
- Notas de `5` o más → trabajo a destacar. Cuanto más alta la nota, más
  fuerte la valoración (5-6 satisfactorio, 7-8 muy bueno, 9-10 destacado).
- Si conviven notas en distintos rangos, el juicio equilibra lo positivo con
  lo a mejorar.

## El panel no aparece

- Verificá que la extensión esté habilitada en `chrome://extensions` y que
  el host coincida con el de tu institución (`*.siged.com.uy`).
- Abrí DevTools (F12) en la pestaña de SIGED → tab **Console**: tiene que
  aparecer una línea `[SIGED Juicios] content.js cargado en …`.
  - Si no aparece, recargá la extensión (⟳) y la pestaña.
- El panel se inyecta solo en el frame principal con `position:fixed` y
  `z-index:2147483647` — si igual no se ve probablemente hay un overlay de
  SIGED tapándolo; arrastralo desde la barra superior.

## Estructura del repo

```
manifest.json   – MV3, permisos y matches
background.js   – service worker, llamada a la API del proveedor de IA
providers.js    – definiciones de proveedores de IA (compartido)
content.js      – panel flotante + extracción + relleno + auto-loop +
                  generador por plantillas y banco (modos sin IA)
popup.html/js   – popup del ícono: estado rápido + acceso a la configuración
options.html/js – página de configuración completa (pestañas, asistente de
                  prompts, bases guardadas, export/import)
```

## Limitaciones conocidas

- Si los códigos de calificación de la libreta son letras sin valor numérico
  (MB, B, R…), el Rend. hay que completarlo a mano.
- Si SIGED renombra los `id` (`vCALIFXREUCALIFCOD_NNNN`,
  `vCALIFXREUJUICIO_NNNN`, `GridjuiciosContainerTbl`,
  `BTNGUARDARYSIGUIENTE`, etc.) hay que actualizar los selectores en
  `content.js`.
- Si el período no está habilitado (`Mensaje` = "Período no habilitado") la
  fila se omite.

## Desarrollo

1. Editá los archivos de la raíz.
2. En `chrome://extensions` apretá el botón ⟳ del recargar de la extensión.
3. Recargá la pestaña de SIGED (los content scripts se reinyectan).
4. Para ver logs del service worker: en `chrome://extensions` → click en
   **service worker** debajo del nombre de la extensión.
