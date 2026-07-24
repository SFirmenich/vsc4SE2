# Manual de usuario para profesorado

Este manual explica como usar los dos componentes orientados al profesorado en
VSCode4Education:

- `Learning Activity Tracker - Teacher`, la extension de VS Code para crear,
  validar, exportar y revisar actividades.
- `VSC4EducationRepository`, la aplicacion Django/React/Electron para organizar
  cursos, grupos, actividades, entregas, metricas agregadas y, opcionalmente,
  recibos firmados de eventos.

El objetivo del manual es describir el uso real del sistema sin cambiar el
contrato de compatibilidad entre paquetes de actividad, espacios de trabajo de
estudiantes, entregas y revisiones.

## 1. Idea general

VSCode4Education se organiza alrededor de artefactos ZIP portables. La base del
sistema no es una base de datos ni una interfaz concreta, sino una estructura de
archivos versionada que todos los componentes entienden.

El flujo habitual es:

1. El profesor crea una actividad con la extension de profesor.
2. El profesor exporta un ZIP de actividad para estudiantes.
3. El estudiante importa ese ZIP con la extension de estudiante.
4. El estudiante trabaja en VS Code sobre un proyecto normal.
5. La extension de estudiante registra evidencias locales y exporta un ZIP de
   entrega.
6. El profesor importa la entrega en la extension de profesor para revisar
   codigo, proceso, rubricas y feedback.
7. Opcionalmente, `VSC4EducationRepository` importa las mismas actividades y
   entregas para organizarlas por cursos y grupos, calcular paneles agregados y
   revisar evidencias a nivel de cohorte.

Los artefactos importantes son:

- ZIP de actividad para estudiantes: contiene el manifiesto, teoria, tareas,
  instrucciones para agentes, proyecto inicial y material publico.
- ZIP de actividad para profesor: conserva tambien rubricas privadas,
  soluciones oficiales, recursos de revision y claves privadas cuando se han
  generado.
- ZIP de entrega: contiene el proyecto entregado, `.vsc4education/`, eventos,
  estado de tareas, metadatos, interacciones con agentes cuando existen y el
  historial Git si esta disponible.

Repository guarda ZIPs originales y datos derivados. Sus filas de base de datos,
resumenes y metricas no sustituyen al formato portable.

## 2. Extension de profesor

La extension se llama:

```text
Learning Activity Tracker - Teacher
```

Los comandos visibles en la paleta de comandos de VS Code son:

```text
VSC4Education: Open creation mode
VSC4Education: Open revision mode
```

En una interfaz de VS Code en espanol pueden aparecer como:

```text
VSC4Education: Abrir modo de creacion
VSC4Education: Abrir modo de revision
```

Use `Open creation mode` para crear y exportar actividades. Use
`Open revision mode` para importar entregas, revisar evidencias y preparar
feedback.

## 3. Crear una actividad

Abra en VS Code una carpeta que actuara como proyecto fuente de la actividad y
ejecute el comando de creacion:

```text
VSC4Education: Open creation mode
```

En espanol, el mismo comando aparece como:

```text
VSC4Education: Abrir modo de creacion
```

Si la carpeta no contiene `manifest.json`, el panel permite inicializar una
actividad nueva. Durante la inicializacion se introducen:

- identificador de la actividad;
- titulo;
- descripcion opcional;
- version;
- tipo de actividad, por ejemplo ejercicio o proyecto;
- titulo de la primera tarea.

La extension crea una estructura como esta:

```text
manifest.json
theory/
tasks/
imports/
|-- theory/
`-- practice/
AGENTS.md
agent/
`-- instructions.md
starter/
resources/
|-- assessment-rubric.schema.json
|-- auto-grading-prompt.md
`-- overall-review-template.md
assessment/
|-- rubrics/
`-- solutions/
rubrics/
signatures/
```

Los archivos son la fuente de verdad. El panel ayuda a crearlos, abrirlos,
resumirlos, validarlos y exportarlos, pero el profesor sigue editando JSON,
Markdown, YAML y codigo fuente directamente en VS Code.

## 4. Estructura de una actividad

### 4.1 `manifest.json`

`manifest.json` identifica la actividad y declara sus tareas. Los campos mas
importantes son:

