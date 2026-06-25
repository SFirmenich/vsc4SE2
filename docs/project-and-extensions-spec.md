# Documentacion general y especificacion de extensiones

Este documento define la vision general de **VSCode4Education** como sistema de actividades de aprendizaje para programacion y fija los requisitos principales de sus dos extensiones:

- **Learning Activity Tracker - Student**, extension de estudiante actualmente implementada en este repositorio.
- **Learning Activity Tracker - Teacher**, extension docente prevista para crear, validar y revisar actividades y entregas.

La idea central es que ambas extensiones puedan funcionar sobre un mismo contrato: una estructura de actividad clara, versionada, portable y suficientemente estable para que una herramienta produzca paquetes y la otra los consuma sin depender de convenciones implicitas.

## 1. Proposito del proyecto

El proyecto convierte una practica de programacion en una actividad de aprendizaje importable por VS Code. Una actividad no es solo un proyecto base: tambien contiene teoria, tareas, instrucciones pedagogicas para agentes de IA, configuracion, evidencias y version academica.

El flujo esperado es:

1. El docente disena una actividad.
2. La extension docente valida la estructura y genera un paquete ZIP.
3. El estudiante importa el paquete con la extension de estudiante.
4. La extension prepara el workspace, copia el proyecto inicial y conserva el paquete academico.
5. El estudiante trabaja por tareas.
6. La extension registra eventos, estado, commits Git, metadata e interacciones con agentes.
7. El estudiante exporta una entrega.
8. La extension docente importa la entrega y revisa codigo, evolucion y evidencias.

El valor del sistema depende de que el paquete de actividad sea el punto de verdad compartido. Por eso el formato debe estar documentado, versionado y validado.

## 2. Modelo comun de actividad

Una actividad se distribuye como un ZIP con `manifest.json` en la raiz o dentro de un unico directorio contenedor. La estructura base es:

```text
actividad/
|-- manifest.json
|-- theory/
|-- tasks/
|-- agent/
|   `-- instructions.md
|-- starter/
|   `-- proyecto-base/
`-- signatures/
    `-- manifest.sig
```

Al importarse en el workspace del estudiante, el contenido de `starter/proyecto-base/` se copia al root del proyecto. El paquete academico completo se conserva en `.vsc4education/`:

```text
workspace-estudiante/
|-- AGENTS.md
|-- src/
|-- package.json
|-- .git/
`-- .vsc4education/
    |-- activity-manifest.json
    |-- activity-configuration.json
    |-- theory/
    |-- tasks/
    |-- agent/
    |   |-- instructions.md
    |   `-- instructions.master.md
    |-- starter/
    |-- signatures/
    `-- contributions/
