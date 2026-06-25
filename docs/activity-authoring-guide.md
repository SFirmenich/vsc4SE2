# Guía completa para crear una actividad de aprendizaje

Este documento explica cómo preparar, organizar, validar y empaquetar una actividad compatible con **Learning Activity Tracker - Student**.

La guía describe el formato que implementa actualmente la extensión. No define todavía un metamodelo compartido con una futura extensión docente.

Documentación complementaria:

- [Formato técnico de la actividad](activity-format.md)
- [Modelo de eventos y evidencias](events.md)
- [Seguridad, privacidad y limitaciones](security-limitations.md)
- [Instrucciones generales de la extensión](../VSC4EducationStudents/README.md)

## 1. Objetivo de una actividad

Una actividad de aprendizaje combina:

- Material teórico.
- Una lista de tareas.
- Un proyecto inicial para el estudiante.
- Instrucciones para agentes de IA.
- Recursos opcionales.
- Una definición estructurada en `manifest.json`.

La actividad se distribuye como un archivo ZIP. El estudiante lo importa desde VS Code y selecciona un directorio de trabajo.

La extensión:

1. Copia el proyecto inicial al directorio elegido.
2. Conserva el paquete académico dentro de `.vsc4education/`.
3. Solicita la identidad del estudiante.
4. Crea un espacio de contribución individual.
5. Configura o reutiliza el repositorio Git.
6. Registra tareas, eventos, commits e interacciones con agentes.

## 2. Estructura del paquete

La estructura recomendada es:

```text
mi-actividad/
├── manifest.json
├── theory/
│   └── teoria.md
├── tasks/
│   ├── tarea1.md
│   ├── tarea2.md
│   └── tarea3.md
├── agent/
│   └── instructions.md
├── starter/
│   └── proyecto-base/
│       ├── src/
│       ├── package.json
│       └── ...
└── signatures/
    └── manifest.sig
```

El ZIP puede contener estos elementos directamente en su raíz o dentro de un único directorio contenedor.

Ejemplos válidos:

```text
actividad.zip
└── manifest.json
```

```text
actividad.zip
└── mi-actividad/
    └── manifest.json
```

No deben existir varios directorios candidatos con distintos `manifest.json`.

## 3. Archivo manifest.json

`manifest.json` identifica la actividad y declara las tareas disponibles.

Ejemplo:

```json
{
  "id": "poo-basico-01",
  "title": "POO Básica",
  "description": "Práctica introductoria de clases y encapsulamiento.",
  "version": "1.0.0",
  "tasks": [
    {
      "id": "encapsulamiento",
      "title": "Encapsular Animal",
      "description": "Protege el estado interno y expone operaciones controladas.",
      "file": "tasks/tarea1.md"
    },
    {
      "id": "comportamiento",
      "title": "Añadir comportamiento",
      "description": "Implementa las operaciones principales del dominio.",
      "file": "tasks/tarea2.md"
    }
  ]
}
```

### Campos de la actividad

| Campo | Obligatorio | Descripción |
|---|---:|---|
| `id` | Sí | Identificador estable y único de la actividad. |
| `title` | Sí | Nombre visible para el estudiante. |
| `description` | No | Resumen mostrado en el panel. |
| `version` | No | Versión académica del paquete. Se recomienda usar versionado semántico. |
| `tasks` | Sí | Lista no vacía de tareas. |

### Campos de una tarea

| Campo | Obligatorio | Descripción |
|---|---:|---|
| `id` | Sí | Identificador estable y único dentro de la actividad. |
| `title` | Sí | Título visible en el panel. |
| `description` | No | Resumen breve de la tarea. |
| `file` | No | Ruta relativa al documento detallado de la tarea. |

Los identificadores sólo pueden contener:

```text
letras, números, puntos, guiones y guiones bajos
```

Ejemplos válidos:

```text
tarea-01
encapsulamiento
fase_1.diseno
```

Ejemplos no válidos:

```text
tarea 01
../otra-carpeta
tarea/01
```

Los identificadores de tareas no pueden repetirse.

## 4. Material teórico

La carpeta `theory/` contiene el material conceptual que necesita el estudiante.

Se recomienda:

- Utilizar Markdown.
- Dividir documentos extensos por tema.
- Incluir ejemplos conceptuales sin entregar la solución exacta.
- Referenciar conceptos utilizados por las tareas.
- Indicar bibliografía o recursos externos cuando corresponda.

Ejemplo:

```text
theory/
├── introduccion.md
├── encapsulamiento.md
└── testing.md
```

Los agentes de IA reciben instrucciones para consultar este directorio antes de orientar al estudiante.

## 5. Definición de tareas

La carpeta `tasks/` contiene la descripción completa de cada tarea.

Un documento de tarea debería incluir:

1. Objetivo.
2. Contexto.
3. Requisitos.
4. Restricciones.
5. Resultado esperado.
6. Evidencias que debería producir el estudiante.
7. Criterios de finalización.

Ejemplo:

```markdown
# Tarea: encapsulamiento

## Objetivo

Proteger el estado interno de la clase `Animal`.

## Requisitos

- El nombre no puede estar vacío.
- La energía no puede ser negativa.
- El estado no debe modificarse directamente desde fuera de la clase.

## Criterios de finalización

- El proyecto compila.
- Las invariantes se mantienen.
- El estudiante puede justificar sus decisiones.
```

En el MVP, la extensión muestra `title` y `description` desde el manifiesto. El campo `file` documenta la relación con el Markdown, aunque todavía no se valida automáticamente que el archivo exista.

## 6. Proyecto inicial

El proyecto que recibirá el estudiante debe ubicarse en:

```text
starter/proyecto-base/
```

Todo su contenido se copia al root del directorio de trabajo.

Por ejemplo:

```text
starter/proyecto-base/src/Animal.ts
```

se convierte en:

```text
proyecto-del-estudiante/src/Animal.ts
```

El starter puede incluir:

- Código fuente incompleto.
- Configuración del lenguaje.
- Dependencias.
- Scripts de compilación.
- Tests parciales.
- README técnico del proyecto.
- Recursos necesarios para ejecutar la solución.

Debe evitar:

- Contener una solución completa.
- Incluir secretos o credenciales.
- Depender de rutas absolutas del equipo del profesor.
- Incluir `node_modules`, builds o archivos temporales.
- Contener un `.git` propio dentro de `proyecto-base`.

Antes de empaquetar, el profesor debería copiar `starter/proyecto-base` a una carpeta temporal limpia y verificar que puede instalarse, compilarse y ejecutarse.

## 7. Instrucciones para agentes de IA

El archivo:

```text
agent/instructions.md
```

es obligatorio para el funcionamiento previsto.

Su contenido define cómo deben comportarse Codex, Claude, Copilot u otros agentes que lean `AGENTS.md`.

Estas instrucciones deberían:

- Prohibir que el agente resuelva la actividad.
- Permitir únicamente orientación pedagógica.
- Exigir que consulte teoría, tareas y estado.
- Definir el formato de comentarios permitidos.
- Evitar la generación de tests o implementaciones completas.

Ejemplo reducido:

```markdown
# AGENTS.md

## Rol del agente

Actúa como revisor pedagógico. No implementes la solución.

## Está prohibido

- Completar funciones o clases.
- Reescribir el código del estudiante.
- Crear tests que resuelvan la tarea.

## Está permitido

- Añadir comentarios pedagógicos.
- Formular preguntas.
- Señalar riesgos y conceptos a revisar.

## Formato obligatorio

// AI-REVIEW [tipo] [severidad] [tarea-id]:
// Observación: ...
// Pregunta pedagógica: ...
// Sugerencia conceptual: ...
// Evidencia esperada del estudiante: ...
```

Durante la importación y el registro del estudiante, la extensión:

1. Conserva las instrucciones base.
2. Añade instrucciones técnicas para registrar la conversación.
3. Genera `AGENTS.md` en el root.
4. Protege `AGENTS.md` y restaura su contenido mientras la extensión está activa.
5. Ajusta las rutas de estado e interacciones a la contribución del estudiante activo.

El ejemplo completo se encuentra en:

[examples/poo-basico-01/agent/instructions.md](../VSC4EducationStudents/examples/poo-basico-01/agent/instructions.md)

## 8. Firmas

La carpeta `signatures/` es opcional en el MVP.

Puede contener:

```text
signatures/manifest.sig
```