- `id`: identificador estable de la actividad. Debe usar letras, numeros,
  puntos, guiones o guiones bajos.
- `title`: titulo visible para el profesor y el estudiante.
- `description`: descripcion opcional.
- `version`: version de la actividad.
- `type`: tipo de actividad.
- `tasks`: lista ordenada de tareas.

Cada tarea debe tener un `id` estable. Ese `id` es la referencia canonica en
eventos, rubricas, entregas y Repository. No conviene interpretar las tareas por
su posicion en el array, porque una reordenacion podria romper la relacion con
evidencias anteriores.

Una tarea puede incluir:

- `title`;
- `file`, normalmente un Markdown bajo `tasks/`;
- `dependencies`;
- `acceptanceCriteria`;
- `expectedEvidence`.

Los criterios publicos de aceptacion van en `manifest.tasks[*].acceptanceCriteria`.
Los criterios privados de evaluacion van en `assessment/rubrics/<taskId>.yml`.

### 4.2 `theory/` y `tasks/`

Use `theory/` para material teorico que el estudiante puede consultar. Use
`tasks/` para enunciados de tareas.

El panel puede crear archivos de teoria y tareas. Tambien puede detectar tareas
creadas manualmente, por ejemplo `tasks/task-N.md`, y registrarlas en
`manifest.json`.

Una vez distribuida una actividad, evite renombrar identificadores de tareas en
la misma version. Si necesita cambios incompatibles, cree una nueva version de
la actividad.

### 4.3 `starter/`

`starter/` contiene el proyecto inicial. Al importar la actividad, la extension
de estudiante copia su contenido al espacio de trabajo del estudiante.

No incluya dependencias descargadas ni salidas de compilacion. Evite:

- `node_modules`;
- `.git`;
- `dist`;
- `out`;
- binarios o temporales pesados.

### 4.4 `agent/instructions.md`

`agent/instructions.md` contiene instrucciones pedagogicas para agentes de IA
que puedan colaborar con el estudiante. Este archivo se distribuye al
estudiante y se usa como fuente canonica para generar instrucciones tecnicas en
su espacio de trabajo.

No incluya soluciones oficiales, respuestas completas ni detalles privados de
rubricas en este archivo.

El `AGENTS.md` de la raiz del proyecto del profesor es distinto. Es una ayuda
local de autoria para agentes que ayuden al profesor a transformar material
previo en archivos canonicos de la actividad. No se exporta al ZIP de
estudiante.

### 4.5 `assessment/` y `resources/`

`assessment/` contiene material privado del profesor:

```text
assessment/
|-- rubrics/
|   `-- <taskId>.yml
`-- solutions/
    `-- <taskId>.md
```

Cada tarea debe tener una rubrica y una solucion oficial asociadas a su
`taskId`.

`resources/` contiene material de apoyo para revision:

```text
resources/
|-- assessment-rubric.schema.json
|-- auto-grading-prompt.md
`-- overall-review-template.md
```

`assessment/` y `resources/` se conservan en el paquete de profesor y se excluyen
del paquete de estudiante.

### 4.6 `imports/`

`imports/theory/` e `imports/practice/` sirven para traer material heredado:
PDFs, enunciados antiguos, apuntes, ejemplos, soluciones o practicas previas.

El panel permite importar material heredado y copiar un prompt de migracion para
que un agente ayude a convertir esos documentos en `theory/`, `tasks/`,
`starter/`, `agent/` o `assessment/`.

`imports/` es solo una zona de trabajo del profesor. No forma parte del ZIP de
estudiante.

## 5. Rubricas privadas

Las rubricas se guardan como YAML en:

```text
assessment/rubrics/<taskId>.yml
```

Una rubrica debe declarar, como minimo:

- `taskId`, igual al identificador de la tarea;
- `maxScore`;
- `requiresTeacherReview`;
- `criteria`, con al menos un criterio privado.

La suma de los criterios debe coincidir con la puntuacion esperada. Si se usa
una integracion de agencia observable, esa configuracion tambien debe cuadrar
con el maximo de la tarea.

Los modos de integracion de agencia son:

- `none`: la agencia observable no afecta a la nota.
- `weighted`: reserva una parte de la puntuacion para la agencia observable.
- `modifier`: suma o resta puntos dentro de un limite.
- `cap`: limita la puntuacion maxima si la evidencia de proceso es demasiado
  debil bajo las reglas definidas.
