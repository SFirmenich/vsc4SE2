# Visión general de Learning Activity Tracker - Student

Este documento describe la idea general de la extensión **Learning Activity Tracker - Student** como herramienta para trabajar con paquetes de aprendizaje basados en prácticas de programación, acompañar el proceso del alumno y generar una entrega revisable por el docente.

Para detalles operativos sobre cómo construir un paquete compatible, consulta la [guía completa de autoría](activity-authoring-guide.md). Para detalles técnicos específicos, consulta [activity-format.md](activity-format.md), [events.md](events.md) y [security-limitations.md](security-limitations.md).

## Idea central

La extensión permite convertir una práctica de programación en un **paquete de aprendizaje importable** por VS Code.

Un paquete de aprendizaje contiene:

- La definición de la actividad.
- La teoría necesaria.
- Las tareas que debe realizar el estudiante.
- Un proyecto base.
- Instrucciones para agentes de IA.
- Archivos de apoyo opcionales.

El objetivo no es solamente entregar código inicial, sino crear un entorno de trabajo donde el proceso del estudiante quede acompañado y documentado.

## Ciclo de trabajo

El flujo esperado es:

1. El profesor prepara una actividad de aprendizaje.
2. El profesor exporta la actividad como ZIP.
3. El estudiante importa el ZIP desde VS Code.
4. La extensión prepara el proyecto de trabajo.
5. El estudiante registra su identidad.
6. El estudiante inicia y termina tareas desde el panel.
7. La extensión registra eventos, commits, metadata e interacciones.
8. El estudiante exporta una entrega.
9. El profesor revisa el proyecto, la evolución y las evidencias.

## Paquete de aprendizaje