Actualmente la extensión conserva este archivo, pero no valida su firma criptográfica. No debe utilizarse como garantía de autenticidad o integridad.

## 9. Preparación del directorio fuente

Antes de crear el ZIP, comprueba:

- `manifest.json` es JSON válido.
- Existe al menos una tarea.
- Los identificadores son únicos.
- Cada campo `file` apunta al documento correcto.
- Existe `agent/instructions.md`.
- Existe `starter/proyecto-base`.
- El proyecto inicial compila en una carpeta limpia.
- No se incluyen dependencias instaladas ni archivos temporales.
- No hay secretos, tokens ni datos personales.
- Las instrucciones del agente no contienen soluciones.

## 10. Creación del ZIP

El repositorio incluye una actividad de ejemplo:

```text
examples/poo-basico-01/
```

Para empaquetarla:

```powershell
npm run example:zip
```

Esto genera:

```text
examples/poo-basico-01.zip
```

El script utilizado está en:

[scripts/create-example-zip.js](../VSC4EducationStudents/scripts/create-example-zip.js)

Para otra actividad puede reutilizarse el mismo patrón:

```javascript
const AdmZip = require('adm-zip');

const zip = new AdmZip();
zip.addLocalFolder('ruta/a/mi-actividad');
zip.writeZip('mi-actividad.zip');
```

No debe añadirse al ZIP la carpeta padre equivocada si eso provoca varios niveles contenedores. La extensión admite la raíz directa o un único directorio contenedor.

## 11. Prueba del paquete

Para probar una actividad:

1. Ejecuta la extensión con `F5`.
2. Ejecuta `Learning Activity: Load Activity from ZIP`.
3. Selecciona el ZIP.
4. Selecciona una carpeta temporal.
5. Registra un estudiante de prueba.
6. Abre `Learning Activity: Open Student Panel`.
7. Inicia una tarea.
8. Modifica y guarda un archivo.
9. Termina la tarea.
10. Exporta la entrega.

Comprueba:

- El starter quedó en el root.
- El paquete completo quedó en `.vsc4education/`.
- Existe `AGENTS.md`.
- Existe la contribución del estudiante.
- Los eventos están encadenados.
- Los commits Git tienen los mensajes esperados.
- La entrega ZIP contiene el proyecto completo.

## 12. Resultado de la importación

Después de importar y registrar un estudiante:

```text
proyecto-del-estudiante/
├── AGENTS.md
├── src/
├── package.json
├── .git/
└── .vsc4education/
    ├── manifest.json
    ├── activity-manifest.json
    ├── activity-configuration.json
    ├── theory/
    ├── tasks/
    ├── agent/
    │   ├── instructions.md
    │   └── instructions.master.md
    ├── starter/
    ├── signatures/
    └── contributions/
        └── alumno-001/
            ├── profile.json
            ├── state.json
            ├── events.jsonl
            ├── agent-interactions.jsonl
            ├── AGENTS.generated.md
            ├── current-task.json
            └── task-metadata/
```

`current-task.json` sólo existe mientras haya una tarea activa.

## 13. Identidad y contribuciones

Antes de trabajar, el estudiante proporciona:

- Identificador institucional.
- Nombre.
- Apellido.

El identificador normalizado se utiliza como directorio:

```text
.vsc4education/contributions/<studentId>/
```

Cada contribución mantiene de forma independiente:

- Perfil.
- Estado de tareas.
- Cadena hash de eventos.
- Metadata de tareas.
- Interacciones con agentes.
- Contexto dinámico.

Una instalación local de VS Code queda vinculada a un único estudiante para ese workspace. Esta separación no equivale a permisos inviolables del sistema de archivos; consulta [security-limitations.md](security-limitations.md).

## 14. Gestión Git

La actividad puede cargarse en distintas situaciones.

### Carpeta sin repositorio

La extensión:

1. Ejecuta `git init`.
2. Añade el contenido.
3. Crea `Initial activity state`.

### Repositorio existente sin commits

La extensión reutiliza el repositorio y crea su primer commit con el estado inicial.

### Repositorio existente con historial

La extensión conserva el historial y crea:

```text
Checkpoint: Activity loaded
```

### Actividad abierta posteriormente

Al abrir un proyecto que ya contiene:

```text
.vsc4education/activity-manifest.json
```