- `bonus`: suma credito adicional acotado.

Estas configuraciones no convierten las metricas en calificacion automatica. La
decision final sigue siendo del profesor.

## 6. Validar una actividad

Antes de exportar, la extension valida la estructura. La exportacion solo queda
disponible cuando no hay errores bloqueantes.

La validacion comprueba, entre otras cosas:

- que `manifest.json` exista y sea JSON valido;
- que el identificador de actividad sea valido;
- que haya titulo y version;
- que exista al menos una tarea;
- que los identificadores de tareas sean validos y unicos;
- que los Markdown referenciados existan;
- que las dependencias apunten a tareas existentes;
- que no haya dependencias circulares;
- que exista `starter/`;
- que exista `agent/instructions.md`;
- que cada tarea tenga rubrica privada y solucion oficial;
- que las rubricas tengan `taskId` correcto;
- que las puntuaciones de rubrica cuadren;
- que las rutas no escapen del paquete;
- que no se incluyan carpetas desaconsejadas como `node_modules`, `.git`,
  `dist` u `out`.

Si el panel detecta errores, abra el archivo indicado, corrija el problema y
guarde. El panel se refresca automaticamente al guardar, crear, borrar o
renombrar archivos dentro del proyecto de actividad.

## 7. Generar claves y exportar paquetes

### 7.1 Generar material de evidencia

Use la accion del panel para generar firmas o claves de evidencia cuando quiera
que las entregas registren eventos cifrados que luego puedan ser recuperados por
la revision docente.

El material publico viaja con el paquete de estudiante. El material privado debe
quedar solo en paquetes o espacios de revision del profesor.

Estas claves ayudan a cifrar, descifrar y verificar evidencias. No convierten el
sistema en una solucion forense infalible.

### 7.2 Exportar ZIP para estudiantes

El ZIP para estudiantes contiene el contrato publico de la actividad:

```text
manifest.json
theory/
tasks/
agent/instructions.md
starter/
signatures/
```

Se excluye material privado o local de autoria:

```text
assessment/
resources/
imports/
AGENTS.md de la raiz
rubrics/ heredado
```

Distribuya este ZIP a estudiantes mediante el aula virtual, repositorio de la
asignatura, correo institucional o el mecanismo que use el curso.

### 7.3 Exportar ZIP de profesor

El ZIP de profesor conserva el material necesario para revisar:

- manifiesto;
- teoria y tareas;
- starter;
- instrucciones de agente;
- rubricas privadas;
- soluciones oficiales;
- recursos de revision;
- claves privadas de evidencia si existen.

Guarde este paquete en un lugar privado. Es el paquete que debe importarse en un
workspace de revision cuando quiera revisar entregas con rubricas y claves
correctas.

## 8. Revisar entregas con la extension de profesor

Ejecute:

```text
VSC4Education: Open revision mode
```

En espanol, el mismo comando aparece como:

```text
VSC4Education: Abrir modo de revision
```

El panel de revision trabaja con una carpeta de revision. Puede:

- crear un workspace de revision nuevo;
- abrir un workspace de revision existente;
- usar la carpeta actual como workspace de revision.

La estructura esperada es:

```text
learning-activity-definition/
submissions/
```

Importe primero el ZIP de profesor de la actividad. Asi la revision dispone de
rubricas privadas, soluciones y claves de evidencia. Despues importe los ZIP de
entrega de estudiantes.

### 8.1 Importar una entrega

Use la accion:

```text
Import submission ZIP
```

La extension solicita el ZIP de estudiante, lo importa en una subcarpeta unica
del workspace de revision y agrega el proyecto importado al workspace actual de
VS Code para inspeccionar archivos.

La extension de profesor no ejecuta codigo de estudiante ni instala
dependencias. Todo contenido importado debe tratarse como no confiable.

### 8.2 Pestanas de revision

Para cada entrega, el panel muestra secciones como:

