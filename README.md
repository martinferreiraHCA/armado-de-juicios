# SIGED · Armado de juicios con IA

Extensión de Chrome (Manifest V3) que automatiza el cierre de promedios y la
redacción de juicios en SIGED (`*.siged.com.uy`) usando la API de Claude.

Sobre la pantalla **Libreta @ → Cerrar Prom. por Alumno**, agrega un panel
flotante que lee las notas del período habilitado, calcula el rendimiento
numérico y genera el juicio de la asignatura llamando a Claude. Después
revisás los textos y presionás **Guardar y continuar** en SIGED.

> Existe también una versión userscript (`siged-juicios.user.js`) para
> Tampermonkey/Violentmonkey, equivalente. Usá la extensión si querés algo
> instalable directo en Chrome/Edge/Brave.

## Instalación de la extensión (Chrome/Edge/Brave)

1. Cloná o descargá este repo.
2. Abrí `chrome://extensions` (o `edge://extensions`, `brave://extensions`).
3. Activá **Modo de desarrollador** (arriba a la derecha).
4. Click en **Cargar descomprimida** y seleccioná la carpeta `extension/`
   de este repo.
5. La extensión queda activa para `https://*.siged.com.uy/*`.

> Para Firefox hace falta empaquetar y firmar como add-on, no está soportado
> directamente. En Firefox usá el userscript.

## Configuración inicial

1. Click en el ícono de la extensión (arriba a la derecha del navegador).
2. Pegá tu **API key de Claude** (`sk-ant-...`). Se guarda con
   `chrome.storage.local`, queda solo en tu navegador.
3. Elegí **modelo**:
   - `claude-sonnet-4-5` (recomendado).
   - `claude-opus-4-7` (mejor calidad, más caro).
   - `claude-haiku-4-5-20251001` (más rápido y barato).
4. **Máx. chars**: largo máximo del juicio. Default `280` (≈1-2 oraciones).
5. **Tono / instrucciones**: el default fija explícitamente
   **3ra persona**. Podés agregar matices ("nivel inicial", "secundaria",
   etc.) sin sacar la regla de tercera persona.
6. **Guardar configuración**.

### Cómo conseguir la API key

1. Andá a https://console.anthropic.com
2. **Settings → API Keys → Create Key**.
3. Copiala (empieza con `sk-ant-...`). Necesitás créditos / billing activos.

## Uso en SIGED

1. Entrá a `https://candersen.siged.com.uy/sigedx/homebackend.aspx` ya logueado.
2. Panel lateral → **Libreta @** → **Cerrar Prom. por Alumno**.
3. Elegí la libreta (asignatura) en el desplegable
   *Seleccione una libreta…*.
4. Abrí el primer alumno: aparece la grilla con todos los períodos.
5. Abajo a la derecha vas a ver el panel **SIGED · Juicios IA**. Tenés dos
   botones:

   - **Generar juicios (alumno actual)**: completa Rend. y Juicio del alumno
     que tenés abierto y nada más. Vos guardás manualmente.
   - **Procesar todo el grupo (auto)**: completa al alumno actual, presiona
     `Guardar y siguiente` (`BTNGUARDARYSIGUIENTE`) y repite hasta el último.

6. Mientras corre el modo automático aparece un botón **⏹ Detener**.
   Al apretarlo se corta antes del próximo guardado. Los alumnos ya
   guardados quedan guardados en SIGED (no hay deshacer).
7. El loop se detiene solo cuando:
   - El nombre del alumno no cambia tras el guardado (último alumno).
   - SIGED muestra un popup (lo informa en el log y para).
   - El alumno actual ya fue procesado en este corrida (anti loop infinito).
   - El usuario aprieta **Detener**.

## Privacidad

- La API key se guarda con `chrome.storage.local` (solo tu perfil de
  navegador).
- La llamada a `api.anthropic.com` la hace el service worker
  (`background.js`) y se envían: nombre del alumno, libreta/asignatura,
  período evaluado y detalle de notas. No se mandan datos de otros alumnos.
- Los `host_permissions` están limitados a `*.siged.com.uy` y
  `api.anthropic.com`.

## Estructura del repo

```
extension/
  manifest.json     – MV3, permisos y matches
  background.js     – service worker, llamada a la API de Claude
  content.js        – panel flotante + lógica de extracción + relleno
  popup.html        – UI de configuración (ícono de la extensión)
  popup.js          – guarda/lee chrome.storage.local
siged-juicios.user.js  – versión userscript (Tampermonkey/Violentmonkey)
Guardar promedio       – HTML de referencia de la pantalla de cierre
```

## Limitaciones conocidas

- Si los códigos de calificación de la libreta son letras sin valor numérico
  (MB, B, R…), el Rend. hay que completarlo a mano.
- Si SIGED renombra los `id` (`vCALIFXREUCALIFCOD_NNNN`,
  `vCALIFXREUJUICIO_NNNN`, `GridjuiciosContainerTbl`, etc.) hay que
  actualizar los selectores en `extension/content.js`.
- Si el período no está habilitado (`Mensaje` = "Período no habilitado") la
  fila se omite.

## Desarrollo

1. Editá los archivos en `extension/`.
2. En `chrome://extensions` apretá el botón ⟳ del recargar de la extensión.
3. Recargá la pestaña de SIGED (los content scripts se reinyectan).
4. Para ver logs del service worker: en `chrome://extensions` → click en
   **service worker** debajo del nombre de la extensión.
