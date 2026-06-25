# Modelo de eventos

Los eventos se almacenan como JSON Lines en `.vsc4education/contributions/<studentId>/events.jsonl`. Cada estudiante tiene una cadena hash independiente.

```json
{
  "id": "uuid",
  "studentId": "ana-001",
  "timestamp": "2026-06-11T10:00:00.000Z",
  "event": "file_saved",
  "taskId": "encapsulamiento",
  "data": {
    "file": "src/Animal.ts"
  },
  "previousHash": "hash-anterior",
  "hash": "hash-actual"
}
```

El hash se calcula como:

```text
SHA256((previousHash o "") + canonicalJson(evento sin hash))
```

El JSON canónico ordena recursivamente las claves. El primer evento usa `previousHash: null`.

## Eventos del MVP

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

Antes de exportar, `submission_exported` se añade al registro y después se crea el checkpoint Git final. Durante la creación del ZIP se pausan los eventos automáticos de tracking y heartbeat.

## Conversaciones con agentes

Las conversaciones no forman parte de `events.jsonl`. Se almacenan separadamente en `.vsc4education/contributions/<studentId>/agent-interactions.jsonl`:

```json
{"timestamp":"ISO-8601","actor":"student","message":"..."}
{"timestamp":"ISO-8601","actor":"agent","agent":"claude","message":"..."}
```

Los proveedores admitidos son `chatGPT`, `claude` y `copilot`.

Los cambios de texto registran cantidad de cambios y rangos de líneas, no el contenido editado.