- `Report`: resumen principal de la entrega.
- `Agency metrics`: metricas de proceso agrupadas por dimension.
- `Evidence`: eventos y evidencias extraidas.
- `Git`: commits y archivos modificados cuando existe historial Git.
- `Agents`: conversaciones registradas con agentes cuando existen.
- `Integrity`: verificacion de cadena hash local y recibos externos si hay.
- `Rubric`: rubrica privada incluida en el paquete de profesor.
- `Feedback`: formulario de feedback y evaluaciones por criterio.

La informacion disponible depende de la entrega. Git, interacciones con agentes
y algunos metadatos pueden faltar; en general deben tratarse como evidencia
ausente, no como error automatico.

### 8.3 Interpretar la agencia observable

Las metricas de agencia observable resumen senales del proceso de trabajo, por
ejemplo:

- tiempo activo;
- intensidad de edicion;
- archivos y lineas tocadas;
- eventos de inicio y fin de tareas;
- guardados;
- trabajo en archivos esperados;
- actividad fuera de zonas esperadas;
- actividad de validacion o pruebas;
- interacciones con agentes;
- tiempo entre cambios y exportacion;
- integridad de la cadena de eventos.

El score compuesto de agencia observable es una ayuda para revisar, no una nota
automatica. Debe leerse junto con:

- el codigo entregado;
- los enunciados;
- los criterios publicos de aceptacion;
- las rubricas privadas;
- el historial Git;
- la linea temporal de eventos;
- las conversaciones con agentes si existen;
- el contexto docente del curso.

Las alertas o flags son indicadores para revisar con mas atencion. No son
acusaciones ni pruebas automaticas de mala conducta.

### 8.4 Revisar Git

Si la entrega contiene `.git`, el panel muestra commits detectados. Para cada
commit se pueden consultar archivos modificados.

La ausencia de Git no demuestra ausencia de trabajo. Significa que esa evidencia
opcional no esta disponible o esta incompleta.

### 8.5 Revisar conversaciones con agentes

La extension de estudiante no accede a APIs privadas de ChatGPT, Claude,
Copilot, Codex u otros proveedores. En su lugar, genera instrucciones para que
un agente cooperante registre intercambios en `agent-interactions.jsonl`.

Si no aparecen conversaciones, las causas posibles incluyen:

- el estudiante no uso un agente;
- el agente no siguio las instrucciones;
- el estudiante uso una herramienta fuera del flujo registrado;
- el archivo fue borrado, editado o esta mal formado.

Interprete esta evidencia de forma contextual.

### 8.6 Revisar integridad

La revision puede recomputar la cadena hash del log de eventos. Esto ayuda a
detectar lineas JSONL invalidas, enlaces `previousHash` rotos, eventos
faltantes o evidencia no descifrable.

Una cadena valida indica consistencia interna del log disponible. No prueba
autoria ni completitud absoluta.

Si hay recibos del servidor Repository y el manifiesto incluye la clave publica
esperada, la revision puede verificar esos recibos. Un recibo valido indica que
el Repository configurado observo y firmo un hash de evento en un momento del
servidor.

### 8.7 Guardar y exportar feedback

Use la seccion `Feedback` para registrar:

- estado de la revision;
- comentario general;
- evaluaciones por criterio;
- puntuaciones;
- comentarios;
- referencias de evidencia.

El feedback se guarda fuera del proyecto importado del estudiante, en el area de
reviews de la extension. Esto evita modificar la entrega original.

Use `Export feedback` para generar un ZIP de feedback que pueda devolverse al
estudiante o archivarse.

## 9. Repository: finalidad

`VSC4EducationRepository` organiza actividades y entregas a escala de curso.
Resulta util cuando el profesor necesita:

- catalogar asignaturas y grupos;
- almacenar ZIPs originales de actividades;
- almacenar ZIPs originales de entregas;
- asociar entregas con grupos;
- ver resumenes por entrega;
- comparar metricas entre estudiantes;
- revisar dashboards por version de actividad;
- recibir eventos firmados desde estudiantes cuando se configura como servidor
  de eventos.

Repository consume los mismos ZIPs que producen las extensiones. Guarda los
archivos originales y calcula datos derivados. No ejecuta codigo de estudiantes,
no instala dependencias de estudiantes y no modifica el contenido de los ZIPs
importados.

## 10. Ejecutar Repository

La aplicacion tiene esta estructura:

