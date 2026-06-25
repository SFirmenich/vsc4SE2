# Learning Activity Tracker - Teacher

## Idea general

**Learning Activity Tracker - Teacher** es una extension de VS Code pensada
para que el profesor pueda convertir una practica de aprendizaje en un paquete
estructurado, reutilizable y revisable por herramientas.

La idea central es que una actividad no sea solo un enunciado, sino un pequeno
proyecto compuesto por:

- Un manifiesto con la identidad de la actividad.
- Tareas ordenadas y con dependencias.
- Archivos Markdown con teoria y enunciados.
- Un proyecto inicial para el alumno.
- Instrucciones para agentes de IA.
- Rubricas de evaluacion.
- Metadatos suficientes para validar y exportar el paquete.

Estos paquetes estan orientados a ser consumidos por la extension
**Learning Activity Tracker - Student**, que los usa como base de trabajo para
los alumnos.

## Paquetes de aprendizaje

Un paquete de aprendizaje representa una practica docente en formato ZIP. Su
estructura principal es:

```text
manifest.json
theory/
tasks/
agent/instructions.md
starter/proyecto-base/
rubrics/main.json
signatures/
```

El archivo `manifest.json` describe la actividad: identificador, titulo,
descripcion, version, tipo y lista de tareas. Cada tarea puede tener un archivo
Markdown asociado, dependencias, criterios de aceptacion y evidencias esperadas.

Los directorios cumplen funciones diferentes:

- `tasks/`: contiene los enunciados de las tareas.
- `theory/`: contiene material teorico de apoyo.
- `starter/proyecto-base/`: contiene el proyecto inicial que recibe el alumno.
- `agent/`: contiene instrucciones pedagogicas para agentes de IA.
- `rubrics/`: contiene criterios de evaluacion.
- `signatures/`: contiene hashes u otros metadatos de integridad, sin afirmar
  firma digital si no existe una firma real.

El paquete busca que la practica sea portable, validable y suficientemente
explicita para que distintas herramientas puedan entender su estructura.

## Funcion docente

La extension docente trabaja sobre un directorio abierto en VS Code. Ese
directorio es la fuente de verdad de la actividad: los archivos se editan como
archivos normales y el panel docente los interpreta para mostrar el estado de la
actividad.

El comando principal es:

```text
Learning Activity Teacher: Open Teacher Panel
```

Desde ese panel se puede:

- Inicializar una actividad si el proyecto aun no contiene `manifest.json`.
- Ver el estado general de la actividad.
- Crear nuevas tareas `task-N`.
- Detectar automaticamente archivos `tasks/task-N.md` creados manualmente.
- Registrar tareas detectadas en `manifest.json`.
- Abrir manifiesto, tareas, teoria, rubrica e instrucciones en el editor normal.
- Validar la estructura antes de exportar.
- Exportar un ZIP compatible con la extension de estudiantes.

La extension evita imponer un editor cerrado. El profesor puede trabajar
directamente sobre Markdown, JSON y el proyecto inicial, mientras el panel
ofrece una vista sintetica y acciones de apoyo.

## Validacion y exportacion

Antes de exportar, la extension valida aspectos como:

- Existencia y sintaxis de `manifest.json`.
- Identificadores validos y unicos.
- Lista de tareas no vacia.
- Archivos Markdown referenciados.
- Dependencias inexistentes o circulares.
- Existencia del proyecto inicial.
- Existencia de instrucciones para agentes.
- Rubricas invalidas.
- Rutas que escapan del paquete.
- Directorios no recomendados como `node_modules`, `.git`, `dist` u `out`.

La exportacion genera un ZIP con `manifest.json` en la raiz y excluye archivos
temporales o no recomendados. Si se generan hashes SHA-256, se presentan como
evidencia local de integridad, no como firma digital.

## Revision de entregas

Ademas de crear paquetes, la extension permite importar entregas ZIP generadas
por alumnos. Una entrega puede incluir:

- Proyecto final del alumno.
- Metadatos `.vsc4education`.
- Contribuciones por estudiante.
- Eventos de trabajo.
- Interacciones con agentes de IA.
- Estado de tareas.
- Repositorio Git.

La extension extrae la entrega en almacenamiento de la extension y no ejecuta
codigo del alumno ni instala dependencias. Todo contenido importado se trata
como no confiable.

El panel de revision permite inspeccionar:

- Actividad asociada.
- Estudiantes y contribuciones.
- Timeline de eventos.
- Estado de tareas.
- Commits y archivos modificados.
- Diffs de Git de solo lectura.
- Interacciones con agentes.
- Integridad de cadenas hash.
- Rubrica y feedback docente.

## Integridad y evidencias

Las entregas pueden contener eventos encadenados mediante hashes. La extension
puede recalcular la cadena para detectar modificaciones locales, entradas JSON
invalidas o rupturas de `previousHash`.

Una cadena valida indica consistencia interna local, pero no garantiza autoria,
completitud ni autenticidad absoluta. Por eso la extension presenta estos datos
como apoyo a la revision docente, no como prueba forense ni como calificacion
automatica.

## Feedback y rubricas

La revision docente permite relacionar criterios de rubrica con evidencias como:

- Commits.
- Eventos.
- Archivos.
- Interacciones con agentes.

El feedback se guarda fuera de la entrega importada, en un directorio separado
de revisiones. Esto evita modificar el trabajo original del alumno y permite
exportar el feedback como JSON o ZIP.

## Alcance

El objetivo de la extension es apoyar un flujo pedagogico completo:

1. Diseñar una practica estructurada.
2. Convertirla en paquete portable.
3. Entregarla a alumnos mediante la extension de estudiantes.
4. Recibir entregas con trazas de trabajo.
5. Revisar evidencias, progreso, Git e interacciones con agentes.
6. Emitir feedback conectado con rubricas.

La extension no sustituye el juicio docente. Organiza informacion, detecta
problemas estructurales y facilita la revision, pero la evaluacion final sigue
dependiendo del profesor.