la extensión recupera la actividad y la contribución local sin crear otro commit de carga.

Los commits asociados a estudiantes incluyen su identificador:

```text
[alumno-001] Task started: encapsulamiento
[alumno-001] Task completed: encapsulamiento
[alumno-001] Checkpoint: Submission export
```

## 15. Eventos y evidencias

Cada estudiante tiene:

```text
.vsc4education/contributions/<studentId>/events.jsonl
```

Los eventos incluyen:

- Identidad del estudiante.
- Timestamp.
- Tipo de evento.
- Tarea activa.
- Metadata mínima.
- Hash anterior.
- Hash actual.

No se guarda el contenido completo de los archivos.

La especificación detallada está en [events.md](events.md).

## 16. Interacciones con agentes

Las instrucciones generadas piden al agente registrar cada mensaje en:

```text
.vsc4education/contributions/<studentId>/agent-interactions.jsonl
```

Formato:

```json
{"timestamp":"2026-06-11T12:00:00.000Z","actor":"student","message":"Pregunta"}
{"timestamp":"2026-06-11T12:00:01.000Z","actor":"agent","agent":"copilot","message":"Respuesta"}
```

Cuando `actor` es `agent`, el campo `agent` debe ser:

- `chatGPT`
- `claude`
- `copilot`

La extensión no utiliza APIs privadas para capturar conversaciones. El registro depende del cumplimiento del agente.

## 17. Exportación de la entrega

Antes de generar el ZIP, la extensión:

1. Restaura `AGENTS.md` si fuera necesario.
2. Registra `submission_exported`.
3. Pausa eventos automáticos.
4. Ejecuta `git add .`.
5. Crea el checkpoint final.
6. Genera el ZIP completo.

Nombre típico:

```text
submission-<activityId>-<studentId>-<timestamp>.zip
```

La entrega incluye el proyecto, `.vsc4education` y `.git` si existe.

## 18. Errores frecuentes

### El ZIP no contiene manifest.json

Comprueba que esté en la raíz o dentro de un único directorio contenedor.

### El manifiesto no tiene tareas

`tasks` debe ser una lista no vacía.

### Identificadores inválidos

No utilices espacios, barras ni rutas relativas en `id`.

### No se genera AGENTS.md

Comprueba que exista `agent/instructions.md` y que el estudiante haya sido registrado.

### El starter aparece dentro de otra carpeta

El contenido ejecutable debe estar directamente dentro de `starter/proyecto-base`.

### El proyecto no compila después de importar

Prueba el starter fuera del paquete e incluye todos los archivos de configuración necesarios.

### El agente no registra conversaciones

La extensión sólo puede instruir al agente. No puede obligar a herramientas externas mediante APIs privadas.

### Git no crea commits

Comprueba que Git esté instalado. La extensión configura una identidad local si es necesario, pero permite continuar sin integración Git cuando Git no está disponible.

## 19. Checklist final para el autor

Antes de distribuir una actividad:

- [ ] El identificador de actividad es estable.
- [ ] La versión fue actualizada.
- [ ] El título y la descripción son claros.
- [ ] Todas las tareas tienen identificadores únicos.
- [ ] Cada tarea tiene un documento Markdown.
- [ ] La teoría cubre los conceptos necesarios.
- [ ] El starter no contiene la solución.
- [ ] El starter compila desde una carpeta limpia.
- [ ] `agent/instructions.md` limita correctamente a los agentes.
- [ ] No hay secretos ni datos personales.
- [ ] El ZIP tiene la estructura esperada.
- [ ] La importación fue probada con Git nuevo.
- [ ] La importación fue probada con un repositorio existente.
- [ ] Se pudo iniciar y terminar una tarea.
- [ ] Se generaron eventos y metadata.
- [ ] Se pudo exportar una entrega.

## 20. Actividad de referencia

La implementación de referencia está en:

[examples/poo-basico-01](../VSC4EducationStudents/examples/poo-basico-01)

Conviene copiarla como punto de partida y reemplazar:

- `manifest.json`
- El contenido de `theory/`
- El contenido de `tasks/`
- `agent/instructions.md`
- El proyecto de `starter/proyecto-base/`

Mantén la estructura de carpetas hasta que exista una versión formal y compartida del metamodelo.