```text
VSC4EducationRepository/
|-- backend/   Django + Django REST Framework API
|-- frontend/  React + Vite local UI
|-- electron/  Electron desktop shell
`-- scripts/   scripts de desarrollo y empaquetado
```

Para desarrollo local del backend:

```powershell
cd VSC4EducationRepository\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Para desarrollo local del frontend:

```powershell
cd VSC4EducationRepository\frontend
npm install
npm run dev
```

Por defecto, el frontend espera la API en:

```text
http://127.0.0.1:8000/api
```

Para ejecutar la version de escritorio en desarrollo:

```powershell
cd VSC4EducationRepository
.\scripts\dev-desktop.ps1
```

Para construir la version de escritorio:

```powershell
cd VSC4EducationRepository
.\scripts\build-desktop.ps1
```

La version Electron empaqueta el backend Django, los archivos estaticos del
frontend React y una shell de escritorio que arranca el backend local y carga la
interfaz.

## 11. Flujo de uso en Repository

La pantalla inicial muestra cursos.

### 11.1 Crear una asignatura

En `Courses`, pulse `Add course` e indique:

- nombre de la asignatura;
- codigo opcional;
- descripcion opcional;
- grupo inicial;
- termino o periodo opcional.

La aplicacion crea la asignatura y su primer grupo.

### 11.2 Abrir una asignatura

Al abrir una asignatura se muestran sus actividades. Cada actividad aparece con
titulo, `activityId`, version, grupos asociados y numero de entregas.

### 11.3 Importar una actividad

Dentro de una asignatura, pulse `Add activity`.

Seleccione:

- ZIP de actividad;
- grupo al que se asociara.

Repository acepta actividades con `manifest.json` en la raiz del ZIP o dentro de
un unico directorio contenedor. Requiere:

- `manifest.id`;
- `manifest.title`;
- `manifest.version`;
- lista no vacia de tareas;
- IDs de tarea unicos.

Repository guarda el ZIP original, calcula checksum para deduplicacion, extrae
metadatos y crea la version de actividad correspondiente. Puede registrar
warnings no fatales, por ejemplo si faltan `starter/` o
`agent/instructions.md`.

### 11.4 Abrir una version de actividad

La vista de actividad muestra:

- identificador y version;
- descripcion;
- tareas;
- numero de entregas;
- numero de estudiantes;
- media de eventos;
- porcentaje de entregas con Git.

Tiene cuatro pestanas:

- `Submissions`;
- `Submission analysis`;
- `Dashboard`;
- `Event server`.

### 11.5 Importar entregas

En `Submissions`, pulse `Add submission`.

Seleccione:

- nombre opcional de entrega;
- ZIP de entrega;
- grupo.

Repository requiere que la entrega contenga:

```text
.vsc4education/activity-manifest.json
.vsc4education/activity-configuration.json
.vsc4education/contributions/<studentId>/
```

La actividad se empareja por `activity id` y `version`, salvo cuando la
importacion se hace explicitamente dentro de una version concreta en la UI.

Repository parsea, cuando existen:

- `profile.json`;
- `state.json`;
- `events.jsonl`;
- metadatos de tareas;
- `agent-interactions.jsonl`;
- `agent-evidence.jsonl`;
- historial Git.

Si hay varias contribuciones, importa la primera y registra un warning. La
evidencia opcional ausente se guarda como dato faltante o warning. JSON
requerido corrupto, JSONL requerido ilegible, rutas inseguras o version de
actividad incompatible deben producir errores claros.

### 11.6 Tabla de entregas

La tabla de entregas muestra:

- nombre;
- estudiante;
- enlace de descarga del ZIP original cuando esta disponible;
- grupo;
- numero de eventos;
- numero de interacciones con agente;
- disponibilidad de Git;
- numero de warnings;
- fecha de importacion.

Al pulsar una fila se abre la revision de esa entrega.

## 12. Revision de entregas en Repository

La vista de detalle de entrega contiene resumenes y cuatro pestanas:

- `Main`;
- `Agent use`;
- `Metrics`;
- `Integrity`.

### 12.1 `Main`

Muestra:

- nivel y puntuacion de agencia observable;
- confianza;
- lineas unicas tocadas;
- tiempo activo;
- estado de integridad;
- estado de tareas;
- duracion por tarea;
- guardados;
- archivos modificados;
- eventos agrupados por tipo.

