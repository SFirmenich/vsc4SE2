# Formato de actividad

Una actividad es un ZIP con `manifest.json` en la raíz. También se admite un único directorio contenedor.

```text
actividad.zip
├── manifest.json
├── theory/
├── tasks/
├── agent/
│   └── instructions.md
├── starter/
│   └── proyecto-base/
└── signatures/
    └── manifest.sig
```

## Manifest

```json
{
  "id": "poo-basico-01",
  "title": "POO Básica",
  "description": "Introducción práctica a clases y encapsulamiento.",
  "version": "1.0.0",
  "tasks": [
    {
      "id": "encapsulamiento",
      "title": "Aplicar encapsulamiento",
      "description": "Protege el estado interno de Animal.",
      "file": "tasks/tarea1.md"
    }
  ]
}
```

`id`, `title` y una lista no vacía de `tasks` son obligatorios. Cada tarea requiere `id` y `title`; los identificadores deben ser únicos.

## Importación

El contenido de `starter/proyecto-base` se copia al root de la carpeta elegida. Por tanto, `starter/proyecto-base/src` se convierte en `src`, que es donde trabaja el estudiante.

El paquete académico completo se conserva dentro de `.vsc4education/`:

```text
proyecto-del-estudiante/
├── AGENTS.md
├── src/
├── package.json
└── .vsc4education/
    ├── manifest.json
    ├── theory/
    ├── tasks/
    ├── agent/
    │   ├── instructions.md
    │   └── instructions.master.md
    ├── starter/
    ├── signatures/
    ├── activity-configuration.json
    └── contributions/
        ├── ana-001/
        │   ├── profile.json
        │   ├── state.json
        │   ├── events.jsonl
        │   ├── agent-interactions.jsonl
        │   └── task-metadata/
        └── juan-002/
```

No se copian `manifest.json`, `theory`, `tasks` ni `agent` directamente al root.

`AGENTS.md` es una copia exacta de las instrucciones canónicas almacenadas en `agent/instructions.master.md`. La extensión restaura tanto `AGENTS.md` como `agent/instructions.md` si son modificados o eliminados mientras está activa.

La extensión añade a las instrucciones originales el contrato técnico requerido para registrar interacciones de agentes en formato JSONL.

## Identidad y contribuciones

Antes de iniciar una tarea, el estudiante debe indicar nombre, apellido e identificador institucional. El identificador normalizado se utiliza como nombre de contribución.

Cada instalación local de VS Code guarda en `workspaceState` qué contribución le pertenece. La extensión sólo crea y actualiza estado, eventos, metadata y conversaciones dentro de esa contribución.

Los cambios detectados dentro de una contribución diferente generan un evento `foreign_contribution_modified` en el espacio del estudiante activo.

## Repositorio Git

Al importar:

- Si no existe repositorio, se inicializa y se crea el commit inicial.
- Si existe un repositorio sin commits, se reutiliza y se crea su primer commit.
- Si existe historial, se conserva y la incorporación de la actividad queda registrada mediante un checkpoint.

Al abrir posteriormente el workspace, no se genera un nuevo commit de carga. La configuración común permite recuperar el modo del repositorio y reanudar la contribución local.

La firma de `signatures/manifest.sig` se conserva, pero el MVP no implementa validación criptográfica.
