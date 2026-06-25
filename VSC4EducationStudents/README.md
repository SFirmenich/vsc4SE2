# Learning Activity Tracker - Student

Extensión de Visual Studio Code para cargar prácticas de programación, gestionar tareas, registrar evidencias locales, automatizar commits Git y generar contexto basado en archivos para asistentes de IA.

No utiliza APIs privadas de Codex, Claude ni Copilot. La integración se realiza mediante `AGENTS.md` y los archivos de contexto almacenados en `.vsc4education/`.

`AGENTS.md` se sincroniza con las instrucciones canónicas de la actividad. Mientras la extensión está activa, cualquier modificación o eliminación se revierte automáticamente.

## Desarrollo

Requisitos:

- Node.js 22 o compatible con el runtime actual de VS Code.
- Git opcional.
- Visual Studio Code.

```powershell
npm install
npm run compile
```

Pulsa `F5` y usa la Command Palette en la ventana Extension Development Host.

## Prueba rápida

Genera el ZIP de ejemplo:

```powershell
npm run example:zip
```

Después:

1. Ejecuta `Learning Activity: Load Activity from ZIP`.
2. Selecciona `examples/poo-basico-01.zip`.
3. Selecciona una carpeta vacía como proyecto de trabajo.
4. Registra nombre, apellido e identificador institucional.
5. Abre `Learning Activity: Open Student Panel`.
6. Empieza una tarea, edita y guarda archivos.
7. Termina la tarea y revisa tu contribución y el historial Git.
8. Ejecuta `Learning Activity: Export Submission`.

La exportación registra el evento correspondiente y crea un checkpoint Git final inmediatamente antes de generar el ZIP.

## Escenarios Git

La carga y reapertura de actividades distingue estos casos:

1. **La carpeta no contiene un repositorio:** la extensión ejecuta `git init` y crea `Initial activity state`.
2. **La carpeta ya contiene un repositorio con historial:** se conserva el historial y se crea `Checkpoint: Activity loaded`.
3. **Se abre una actividad ya instalada y versionada:** la extensión detecta `.vsc4education/activity-manifest.json`, recupera la contribución local y registra una nueva sesión sin crear otro commit de carga.

Un repositorio normal que no contenga una actividad no se modifica automáticamente. Para instalar una actividad allí debe ejecutarse el comando de carga.

## Comandos

- `Learning Activity: Load Activity from ZIP`
- `Learning Activity: Load Activity from URL`
- `Learning Activity: Open Student Panel`
- `Learning Activity: Register Student`
- `Learning Activity: Start Task`
- `Learning Activity: Finish Task`
- `Learning Activity: Export Submission`

## Configuración

- `learningActivity.heartbeatIntervalSeconds`: intervalo de heartbeat, 30 segundos por defecto.
- `learningActivity.autoOpenPanelAfterLoad`: abre el panel tras importar.
- `learningActivity.enableGitIntegration`: activa commits automáticos.
- `learningActivity.trackTextChanges`: registra metadatos de ediciones.
- `learningActivity.trackTerminalOpen`: registra apertura de terminales.

## Estructura del proyecto importado

El proyecto del estudiante queda en el root:

- `src/` y el resto del starter.
- `AGENTS.md`, con las restricciones pedagógicas para agentes de IA.

El paquete académico común queda aislado en:

- `.vsc4education/manifest.json`
- `.vsc4education/theory/`
- `.vsc4education/tasks/`
- `.vsc4education/agent/`
- `.vsc4education/agent/instructions.master.md`
- `.vsc4education/starter/`
- `.vsc4education/signatures/`
- `.vsc4education/activity-manifest.json`
- `.vsc4education/activity-configuration.json`

`activity-configuration.json` indica si Git está deshabilitado y si el repositorio fue creado por la extensión o ya existía.

Cada estudiante dispone de un espacio independiente:

```text
.vsc4education/contributions/<studentId>/
├── profile.json
├── state.json
├── events.jsonl
├── agent-interactions.jsonl
├── AGENTS.generated.md
├── current-task.json
└── task-metadata/
```

La identidad activa se guarda en `workspaceState`, no en un marcador compartido del repositorio. Una instalación de VS Code queda vinculada a un único estudiante para ese workspace.

## Interacciones con agentes

La extensión añade a las instrucciones de la actividad un contrato para registrar la conversación en `.vsc4education/contributions/<studentId>/agent-interactions.jsonl`.

Cada línea tiene uno de estos formatos:

```json
{"timestamp":"2026-06-11T12:00:00.000Z","actor":"student","message":"Mensaje"}
{"timestamp":"2026-06-11T12:00:01.000Z","actor":"agent","agent":"copilot","message":"Respuesta"}
```

Para entradas del agente, `agent` debe ser `chatGPT`, `claude` o `copilot`. Este registro depende de que el agente respete las instrucciones; la extensión no lee conversaciones mediante APIs privadas.

Para crear una actividad desde cero, consulta la [guía completa de autoría](../docs/activity-authoring-guide.md).

Documentación especializada:

- [Documentación central](../docs/README.md)
- [Documentación general y especificación de extensiones](../docs/project-and-extensions-spec.md)
- [Formato de actividad](../docs/activity-format.md)
- [Eventos y evidencias](../docs/events.md)
- [Seguridad y limitaciones](../docs/security-limitations.md)