Una actividad se distribuye como un ZIP con una estructura como:

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
```

El archivo `manifest.json` define la actividad y sus tareas. La carpeta `starter/proyecto-base` contiene el proyecto inicial que se copiará al root del workspace del alumno.

Al importar la actividad, el paquete completo queda preservado dentro de:

```text
.vsc4education/
```

Esto permite que el proyecto del alumno tenga a mano el material académico original, las tareas, la teoría y las instrucciones de agente utilizadas.

## Proyecto del estudiante

Después de importar, el workspace queda organizado de forma que el alumno trabaja sobre el proyecto real en el root:

```text
proyecto-del-estudiante/
├── src/
├── package.json
├── AGENTS.md
├── .git/
└── .vsc4education/
```

El código que debe modificar el alumno está en el proyecto normal, por ejemplo en `src/`. El material académico y la evidencia quedan en `.vsc4education/`.

## Identidad y contribuciones

Antes de empezar una tarea, el estudiante debe registrarse con:

- Identificador institucional.
- Nombre.
- Apellido.

La extensión crea un espacio individual:

```text
.vsc4education/contributions/<studentId>/
```

Dentro de ese directorio se guarda todo lo relativo a ese estudiante:

```text
profile.json
state.json
events.jsonl
agent-interactions.jsonl
AGENTS.generated.md
current-task.json
task-metadata/
```

Esto permite que un mismo repositorio pueda contener evidencias separadas por estudiante, especialmente útil en prácticas grupales o proyectos compartidos.

La extensión vincula localmente la instalación de VS Code a un único estudiante para ese workspace. No es una barrera de seguridad del sistema operativo, pero evita que la propia extensión escriba accidentalmente evidencia en la contribución de otro compañero.

## Acompañamiento del proceso

La extensión acompaña al alumno mediante:

- Un panel con tareas.
- Estados de tarea: `pending`, `active`, `completed`.
- Botones para iniciar y terminar tareas.
- Registro automático de eventos.
- Heartbeats periódicos.
- Commits Git automáticos.
- Generación de contexto para agentes.
- Exportación final de la entrega.

La intención es que el alumno trabaje dentro de VS Code sin tener que gestionar manualmente archivos de evidencia.

## Eventos y evidencia

Cada estudiante tiene su propio registro:

```text
.vsc4education/contributions/<studentId>/events.jsonl
```

Los eventos registran acciones como:

- Actividad cargada.
- Estudiante registrado.
- Sesión iniciada.
- Tarea iniciada.
- Archivo editado.
- Archivo guardado.
- Terminal abierta.
- Tarea finalizada.
- Entrega exportada.
- Restauración de `AGENTS.md`.
- Modificación detectada en una contribución ajena.

Cada evento se guarda como una línea JSON y forma parte de una cadena hash. Esto permite detectar alteraciones accidentales o inconsistencias en la secuencia.

La extensión no guarda el contenido completo de los archivos. Registra rutas, tipo de evento, timestamps y metadatos mínimos.

## Git

La extensión utiliza Git como soporte de evolución del proyecto.

Contempla varios escenarios:

- Si no existe repositorio, lo inicializa.
- Si existe un repositorio sin commits, crea el primer commit.
- Si existe un repositorio con historial, lo conserva y añade un checkpoint.
- Si se abre una actividad ya instalada, reanuda la sesión sin crear un nuevo commit de carga.

Durante el trabajo genera commits como:

```text
[studentId] Task started: <taskId>
[studentId] Task completed: <taskId>
[studentId] Checkpoint: Submission export
```

Esto permite revisar la evolución del código junto con la evidencia registrada en `.vsc4education`.

## Rol de los agentes de IA

La extensión no se integra con APIs privadas de Codex, ChatGPT, Claude ni Copilot.

La integración con agentes se realiza mediante archivos del workspace.

El paquete de aprendizaje incluye:

```text
agent/instructions.md
```

Al importar la actividad, la extensión genera y protege:

```text
AGENTS.md
```

Este archivo indica a los agentes cómo deben comportarse dentro del proyecto.

El rol esperado del agente es pedagógico:

- No resolver la práctica.
- No escribir código funcional de solución.
- No reemplazar implementaciones del estudiante.
- No crear tests completos que resuelvan la tarea.
- Sí puede insertar comentarios pedagógicos.
- Sí puede señalar riesgos, preguntas o conceptos a revisar.
- Sí puede proponer estrategias en lenguaje natural.

Además, las instrucciones piden al agente registrar la conversación en:

```text
.vsc4education/contributions/<studentId>/agent-interactions.jsonl
```

Cada entrada debe indicar:

- Timestamp.
- Actor.
- Mensaje.
- Proveedor del agente cuando corresponde: `chatGPT`, `claude` o `copilot`.

Ejemplo:

```json
{"timestamp":"2026-06-11T12:00:00.000Z","actor":"student","message":"No entiendo esta tarea"}
{"timestamp":"2026-06-11T12:00:01.000Z","actor":"agent","agent":"copilot","message":"Revisa primero qué campos deberían ser privados."}
```

Este registro depende de que el agente respete las instrucciones. La extensión no puede leer conversaciones privadas de herramientas externas.

## Protección de AGENTS.md

`AGENTS.md` es una pieza importante del contrato pedagógico.

Mientras la extensión está activa:

- Si `AGENTS.md` se modifica, se restaura.
- Si se elimina, se vuelve a crear.
- Si se modifica el archivo interno de instrucciones, también se restaura desde la copia maestra.

La copia canónica se conserva en:

```text
.vsc4education/agent/instructions.master.md
```

Esta protección funciona dentro de las capacidades normales de una extensión de VS Code. No impide que un usuario con acceso al sistema de archivos modifique archivos cuando la extensión no está activa.

## Entrega exportada

Al exportar, la extensión genera un ZIP de entrega.

Antes de crear el ZIP:

1. Restaura `AGENTS.md` si es necesario.
2. Registra el evento `submission_exported`.
3. Pausa eventos automáticos para evitar ruido durante el empaquetado.
4. Ejecuta `git add .`.
5. Crea un checkpoint final.
6. Genera el archivo ZIP.

El nombre sugerido es:

```text
submission-<activityId>-<studentId>-<timestamp>.zip
```

La entrega incluye:

- El proyecto completo.
- El código fuente.
- `.git` si existe.
- `.vsc4education`.
- Las contribuciones de estudiantes presentes.
- Eventos, metadata y conversaciones registradas.

## Revisión docente

Aunque esta extensión está orientada al estudiante, la entrega está preparada para que una herramienta docente pueda analizar:

- Evolución del repositorio.
- Commits y diffs.
- Tareas iniciadas y terminadas.
- Tiempos aproximados.
- Archivos modificados.
- Eventos por estudiante.
- Interacciones con agentes.
- Metadata por tarea.
- Posibles huecos de actividad.
- Inconsistencias en cadenas hash.

La entrega no pretende ser una prueba forense. Es una fuente de evidencia local para apoyar la revisión docente.

## Limitaciones importantes

La extensión debe entenderse como una herramienta de acompañamiento y evidencia, no como un sistema antifraude.

Limitaciones principales:

- El estudiante controla su equipo.
- El estudiante puede modificar archivos manualmente.
- La extensión sólo observa mientras está activa.
- Los registros de agentes dependen de que el agente obedezca `AGENTS.md`.
- Los hashes detectan inconsistencias, pero no garantizan autenticidad absoluta.
- Git ayuda a reconstruir evolución, pero también está bajo control local.

Más detalles en [security-limitations.md](security-limitations.md).

## Relación con una futura extensión docente

Una futura extensión para profesores podría usar estos mismos archivos para:

- Crear actividades visualmente.
- Exportar paquetes compatibles.
- Importar entregas.
- Revisar timelines.
- Ver commits y diffs.
- Navegar conversaciones con agentes.
- Verificar cadenas hash.
- Comparar estado inicial y final.
- Asociar feedback a evidencias.

Por ahora, el formato se mantiene pragmático y documentado, sin introducir todavía un metamodelo formal completo.

## Resumen

Learning Activity Tracker - Student convierte una práctica de programación en un entorno de aprendizaje instrumentado.

El valor principal está en combinar:

- Proyecto inicial.
- Tareas explícitas.
- Teoría.
- Reglas para agentes de IA.
- Registro de actividad.
- Evidencia por estudiante.
- Evolución Git.
- Exportación revisable.

La extensión busca que el alumno trabaje normalmente en VS Code, mientras el proceso queda documentado de una forma útil para aprendizaje, seguimiento y revisión docente.
