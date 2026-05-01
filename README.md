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

## Configuración inicial

1. Click en el ícono de la extensión.
2. Pegá tu **API key de Claude** (`sk-ant-...`). Se guarda con
   `chrome.storage.local`, queda solo en tu navegador.
3. Elegí **modelo**:
   - `claude-sonnet-4-5` (recomendado).
   - `claude-opus-4-7` (mejor calidad, más caro).
   - `claude-haiku-4-5-20251001` (más rápido y barato).
4. **Máx. chars**: largo máximo del juicio. Default `280` (≈1-2 oraciones).
5. **Tono / instrucciones**: el default fija explícitamente
   **3ra persona**. Podés agregar matices ("nivel inicial", "secundaria",
   etc.) sin sacar la regla.
6. **Guardar configuración**.

### Cómo conseguir la API key

1. https://console.anthropic.com → **Settings → API Keys → Create Key**.
2. Copiala (empieza con `sk-ant-...`). Necesitás créditos / billing activos.

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
background.js   – service worker, llamada a la API de Claude
content.js      – panel flotante + lógica de extracción + relleno + auto-loop
popup.html      – UI de configuración (ícono de la extensión)
popup.js        – guarda/lee chrome.storage.local
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