### 12.2 `Agent use`

Lista conversaciones registradas en `agent-interactions.jsonl`. Puede filtrarse
por actor, agente, tarea, sesion o texto.

Si hay problemas de lectura, la UI los muestra como incidencias.

### 12.3 `Metrics`

Muestra metricas de agencia agrupadas por dimension. Para cada metrica se ve:

- numero;
- nombre;
- valor;
- fiabilidad;
- numero de evidencias;
- detalle;
- interpretacion.

Algunas metricas pueden aparecer marcadas como prioritarias.

### 12.4 `Integrity`

Muestra:

- estado de la cadena hash;
- mensaje explicativo;
- entradas verificadas;
- primera linea invalida;
- numero de lineas JSONL invalidas;
- eventos crudos filtrables.

La integridad es una senal de revision, no una sentencia automatica.

## 13. Analisis y dashboards en Repository

### 13.1 `Submission analysis`

Calcula metricas por entrega para una version de actividad. Sirve para comparar
estudiantes dentro del mismo contexto de actividad y grupo.

La vista puede mostrar:

- numero de entregas revisadas;
- entregas sin analisis completo;
- metricas por estudiante;
- senales de tareas, evidencia y agencia.

### 13.2 `Dashboard`

Agrega metricas de revision de todas las entregas de la version. Incluye:

- distribucion de agencia observable;
- distribucion de integridad;
- resumen de completitud de tareas;
- tiempo activo agregado;
- lineas unicas tocadas;
- archivos modificados;
- eventos de cambio de archivo;
- interacciones con agentes;
- mensajes de estudiantes;
- respuestas de agentes;
- media, minimo, percentiles, mediana, maximo y numero de muestras por metrica;
- warnings de entregas sin dashboard completo.

Use estos paneles para detectar patrones, outliers y entregas que merecen
revision mas cuidadosa. No los use como calificacion automatica.

## 14. Repository como servidor de eventos

Repository puede actuar opcionalmente como servidor de eventos. Esto permite que
ciertos eventos del estudiante queden anclados con una marca temporal del
servidor y una firma Ed25519 de Repository.

Para usarlo, Repository debe ser accesible desde las maquinas de estudiantes.
Una aplicacion Electron local en el ordenador del profesor normalmente no basta,
salvo que esa maquina sea accesible por red.

El flujo conceptual es:

1. Ejecutar o desplegar Repository con una `baseUrl` accesible.
2. Importar la version de actividad en Repository.
3. Crear un token de ingestion para esa version, opcionalmente asociado a un
   grupo.
4. Configurar `manifest.repository.eventServer` antes de exportar el ZIP de
   estudiante.
5. Distribuir el ZIP a estudiantes.
6. La extension de estudiante envia hashes de eventos seleccionados.
7. Repository devuelve recibos firmados.
8. La extension de estudiante almacena esos recibos dentro de la cadena local.
9. La revision verifica los recibos contra la clave publica fijada en el
   manifiesto.

Eventos anclados incluyen registro, inicio de sesion, inicio y fin de tarea,
cambio de editor activo, exportacion de entrega y una muestra aleatoria de
heartbeat por ventana de heartbeats.

Un recibo valido significa que el Repository configurado observo y firmo un hash
concreto en un instante del servidor. No prueba autoria, no garantiza que todos
los eventos existan y no impide que un cliente modificado envie datos.

## 15. Flujo recomendado para una practica

1. Crear la actividad con la extension de profesor.
2. Escribir teoria, tareas, starter e instrucciones para agentes.
3. Revisar rubricas privadas y soluciones oficiales.
4. Validar hasta eliminar errores bloqueantes.
5. Generar claves de evidencia si se requiere revision cifrada.
6. Exportar y guardar el ZIP de profesor.
7. Exportar el ZIP de estudiante.
8. Importar la actividad en Repository si se usaran cursos, grupos o dashboards.
9. Configurar el servidor de eventos antes de distribuir el ZIP si se desea
   anclaje externo.
10. Distribuir el ZIP de estudiante.
11. Recoger ZIPs de entrega.
12. Importar entregas en Repository para organizacion y analisis agregado.
13. Importar entregas en la extension de profesor cuando se necesite revision
   detallada en VS Code y feedback exportable.
