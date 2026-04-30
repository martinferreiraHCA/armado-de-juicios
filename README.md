# SIGED · Armado de juicios con IA

Userscript de Tampermonkey/Violentmonkey que automatiza el cierre de promedios y la
redacción de juicios en SIGED (`*.siged.com.uy`) usando la API de Claude.

Sobre la pantalla **Libreta @ → Cerrar Prom. por Alumno**, agrega un panel flotante
que lee las notas del período habilitado, calcula el rendimiento numérico y genera
el juicio de la asignatura llamando a Claude. Después podés revisar y presionar
"Guardar y continuar" en SIGED como siempre.

## Cómo funciona

1. Ya autenticado en SIGED, vas a:
   - `homebackend.aspx`
   - panel lateral → **Libreta @** → **Cerrar Prom. por Alumno**
   - **Seleccione una libreta…** y elegís el grupo / asignatura.
2. Para cada alumno se abre la grilla de períodos (`GridjuiciosContainerTbl`).
3. Apretás **Generar juicios del período** en el panel del userscript.
   - El script lee el `GXState` de la página y arma, por cada fila/período, el
     detalle de notas (Orales, Escritos, Otras actividades, inasistencias y, si
     existe, el juicio previo).
   - Si la asignatura pide **Rendimiento**, completa el `select`
     `vCALIFXREUCALIFCOD_NNNN` con la opción más cercana al promedio numérico.
   - Si la asignatura pide **Juicio**, llama a Claude y completa el textarea
     `vCALIFXREUJUICIO_NNNN` (recortado al máximo de caracteres configurado).
4. Revisás los textos y presionás **Guardar y continuar** en SIGED.

> El userscript **nunca** guarda solo: siempre requiere que vos confirmes el
> guardado en SIGED. Es una herramienta de redacción asistida.

## Requisitos

- Navegador con [Tampermonkey](https://www.tampermonkey.net/) o
  [Violentmonkey](https://violentmonkey.github.io/).
- Una API key de Anthropic (`sk-ant-…`) con saldo / créditos disponibles.

## Instalación

1. Instalá Tampermonkey o Violentmonkey en tu navegador.
2. Abrí el archivo [`siged-juicios.user.js`](./siged-juicios.user.js) y elegí
   "Instalar userscript" cuando la extensión te lo proponga (o creá un script
   nuevo y pegá el contenido).
3. Entrá a SIGED. Vas a ver el panel **SIGED · Juicios IA** abajo a la derecha.

## Configuración del panel

| Campo | Descripción |
|-------|-------------|
| API key de Claude | Se guarda con `GM_setValue` (queda solo en tu navegador). |
| Modelo | `claude-sonnet-4-5` (recomendado), `claude-opus-4-7` o `claude-haiku-4-5-20251001`. |
| Máx. chars | Límite duro de caracteres para el juicio (default 500). |
| Tono / instrucciones | Texto extra que se inyecta en el `system` prompt. |

Botones:

- **Guardar config** persiste los cambios.
- **Generar juicios del período** procesa todas las filas habilitadas de la
  grilla actual.

## Privacidad

- La API key y la configuración se guardan localmente con `GM_setValue` (no se
  envían a ningún servidor además de `api.anthropic.com`).
- En cada llamada a Claude se envía: nombre del alumno, libreta/asignatura,
  período evaluado, detalle de notas y promedio. No se envía información de
  otros alumnos ni datos sensibles fuera de los que aparecen en pantalla.
- El `@connect api.anthropic.com` del userscript hace que Tampermonkey pida
  permiso explícito la primera vez que llama a la API.

## Limitaciones conocidas

- Los códigos de calificación (`vCALIFXREUCALIFCOD_*`) varían entre instituciones.
  El script elige la opción del `<select>` cuyo texto numérico está más cerca
  del promedio. Si tu libreta usa códigos en letras (MB, B, R, …) sin valor
  numérico, vas a tener que ajustar el rendimiento a mano.
- Si el período no está habilitado (`Mensaje` = "Período no habilitado") la fila
  se omite.
- Si SIGED cambia los `id`/`name` de los campos en una nueva versión hay que
  actualizar el script.

## Desarrollo

El proyecto contiene:

- `siged-juicios.user.js` — userscript principal.
- `Guardar promedio` — captura HTML de referencia de la pantalla "Cierre de
  promedios por alumno". Se usó para mapear los `id` de los campos.

Para iterar:

1. Editá `siged-juicios.user.js`.
2. En el panel de Tampermonkey, recargá el script (o reinstalalo desde el
   archivo).
3. Recargá la pestaña de SIGED.