```

### 2.1 `manifest.json`

El manifiesto identifica la actividad y declara sus tareas.

```json
{
  "id": "poo-basico-01",
  "title": "POO Basica",
  "description": "Practica introductoria de clases, encapsulamiento y comportamiento.",
  "version": "1.0.0",
  "tasks": [
    {
      "id": "encapsulamiento",
      "title": "Encapsular Animal",
      "description": "Convierte el estado en privado y expone operaciones controladas.",
      "file": "tasks/tarea1.md"
    }
  ]
}
```

Campos de actividad:

| Campo | Obligatorio | Uso |
|---|---:|---|
| `id` | Si | Identificador estable de la actividad. No debe cambiar entre versiones de la misma actividad. |
| `title` | Si | Nombre visible para estudiante y docente. |
| `description` | No | Resumen pedagogico breve. |
| `version` | No en el MVP, requerido como politica del proyecto | Version academica del paquete. Debe seguir SemVer cuando sea posible. |
| `tasks` | Si | Lista no vacia de tareas. |

Campos de tarea:

| Campo | Obligatorio | Uso |
|---|---:|---|
| `id` | Si | Identificador estable y unico dentro de la actividad. |
| `title` | Si | Nombre visible de la tarea. |
| `description` | No | Resumen breve para paneles y revision. |
| `file` | No en el MVP, recomendado | Ruta relativa al documento Markdown de la tarea. |

Los identificadores deben comenzar con una letra o numero y solo pueden contener letras, numeros, puntos, guiones y guiones bajos.

### 2.2 Versionado de actividades

La version de la actividad permite coordinar autor, estudiante y revision. La extension de estudiante actual conserva `version` si existe; la extension docente debe tratarla como obligatoria al publicar.

Recomendacion de versionado:

- `MAJOR`: cambia la estructura de tareas, ids, criterios o starter de forma incompatible con entregas anteriores.
- `MINOR`: agrega tareas opcionales, teoria, recursos o mejoras compatibles.
- `PATCH`: corrige textos, errores menores o instrucciones sin cambiar requisitos evaluables.

Reglas de compatibilidad:

- `id` de actividad debe permanecer estable.
- `id` de tarea no debe reutilizarse para otra consigna.
- Si una tarea cambia sustancialmente, debe cambiar la version de actividad y documentarse en changelog del paquete.
- Las entregas deben poder indicar con claridad contra que `activityId` y `version` fueron producidas.

## 3. Requisitos de la extension de estudiante

La extension de estudiante es la pieza que prepara el entorno de trabajo y registra el proceso local del alumno.

### 3.1 Carga de actividades

Debe:

- Importar actividades desde ZIP local.
- Importar actividades desde URL confiable.
- Aceptar `manifest.json` en raiz o en un unico directorio contenedor.
- Validar campos minimos del manifiesto.
- Copiar `starter/proyecto-base/` al root del workspace elegido.
- Conservar el paquete academico completo en `.vsc4education/`.
- Escribir `.vsc4education/activity-manifest.json` como copia normalizada del manifiesto.
- Escribir `.vsc4education/activity-configuration.json` con fecha de carga, estado Git y modo de repositorio.

### 3.2 Identidad y contribuciones

Debe:

- Solicitar identificador institucional, nombre y apellido.
- Normalizar el identificador para usarlo como directorio de contribucion.
- Crear `.vsc4education/contributions/<studentId>/`.
- Mantener por estudiante `profile.json`, `state.json`, `events.jsonl`, `agent-interactions.jsonl`, `AGENTS.generated.md`, `current-task.json` y `task-metadata/`.
- Vincular localmente el workspace a un estudiante mediante `workspaceState`.
- Evitar que la extension escriba accidentalmente en la contribucion de otro estudiante.

### 3.3 Gestion de tareas

Debe:

- Mostrar la lista de tareas declaradas en `manifest.tasks`.
- Permitir iniciar una unica tarea activa.
- Impedir finalizar una tarea que no esta activa.
- Impedir reiniciar una tarea completada.
- Registrar estado `pending`, `active` y `completed`.
- Crear metadata al finalizar: duracion, archivos modificados, cantidad de guardados, commit inicial y commit final cuando Git esta disponible.

### 3.4 Evidencia local

Debe registrar eventos JSONL por estudiante con cadena hash:

- `activity_loaded`
- `student_registered`
- `student_session_started`
- `task_started`
- `task_finished`
- `active_editor_changed`
- `file_changed`
- `file_saved`
- `file_created`
- `file_deleted`
- `terminal_opened`
- `heartbeat`
- `submission_exported`
- `agents_file_restored`
- `foreign_contribution_modified`

Los eventos deben registrar metadata minima, no el contenido completo de archivos. La cadena hash ayuda a detectar inconsistencias, pero no debe presentarse como garantia forense.

### 3.5 Git

Debe:

- Inicializar Git si no hay repositorio y la integracion esta habilitada.
- Reutilizar repositorios existentes sin destruir historial.
- Crear checkpoint de carga cuando el repositorio ya tiene historial.
- Crear commits al iniciar y terminar tareas.
- Crear checkpoint final antes de exportar entrega.
- Continuar funcionando si Git no esta disponible.

### 3.6 Agentes de IA

Debe:

- Generar `AGENTS.md` desde las instrucciones canonicas de la actividad.
- Conservar una copia maestra en `.vsc4education/agent/instructions.master.md`.
- Anadir instrucciones tecnicas para registrar interacciones en `agent-interactions.jsonl`.
- Restaurar `AGENTS.md` y las instrucciones internas si se modifican mientras la extension esta activa.
- Dejar claro que no usa APIs privadas de ChatGPT, Claude, Codex ni Copilot.

### 3.7 Exportacion

Debe:

- Registrar `submission_exported`.
- Pausar tracking automatico durante el empaquetado.
- Crear checkpoint Git final si corresponde.
- Generar un ZIP con proyecto, `.vsc4education/` y, si existe, `.git/`.
- Usar nombres de entrega trazables, por ejemplo `submission-<activityId>-<studentId>-<timestamp>.zip`.

## 4. Requisitos de la extension docente

La extension docente debe ser la contraparte que crea actividades compatibles y revisa entregas generadas por estudiantes.

### 4.1 Autoria de actividades

Debe permitir:

- Crear una actividad nueva desde una plantilla.
- Editar `manifest.json` mediante formulario y vista JSON.
- Gestionar teoria en `theory/`.
- Gestionar tareas en `tasks/`.
- Asociar cada tarea del manifiesto con su documento Markdown.
- Preparar o seleccionar `starter/proyecto-base/`.
- Crear y editar `agent/instructions.md`.
- Mantener un changelog del paquete.
- Incrementar version de actividad segun el tipo de cambio.

### 4.2 Validacion antes de publicar

Debe validar:

- `manifest.json` es JSON valido.
- `id`, `title`, `version` y `tasks` existen.
- Los ids cumplen el patron permitido.
- No hay tareas duplicadas.
- Cada `task.file` apunta a un archivo existente.
- Existe `agent/instructions.md`.
- Existe `starter/proyecto-base/`.
- El starter no contiene `.git`, `node_modules`, builds innecesarios ni archivos temporales.
- No hay secretos o credenciales evidentes.
- Las instrucciones de agente no incluyen una solucion directa.
- El ZIP resultante tiene una sola raiz valida.

### 4.3 Empaquetado

Debe:

- Exportar un ZIP compatible con la extension de estudiante.
- Preservar rutas relativas.
- Incluir `manifest.json`, `theory/`, `tasks/`, `agent/`, `starter/` y recursos opcionales.
- Generar o actualizar `signatures/manifest.sig` cuando exista soporte criptografico.
- Calcular checksums del paquete cuando se agregue soporte formal.

### 4.4 Revision de entregas

Debe poder importar una entrega y analizar:

- `activity-manifest.json` y version de actividad.
- `activity-configuration.json`.
- Contribuciones por estudiante.
- `state.json` y estado final de tareas.
- `task-metadata/*.json`.
- `events.jsonl` y validez de cadena hash.
- `agent-interactions.jsonl`.
- Historial Git y diffs por tarea.
- Archivos modificados respecto al starter.
- Huecos largos de heartbeat o inconsistencias temporales.
- Modificaciones en contribuciones ajenas.

La revision debe ayudar al docente a evaluar proceso y resultado, no prometer deteccion absoluta de fraude.

### 4.5 Feedback docente

Debe permitir generar feedback asociado a evidencias:

- Comentarios por tarea.
- Comentarios por archivo o diff.
- Observaciones sobre uso de agentes.
- Advertencias sobre eventos inconsistentes.
- Rubrica o criterios de evaluacion.
- Exportacion de reporte en Markdown, JSON o PDF.

## 5. Contrato entre extensiones

Ambas extensiones deben compartir estas reglas:

- El paquete de actividad es la fuente canonica antes de la importacion.
- `.vsc4education/activity-manifest.json` es la fuente canonica despues de la importacion.
- Las tareas se referencian siempre por `task.id`, nunca por posicion.
- Los archivos de tarea y teoria se referencian por rutas relativas dentro del paquete.
- Cada estudiante tiene una contribucion independiente en `.vsc4education/contributions/<studentId>/`.
- Los eventos son JSON Lines, una entrada por linea.
- Las conversaciones con agentes son JSON Lines separadas de los eventos.
- La evidencia local es orientativa y revisable, no inviolable.
- Los cambios incompatibles del formato deben incrementar una version de esquema.

## 6. Versionado del formato

El MVP no incluye un campo explicito de version de esquema. Para que ambas extensiones evolucionen con seguridad, se recomienda introducirlo en una version futura:

```json
{
  "schemaVersion": "1.0.0",
  "id": "poo-basico-01",
  "title": "POO Basica",
  "version": "1.0.0",
  "tasks": []
}
```

Politica propuesta:

- `schemaVersion` describe el contrato tecnico.
- `version` describe la version academica de la actividad.
- La extension docente debe declarar que version de esquema produce.
- La extension de estudiante debe declarar que versiones de esquema consume.
- La extension docente debe advertir si una entrega usa una version no soportada.

## 7. Criterios minimos de compatibilidad

Una actividad es compatible con la extension de estudiante actual si:

- El ZIP contiene `manifest.json` en la raiz o en un unico directorio contenedor.
- `manifest.json` tiene `id`, `title` y `tasks` no vacio.
- Cada tarea tiene `id` y `title`.
- Los ids cumplen el patron permitido.
- No hay ids de tarea duplicados.
- Existe `starter/proyecto-base/`.
- Existe `agent/instructions.md`.

Una entrega es revisable por la extension docente si:

- Contiene `.vsc4education/activity-manifest.json`.
- Contiene `.vsc4education/activity-configuration.json`.
- Contiene al menos una contribucion en `.vsc4education/contributions/`.
- Cada contribucion tiene `profile.json`, `state.json` y `events.jsonl`.
- Los eventos pueden leerse linea a linea como JSON.
- La ausencia de Git o de conversaciones de agente se trata como dato faltante, no como error fatal.

## 8. Documentos relacionados

- [Formato de actividad](activity-format.md)
- [Guia completa para crear una actividad](activity-authoring-guide.md)
- [Modelo de eventos](events.md)
- [Seguridad, privacidad y limitaciones](security-limitations.md)
- [README del proyecto](../README.md)

## 9. Resumen ejecutivo

El proyecto debe entenderse como un ecosistema de dos extensiones alrededor de una actividad versionada.

La extension docente produce actividades y revisa entregas. La extension de estudiante consume actividades, acompana el trabajo y genera evidencia. El puente entre ambas no debe ser la UI ni la implementacion interna, sino una estructura de archivos documentada: `manifest.json`, carpetas academicas, starter, instrucciones de agente, `.vsc4education/`, contribuciones, eventos y metadata.

Mientras ese contrato se mantenga claro y versionado, ambas extensiones pueden evolucionar por separado sin romper el flujo pedagogico completo.