14. Revisar codigo, proceso, Git, agentes, integridad y rubricas.
15. Guardar y exportar feedback.

## 16. Seguridad, privacidad y limites

Trate toda entrega como contenido no confiable.

La extension de profesor y Repository estan disenados para revisar sin ejecutar
codigo de estudiantes ni instalar sus dependencias. Mantenga esa frontera salvo
que use un entorno separado y aislado para ejecutar codigo.

Limites importantes:

- El estudiante controla su maquina, archivos, repositorio Git, reloj y VS Code
  local.
- El cifrado y la cadena hash dificultan ciertas modificaciones, pero no son
  garantias forenses.
- Los heartbeats indican presencia o huecos de actividad, no explican por que
  VS Code estuvo cerrado o inactivo.
- Los eventos no guardan contenidos completos de archivos.
- Las conversaciones con agentes dependen de que la herramienta externa siga
  `AGENTS.md`.
- La ausencia de conversaciones registradas no prueba que no haya habido ayuda
  de IA.
- Los recibos de Repository prueban observacion de hashes seleccionados, no
  autoria.
- Las metricas y comparaciones son ayudas de revision, no pruebas definitivas de
  plagio, autoria o mala conducta.

Proteja especialmente:

- paquetes de profesor;
- claves privadas;
- rubricas privadas;
- soluciones oficiales;
- bases de datos de Repository;
- ZIPs originales;
- historiales Git;
- feedback exportado;
- cualquier fichero con identificadores de estudiantes.

## 17. Resolucion de problemas

### La exportacion esta deshabilitada

Ejecute la validacion del panel y corrija los errores. Causas comunes:

- `manifest.json` mal formado;
- falta titulo o version;
- IDs de tarea duplicados;
- falta un Markdown referenciado;
- falta `starter/`;
- falta `agent/instructions.md`;
- falta rubrica o solucion de una tarea;
- la rubrica no suma la puntuacion esperada;
- una ruta intenta salir del paquete.

### Una tarea creada a mano no aparece

Use la accion de registrar tarea detectada en el panel. Revise que el archivo
este bajo `tasks/`, que siga el patron esperado y que su ID no duplique una
tarea existente.

### Una entrega no se importa

Compruebe que el ZIP fue exportado por la extension de estudiante y contiene:

```text
.vsc4education/activity-manifest.json
.vsc4education/activity-configuration.json
.vsc4education/contributions/<studentId>/
```

En Repository, compruebe tambien que `activity id` y `version` coinciden con una
version de actividad importada.

### No aparecen conversaciones con agentes

Posibles causas:

- el estudiante no uso un agente;
- el agente no siguio las instrucciones;
- el estudiante uso una herramienta fuera del flujo registrado;
- `agent-interactions.jsonl` falta o esta mal formado.

Revise el resto de evidencias antes de sacar conclusiones.

### No aparece Git

Git es evidencia opcional. Si falta `.git`, informe la ausencia de esa evidencia
segun la politica del curso, pero no lo interprete por si solo como prueba de
falta de trabajo.

### Las metricas de Repository estan incompletas

Abra los warnings de actividad o entrega. Puede faltar informacion porque la
entrega no contiene ciertas evidencias, porque hay JSONL mal formado o porque no
estan disponibles las claves necesarias para descifrar eventos.

### Los recibos del servidor de eventos no verifican

Compruebe:

- que `manifest.repository.eventServer` este configurado;
- que `expectedSigningKeyId` exista;
- que `expectedPublicKeySha256` coincida con la clave de Repository;
- que Repository fuera accesible mientras el estudiante trabajaba;
- que la entrega contenga recibos de eventos.

Un recibo ausente o invalido debe motivar revision contextual, no una penalizacion
automatica.

## 18. Documentacion relacionada

- [Project and extension specification](project-and-extensions-spec.md)
- [Activity format](activity-format.md)
- [Teacher activity authoring](teacher-activity-authoring.md)
- [Submission review](submission-review.md)
- [Repository application](repository.md)
- [Events and evidence model](events.md)
- [Security, privacy, and limitations](security-limitations.md)
- [Assessment rubric YAML](assessment-rubrics.md)
