import { ActivityManifest } from "../types/ActivityManifest";
import {
  AgencyMetric,
  AgencyMetricGroup,
  ObservableAgencyAssessment,
  ObservableAgencyDimension,
  StudentAgencyMetrics
} from "../types/AgencyMetrics";
import { Contribution } from "../types/Contribution";
import { LearningEvent } from "../types/LearningEvent";

type MetricInput = Omit<AgencyMetric, "id" | "priority">;

interface EventView {
  event: LearningEvent;
  type: string;
  time?: number;
  taskId?: string;
  file?: string;
  changeCount: number;
  lineCount: number;
  lines: number[];
}

const ACTION_EVENTS = new Set([
  "file_changed",
  "file_saved",
  "file_created",
  "file_deleted",
  "active_editor_changed",
  "task_started",
  "task_finished",
  "task_completed",
  "submission_exported"
]);

const PROTECTED_PATTERNS = [
  /^AGENTS\.md$/i,
  /^\.vsc4education[\\/]/i,
  /(^|[\\/])agent[\\/]instructions\.md$/i,
  /(^|[\\/])(state|events|agent-interactions|current-task)\.jsonl?$/i,
  /(^|[\\/])AGENTS\.generated\.md$/i
];

const VARIANT_PATTERN = /(^|[._ -])(copy|copia|backup|old|v\d+|final|prueba|\d+)([._ -]|$)/i;
const TEST_PATTERN = /(^|[\\/])(tests?|__tests__)[\\/]|(\.test|\.spec)\.[^.\\/]+$|(^|[\\/])test_[^\\/]+\.py$/i;
const TEST_TASK_PATTERN = /(test|prueba|testing|validacion|validation)/i;
const PROTECTED_EDIT_WINDOW_MS = 10 * 60 * 1000;

export class AgencyMetricsService {
  calculate(contribution: Contribution, manifest: ActivityManifest): StudentAgencyMetrics {
    const events = contribution.events.map((event) => this.view(event));
    const sorted = events
      .filter((event): event is EventView & { time: number } => Number.isFinite(event.time))
      .sort((a, b) => a.time - b.time);
    const workEvents = events.filter((event) => !event.file || this.isWorkSourceFile(event.file));
    const workFileEvents = events.filter((event) => event.file && this.isWorkSourceFile(event.file));
    const filesChanged = new Set(this.byType(workFileEvents, "file_changed").map((event) => event.file).filter(Boolean) as string[]);
    const filesSaved = new Set(this.byType(workFileEvents, "file_saved").map((event) => event.file).filter(Boolean) as string[]);
    const filesConsulted = new Set(this.byType(workFileEvents, "active_editor_changed").map((event) => event.file).filter(Boolean) as string[]);
    const expectedFiles = new Set(
      (manifest.tasks ?? [])
        .map((task) => task.file)
        .filter((file): file is string => typeof file === "string")
        .map((file) => this.normalizePath(file))
        .filter((file) => this.isWorkSourceFile(file))
    );
    const protectedEditSequences = this.protectedEditSequences(events);
    const outsideSrcEvents = events.filter((event) => event.file && !this.isWorkSourceFile(event.file) && ACTION_EVENTS.has(event.type));
    const heartbeat = this.count(events, "heartbeat");
    const actions = workEvents.filter((event) => ACTION_EVENTS.has(event.type));
    const fileChanges = this.byType(workFileEvents, "file_changed");
    const effectiveChanges = fileChanges.filter((event) => event.changeCount > 0 || event.lineCount > 0);
    const saves = this.byType(workFileEvents, "file_saved");
    const created = this.byType(workFileEvents, "file_created");
    const deleted = this.byType(workFileEvents, "file_deleted");
    const exports = this.byType(events, "submission_exported").filter((event) => Number.isFinite(event.time));
    const taskStarts = events.filter((event) => event.type === "task_started" && event.taskId && Number.isFinite(event.time));
    const taskFinishes = events.filter((event) => this.isTaskFinished(event.type) && event.taskId && Number.isFinite(event.time));
    const firstTime = sorted[0]?.time;
    const lastTime = sorted[sorted.length - 1]?.time;
    const sessionMinutes = this.minutesBetween(firstTime, lastTime);
    const observableMinutes = this.observableMinutes(sorted);
    const totalLineTouches = fileChanges.reduce((sum, event) => sum + event.lineCount, 0);
    const lineVisits = this.lineVisits(fileChanges);
    const uniqueLineCount = lineVisits.size;
    const lineRepeats = Array.from(lineVisits.values()).filter((count) => count > 1).length;
    const changeVolume = fileChanges.reduce((sum, event) => sum + event.changeCount, 0);
    const fileChangeDistribution = this.countBy(fileChanges, (event) => event.file ?? "-");
    const topFileCount = Math.max(0, ...Array.from(fileChangeDistribution.values()));
    const taskDurations = this.taskDurations(events, taskStarts, taskFinishes);
    const activePauses = this.pauses(sorted.filter((event) => event.type !== "heartbeat"));
    const changeWindows = this.windowCounts(fileChanges, 60_000);
    const expectedTouched = Array.from(expectedFiles).filter((file) => filesChanged.has(file));
    const actionsByTask = this.countBy(actions, (event) => event.taskId ?? "outside task");
    const changesAfterFinish = this.changesAfterTaskFinish(fileChanges, taskFinishes);
    const offTaskAfterStart = this.offTaskAfterStart(events, taskStarts);
    const changesAfterExport = this.afterLast(exports, workFileEvents.filter((event) => ["file_changed", "file_saved", "file_created"].includes(event.type)));
    const massiveChanges = fileChanges.filter((event) => event.lineCount > 20 || event.changeCount > 20);
    const incrementalChanges = effectiveChanges.filter((event) => event.changeCount <= 1 && event.lineCount > 0 && event.lineCount <= 3);
    const readEditCycles = this.readEditCycles(events);
    const reopenCount = this.reopenModifiedFiles(events);
    const refinementBlocks = this.refinementBlocks(fileChanges);
    const testActivity = workFileEvents.filter((event) => event.file && TEST_PATTERN.test(event.file) && ACTION_EVENTS.has(event.type));
    const testingTaskActivity = events.filter((event) => event.taskId && TEST_TASK_PATTERN.test(event.taskId) && ACTION_EVENTS.has(event.type));
    const systemicEvents = events.filter(
      (event) =>
        event.type === "heartbeat" ||
        event.type === "agents_file_restored" ||
        protectedEditSequences.some((sequence) => sequence.change === event || sequence.opened === event) ||
        (event.type === "file_changed" && event.changeCount === 0 && event.lineCount === 0)
    );
    const hashDiscontinuities = this.hashDiscontinuities(contribution.events);
    const temporalGaps = activePauses.filter((gap) => gap >= 15).length;
    const sequenceScore = this.sequenceScore(events);
    const traceabilityScore = this.traceabilityScore({
      changedFiles: filesChanged.size,
      savedTouchedFiles: Array.from(filesChanged).filter((file) => filesSaved.has(file)).length,
      tasksStarted: taskStarts.length,
      tasksFinished: taskFinishes.length,
      exports: exports.length,
      hashDiscontinuities
    });

    const groups: AgencyMetricGroup[] = [
      this.group("Presencia y continuidad", [
        this.metric(1, false, "Tiempo total de sesion", this.round(sessionMinutes), "min", "Primer evento hasta ultimo evento.", "Duracion bruta del registro; no equivale por si sola a trabajo efectivo.", sorted.length, "direct"),
        this.metric(2, true, "Tiempo activo dentro de tareas", this.round(this.sum(taskDurations.map((task) => task.minutes))), "min", this.taskDurationDetail(taskDurations), "Tiempo entre inicio y cierre de tarea, estimado hasta el ultimo evento de la tarea si falta cierre.", taskDurations.length, taskDurations.some((task) => task.estimated) ? "estimated" : "direct"),
        this.metric(3, true, "Tiempo con actividad observable", this.round(observableMinutes), "min", "Ventanas de 3 minutos con al menos una accion no pasiva.", "Filtra periodos donde solo hay heartbeat o presencia pasiva.", actions.length, "estimated"),
        this.metric(4, true, "Ratio de actividad efectiva", this.ratio(actions.length, heartbeat), undefined, "Acciones observables divididas por heartbeat.", "Un valor alto sugiere interaccion activa frente a presencia pasiva.", actions.length, "direct")
      ]),
      this.group("Intensidad de edicion", [
        this.metric(5, true, "Densidad de edicion en src", this.ratio(fileChanges.length, observableMinutes), "cambios/min", "Eventos file_changed bajo src/ por minuto observable.", "Densidades extremas requieren revisar si hubo pegado, formato automatico o bloqueo.", fileChanges.length, "estimated"),
        this.metric(6, true, "Proporcion de cambios efectivos en src", this.percent(effectiveChanges.length, fileChanges.length), "%", "file_changed bajo src/ con changeCount o lineas sobre total file_changed en src/.", "Distingue cambios materiales de ruido tecnico del editor.", effectiveChanges.length, "direct"),
        this.metric(7, true, "Volumen total de cambios en src", changeVolume, undefined, "Suma de data.changeCount en file_changed bajo src/.", "Volumen bruto; debe interpretarse junto con lineas y ritmo.", fileChanges.length, "direct"),
        this.metric(8, false, "Lineas afectadas totales en src", totalLineTouches, undefined, "Suma de rangos data.lines en src/.", "Aproxima alcance textual, contando repeticiones.", fileChanges.length, "direct"),
        this.metric(9, true, "Lineas unicas modificadas en src", uniqueLineCount, undefined, "Lineas archivo:numero distintas en rangos de cambio bajo src/.", "Evita contar varias visitas a la misma linea.", uniqueLineCount, "direct"),
        this.metric(10, true, "Dispersion de lineas modificadas en src", this.round(this.average(this.lineDispersions(fileChanges))), "lineas", "Promedio por archivo bajo src/ de max(linea)-min(linea)+1.", "Indica si la edicion se reparte o queda localizada.", uniqueLineCount, "estimated")
      ]),
      this.group("Relevancia de la intervencion", [
        this.metric(11, false, "Concentracion de edicion por archivo", this.percent(topFileCount, fileChanges.length), "%", this.topFileDetail(fileChangeDistribution), "Muestra si el esfuerzo se concentra en un archivo dominante.", fileChanges.length, "direct"),
        this.metric(12, true, "Cobertura de archivos esperados", expectedFiles.size ? this.percent(expectedTouched.length, expectedFiles.size) : "n/d", expectedFiles.size ? "%" : undefined, expectedFiles.size ? `${expectedTouched.length}/${expectedFiles.size} archivos de tareas modificados.` : "El manifiesto no declara task.file para estimar cobertura.", "Una cobertura baja puede ser incompletitud o una estrategia alternativa valida.", expectedTouched.length, expectedFiles.size ? "direct" : "limited"),
        this.metric(13, true, "Actividad fuera de src o no esperada", outsideSrcEvents.length + this.nonExpectedEvents(workFileEvents, expectedFiles).length, undefined, "Acciones sobre rutas fuera de src/ o fuera de task.file cuando existe esa lista.", "Indicador de revision contextual; no suma como trabajo efectivo.", outsideSrcEvents.length, expectedFiles.size ? "estimated" : "limited")
      ]),
      this.group("Exploracion y toma de decisiones", [
        this.metric(14, true, "Numero de archivos creados", created.length, undefined, "count(file_created).", "Crear archivos puede indicar exploracion, estructuracion o pruebas alternativas.", created.length, "direct"),
        this.metric(15, true, "Creacion de variantes o copias", created.filter((event) => event.file && VARIANT_PATTERN.test(event.file)).length, undefined, "file_created con nombres tipo copy, copia, backup, old, v2, final o prueba.", "Puede senalar exploracion o incertidumbre segun volumen y contexto.", created.length, "estimated"),
        this.metric(16, false, "Numero de archivos eliminados", deleted.length, undefined, "count(file_deleted).", "Puede reflejar limpieza o descarte; revisar si afecta a archivos protegidos.", deleted.length, "direct")
      ]),
      this.group("Gestion del proceso", [
        this.metric(18, true, "Guardados por tarea", this.round(this.averageByTask(saves)), undefined, this.mapDetail(this.countBy(saves, (event) => event.taskId ?? "outside task")), "Muchos guardados pueden indicar ciclos incrementales; cero puede depender de autoguardado.", saves.length, "direct"),
        this.metric(19, true, "Ratio cambios por guardado", this.ratio(effectiveChanges.length, saves.length), undefined, "file_changed efectivos dividido por file_saved.", "Relaciona edicion con persistencia.", effectiveChanges.length + saves.length, "direct"),
        this.metric(20, true, "Tiempo hasta el primer cambio", this.round(this.firstLatency(taskStarts, fileChanges)), "min", "Primer file_changed posterior a task_started.", "Latencia alta puede ser lectura, planificacion o bloqueo.", fileChanges.length, taskStarts.length ? "direct" : "limited"),
        this.metric(21, false, "Tiempo hasta el primer guardado", this.round(this.firstLatency(taskStarts, saves)), "min", "Primer file_saved posterior a task_started.", "Indica primer hito persistido cuando hay guardados explicitos.", saves.length, taskStarts.length ? "direct" : "limited"),
        this.metric(25, false, "Finalizacion explicita de tareas", this.percent(taskFinishes.length, taskStarts.length), "%", `${taskFinishes.length}/${Math.max(1, taskStarts.length)} tareas iniciadas tienen cierre.`, "Senal de control del flujo pedagogico.", taskStarts.length + taskFinishes.length, "direct"),
        this.metric(26, false, "Duracion relativa por tarea", this.taskShare(taskDurations), undefined, "Porcentaje del tiempo de tarea por taskId.", "Detecta desequilibrios o tareas cerradas sin tiempo observable.", taskDurations.length, taskDurations.some((task) => task.estimated) ? "estimated" : "direct"),
        this.metric(27, false, "Actividad por tarea", this.mapDetail(actionsByTask), undefined, "Acciones agrupadas por taskId.", "Tareas con cierre formal pero sin accion visible requieren revision.", actions.length, "direct"),
        this.metric(28, false, "Cambios posteriores a la finalizacion de tarea", changesAfterFinish, undefined, "file_changed posteriores a task_finished/task_completed del mismo taskId.", "Puede indicar revision posterior o desalineacion del flujo.", changesAfterFinish, "estimated"),
        this.metric(29, false, "Actividad fuera de tarea", this.percent(offTaskAfterStart.offTask, offTaskAfterStart.total), "%", `${offTaskAfterStart.offTask}/${Math.max(1, offTaskAfterStart.total)} eventos accionables tras iniciar tareas no tienen taskId.`, "Ayuda a reconstruir trabajo libre o fuera del tracker.", offTaskAfterStart.offTask, "direct")
      ]),
      this.group("Control de entrega", [
        this.metric(22, false, "Latencia entre ultimo cambio y entrega", this.round(this.lastChangeToExportLatency(fileChanges, exports)), "min", "submission_exported menos ultimo file_changed anterior.", "Margen de revision antes de entregar.", exports.length, exports.length && fileChanges.length ? "direct" : "limited"),
        this.metric(23, false, "Numero de exportaciones de entrega", exports.length, undefined, "count(submission_exported).", "Varias exportaciones pueden indicar iteracion o pruebas administrativas.", exports.length, "direct"),
        this.metric(24, true, "Actividad entre exportaciones", this.activityBetweenExports(events, exports), undefined, "Acciones entre pares consecutivos de submission_exported.", "Cambios entre exportaciones sugieren refinamiento posterior.", exports.length, exports.length > 1 ? "direct" : "limited"),
        this.metric(30, true, "Cambios posteriores a la entrega", changesAfterExport, undefined, "Cambios, guardados o creaciones tras la ultima exportacion registrada.", "Puede indicar que la ultima version del workspace no coincide con la entrega exportada.", changesAfterExport, exports.length ? "direct" : "limited"),
        this.metric(31, false, "Secuencia edicion-guardado-finalizacion-exportacion", this.percent(sequenceScore, 1), "%", "Comprueba que existan cambios antes de guardado, cierre y exportacion en orden.", "Secuencia ordenada sugiere control del proceso.", actions.length, "estimated"),
        this.metric(50, false, "Indice de trazabilidad de la entrega", this.percent(traceabilityScore, 1), "%", "Combina archivos cambiados, guardados, cierres, exportacion e integridad hash.", "Resume cuan explicable es la entrega final desde el log.", events.length, "estimated")
      ]),
      this.group("Patrones de edicion", [
        this.metric(32, false, "Cambios masivos repentinos", massiveChanges.length, undefined, "file_changed con mas de 20 lineas o changeCount mayor a 20.", "Senal para revisar pegado, formateo, generacion o reemplazos amplios.", massiveChanges.length, "estimated"),
        this.metric(33, false, "Indice de edicion incremental", this.percent(incrementalChanges.length, effectiveChanges.length), "%", "Cambios pequenos sobre cambios efectivos.", "Compatible con construccion paso a paso cuando es alto.", incrementalChanges.length, "estimated"),
        this.metric(34, false, "Ritmo de edicion por ventanas temporales", this.windowDetail(changeWindows), undefined, "file_changed agrupado por ventanas de 1 minuto.", "Picos breves e intensos merecen revision contextual.", fileChanges.length, "estimated"),
        this.metric(35, false, "Pausas entre acciones activas", this.pauseDetail(activePauses), undefined, "Diferencias entre acciones no-heartbeat.", "Las pausas pueden ser lectura, consulta, bloqueo o trabajo externo.", activePauses.length, "direct")
      ]),
      this.group("Exploracion y lectura", [
        this.metric(36, false, "Alternancia lectura-edicion", readEditCycles, undefined, "active_editor_changed seguido por file_changed del mismo archivo en menos de 10 minutos.", "Sugiere lectura o inspeccion antes de editar.", readEditCycles, "estimated"),
        this.metric(37, true, "Numero de archivos consultados", filesConsulted.size, undefined, "Archivos distintos en active_editor_changed.", "Mide amplitud de exploracion del proyecto.", filesConsulted.size, "direct"),
        this.metric(38, false, "Ratio archivos consultados sobre modificados", this.ratio(filesConsulted.size, filesChanged.size), undefined, "Archivos consultados dividido por archivos modificados.", "Valores altos sugieren busqueda de contexto o exploracion dispersa.", filesConsulted.size + filesChanged.size, "direct")
      ]),
      this.group("Iteracion y refinamiento", [
        this.metric(39, false, "Reapertura de archivos modificados", reopenCount, undefined, "Vuelta a archivos ya editados tras foco en otros archivos.", "Compatible con revision, depuracion o refinamiento.", reopenCount, "estimated"),
        this.metric(40, true, "Profundidad de refinamiento por archivo", this.refinementDetail(refinementBlocks), undefined, "Bloques separados de edicion por archivo.", "Varios ciclos sobre el mismo archivo sugieren iteracion.", fileChanges.length, "estimated"),
        this.metric(41, false, "Revision de mismas lineas", this.percent(lineRepeats, uniqueLineCount), "%", "Lineas unicas tocadas dos o mas veces.", "Puede indicar ajuste conceptual, depuracion o dificultad localizada.", lineRepeats, "direct")
      ]),
      this.group("Validacion y pruebas", [
        this.metric(43, false, "Actividad sobre tests", testActivity.length, undefined, "Acciones sobre rutas de tests o archivos *.test/*.spec/test_*.py.", "Indica trabajo orientado a comprobar la solucion cuando aplica.", testActivity.length, "estimated"),
        this.metric(44, false, "Actividad asociada a tarea de pruebas", testingTaskActivity.length, undefined, "Acciones en taskId relacionado con pruebas o validacion.", "Mide actividad visible en tareas de verificacion.", testingTaskActivity.length, "estimated")
      ]),
      this.group("Autonomia frente al sistema", [
        this.metric(17, false, "Restauraciones automaticas del sistema", this.count(events, "agents_file_restored"), undefined, "count(agents_file_restored).", "Valores altos sugieren conflicto con archivos gestionados o reglas del entorno.", this.count(events, "agents_file_restored"), "direct"),
        this.metric(45, false, "Indice de autonomia de edicion", this.percent(this.autonomyActions(events), Math.max(1, events.length - heartbeat)), "%", "Acciones directas observables sobre eventos no-heartbeat.", "Separa interaccion humana observable de ruido sistemico.", events.length, "estimated"),
        this.metric(46, false, "Indice de dependencia sistemica", this.percent(systemicEvents.length, events.length), "%", "Heartbeat, restauraciones, protegidos o cambios sin efecto sobre total eventos.", "Si es alto, conviene filtrar antes de interpretar agencia.", systemicEvents.length, "estimated")
      ]),
      this.group("Integridad y cumplimiento", [
        this.metric(47, false, "Secuencias sospechosas sobre archivos protegidos", protectedEditSequences.length, undefined, this.protectedEditDetail(protectedEditSequences), "Apertura de archivo protegido seguida por cambio/guardado dentro de una ventana sospechosa. Indicador de revision, nunca acusacion automatica.", protectedEditSequences.length, "estimated"),
        this.metric(48, true, "Integridad de la cadena hash", hashDiscontinuities === 0 ? "continua" : `${hashDiscontinuities} discontinuidades`, undefined, "Comprueba previousHash contra hash anterior.", "Afecta la confianza en la trazabilidad del log.", contribution.events.length, "direct"),
        this.metric(49, false, "Discontinuidades temporales", temporalGaps, undefined, "Pausas de 15 minutos o mas entre acciones no-heartbeat.", "Ayuda a no sobreinterpretar ausencia de eventos.", temporalGaps, "direct")
      ]),
      this.group("Relevancia avanzada", [
        this.metric(42, false, "Cambios distribuidos en zonas funcionales", this.functionalZones(fileChanges), undefined, "Estimacion por zonas de 50 lineas; no parsea semantica del codigo.", "Aproxima distribucion funcional cuando no hay analizador de lenguaje.", uniqueLineCount, "limited")
      ])
    ];

    return {
      studentId: contribution.studentId,
      groups,
      observableAgency: this.observableAgency(groups)
    };
  }

  private observableAgency(groups: AgencyMetricGroup[]): ObservableAgencyAssessment {
    const byId = new Map<number, AgencyMetric>();
    groups.forEach((group) =>
      group.metrics.forEach((metric) => byId.set(metric.id, metric))
    );
    const metric = (id: number): AgencyMetric | undefined => byId.get(id);
    const value = (id: number): number | undefined => this.numericValue(metric(id)?.value);
    const dimension = (
      name: string,
      weight: number,
      parts: Array<[number, string]>
    ): ObservableAgencyDimension => {
      const usable = parts.filter(([score]) => Number.isFinite(score));
      const score = usable.length
        ? this.round(this.average(usable.map(([score]) => score)))
        : 0;
      return { name, score, weight, evidence: usable.map(([, text]) => text) };
    };

    const dimensions = [
      dimension("Continuidad", 20, [
        [this.cap(value(2), 30), this.evidence(metric(2))],
        [this.cap(value(3), 30), this.evidence(metric(3))],
        [this.cap(value(4), 1), this.evidence(metric(4))],
        [this.inverseCount(value(49), 3), this.evidence(metric(49))]
      ]),
      dimension("Edicion efectiva", 25, [
        [this.percentScore(value(6)), this.evidence(metric(6))],
        [this.cap(value(9), 20), this.evidence(metric(9))],
        [this.cap(value(7), 30), this.evidence(metric(7))],
        [this.band(value(5), 0.1, 4), this.evidence(metric(5))],
        [this.percentScore(value(33)), this.evidence(metric(33))]
      ]),
      dimension("Relevancia", 20, [
        [this.percentOrNeutral(metric(12)), this.evidence(metric(12))],
        [this.inverseCount(value(13), 8), this.evidence(metric(13))],
        [this.inversePercent(value(11), 100), this.evidence(metric(11))],
        [this.cap(this.leadingNumber(metric(42)?.value), 4), this.evidence(metric(42))]
      ]),
      dimension("Gestion del proceso", 15, [
        [this.cap(value(18), 3), this.evidence(metric(18))],
        [this.band(value(19), 0.5, 8), this.evidence(metric(19))],
        [this.percentScore(value(25)), this.evidence(metric(25))],
        [this.inversePercent(value(29), 100), this.evidence(metric(29))],
        [this.percentScore(value(31)), this.evidence(metric(31))],
        [this.percentScore(value(50)), this.evidence(metric(50))]
      ]),
      dimension("Iteracion y refinamiento", 10, [
        [this.cap(value(36), 4), this.evidence(metric(36))],
        [this.cap(value(37), 5), this.evidence(metric(37))],
        [this.cap(value(39), 3), this.evidence(metric(39))],
        [this.cap(this.maxNumber(metric(40)?.value), 4), this.evidence(metric(40))],
        [this.band(value(41), 5, 45), this.evidence(metric(41))]
      ]),
      dimension("Validacion y entrega", 10, [
        [this.cap(value(43), 3), this.evidence(metric(43))],
        [this.cap(value(44), 3), this.evidence(metric(44))],
        [this.band(value(22), 1, 60), this.evidence(metric(22))],
        [this.cap(value(23), 1), this.evidence(metric(23))],
        [this.cap(value(24), 5), this.evidence(metric(24))]
      ])
    ];

    const weighted = dimensions.reduce(
      (total, item) => total + item.score * item.weight,
      0
    );
    const totalWeight = this.sum(dimensions.map((item) => item.weight));
    const penalty = this.penalty(byId);
    const score = Math.max(0, Math.min(100, this.round(weighted / totalWeight - penalty)));
    const strengths = dimensions
      .filter((item) => item.score >= 70)
      .map((item) => `${item.name}: ${item.score}/100`);
    const flags = this.metaFlags(byId, dimensions, penalty);

    return {
      score,
      level: this.agencyLevel(score),
      confidence: this.confidence(Array.from(byId.values())),
      dimensions,
      strengths,
      flags
    };
  }

  private agencyLevel(
    score: number
  ): ObservableAgencyAssessment["level"] {
    if (score >= 85) return "muy alta";
    if (score >= 65) return "alta";
    if (score >= 40) return "media";
    if (score >= 15) return "baja";
    return "insuficiente";
  }

  private confidence(metrics: AgencyMetric[]): ObservableAgencyAssessment["confidence"] {
    const evidence = this.sum(metrics.map((metric) => metric.evidenceCount));
    const limited = metrics.filter((metric) => metric.reliability === "limited").length;
    const direct = metrics.filter((metric) => metric.reliability === "direct").length;
    const hash = metrics.find((metric) => metric.id === 48)?.value;
    if (evidence >= 30 && direct >= limited && hash === "continua") return "alta";
    if (evidence >= 10 && limited < metrics.length / 2) return "media";
    return "limitada";
  }

  private penalty(metrics: Map<number, AgencyMetric>): number {
    const value = (id: number): number | undefined => this.numericValue(metrics.get(id)?.value);
    let penalty = 0;
    penalty += Math.min(12, (value(30) ?? 0) * 3);
    penalty += Math.min(12, (value(32) ?? 0) * 2);
    penalty += Math.min(10, (value(47) ?? 0) * 3);
    penalty += Math.min(10, (value(49) ?? 0) * 2);
    const systemic = value(46);
    if (systemic !== undefined && systemic > 50) penalty += 8;
    const integrity = metrics.get(48)?.value;
    if (typeof integrity === "string" && integrity !== "continua") penalty += 10;
    return penalty;
  }

  private metaFlags(
    metrics: Map<number, AgencyMetric>,
    dimensions: ObservableAgencyDimension[],
    penalty: number
  ): string[] {
    const flags: string[] = [];
    const value = (id: number): number | undefined => this.numericValue(metrics.get(id)?.value);
    dimensions
      .filter((dimension) => dimension.score < 40)
      .forEach((dimension) =>
        flags.push(`${dimension.name} con evidencia debil (${dimension.score}/100)`)
      );
    if ((value(30) ?? 0) > 0) flags.push("Hay cambios posteriores a la entrega registrada");
    if ((value(32) ?? 0) > 0) flags.push("Hay cambios masivos repentinos para revisar en contexto");
    if ((value(47) ?? 0) > 0) flags.push("Hay actividad sobre archivos protegidos o internos");
    if ((value(49) ?? 0) > 0) flags.push("Hay discontinuidades temporales relevantes");
    const integrity = metrics.get(48)?.value;
    if (typeof integrity === "string" && integrity !== "continua") {
      flags.push("La cadena hash no es continua");
    }
    if (penalty > 0) flags.push(`Penalizacion contextual aplicada: ${this.round(penalty)} puntos`);
    return flags;
  }

  private evidence(metric: AgencyMetric | undefined): string {
    if (!metric) return "Metrica no disponible.";
    const unit = metric.unit ? ` ${metric.unit}` : "";
    return `${metric.name}: ${metric.value}${unit}`;
  }

  private numericValue(value: AgencyMetric["value"] | undefined): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private leadingNumber(value: AgencyMetric["value"] | undefined): number | undefined {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return undefined;
    const match = value.match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : undefined;
  }

  private maxNumber(value: AgencyMetric["value"] | undefined): number | undefined {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return undefined;
    const numbers = Array.from(value.matchAll(/-?\d+(\.\d+)?/g)).map((match) =>
      Number(match[0])
    );
    return numbers.length ? Math.max(...numbers) : undefined;
  }

  private cap(value: number | undefined, fullScoreAt: number): number {
    if (value === undefined) return 0;
    return Math.max(0, Math.min(100, (value / Math.max(1, fullScoreAt)) * 100));
  }

  private percentScore(value: number | undefined): number {
    if (value === undefined) return 0;
    return Math.max(0, Math.min(100, value));
  }

  private inverseCount(value: number | undefined, zeroAt: number): number {
    if (value === undefined) return 100;
    return Math.max(0, Math.min(100, 100 - (value / Math.max(1, zeroAt)) * 100));
  }

  private inversePercent(value: number | undefined, zeroAt: number): number {
    if (value === undefined) return 50;
    return Math.max(0, Math.min(100, 100 - (value / Math.max(1, zeroAt)) * 100));
  }

  private percentOrNeutral(metric: AgencyMetric | undefined): number {
    if (!metric) return 50;
    if (metric.reliability === "limited") return 55;
    return this.percentScore(this.numericValue(metric.value));
  }

  private band(value: number | undefined, low: number, high: number): number {
    if (value === undefined) return 0;
    if (value < low) return Math.max(0, (value / Math.max(low, 0.1)) * 70);
    if (value <= high) return 100;
    return Math.max(0, 100 - ((value - high) / Math.max(high, 1)) * 60);
  }

  private view(event: LearningEvent): EventView {
    const type = typeof event.type === "string" ? event.type : typeof event.event === "string" ? event.event : "event";
    const file = this.eventFile(event);
    const lines = this.eventLines(event);
    const changeCount = typeof event.data?.changeCount === "number" ? event.data.changeCount : lines.length ? lines.length : 0;
    const time = Date.parse(String(event.timestamp ?? ""));
    return {
      event,
      type,
      time: Number.isFinite(time) ? time : undefined,
      taskId: typeof event.taskId === "string" ? event.taskId : undefined,
      file,
      changeCount,
      lineCount: lines.length,
      lines
    };
  }

  private metric(id: number, priority: boolean, name: string, value: MetricInput["value"], unit: MetricInput["unit"], detail: string, interpretation: string, evidenceCount: number, reliability: AgencyMetric["reliability"]): AgencyMetric {
    return { id, priority, name, value, unit, detail, interpretation, evidenceCount, reliability };
  }

  private group(dimension: string, metrics: AgencyMetric[]): AgencyMetricGroup {
    return { dimension, metrics };
  }

  private eventFile(event: LearningEvent): string | undefined {
    if (typeof event.file === "string") return this.normalizePath(event.file);
    return typeof event.data?.file === "string" ? this.normalizePath(event.data.file) : undefined;
  }

  private eventLines(event: LearningEvent): number[] {
    const raw = event.data?.lines;
    if (!Array.isArray(raw)) return [];
    const lines = new Set<number>();
    for (const range of raw) {
      if (typeof range !== "object" || range === null) continue;
      const start = (range as { start?: unknown }).start;
      const end = (range as { end?: unknown }).end;
      if (typeof start !== "number" || typeof end !== "number") continue;
      for (let line = Math.min(start, end); line <= Math.max(start, end); line += 1) {
        lines.add(line);
      }
    }
    return Array.from(lines);
  }

  private byType(events: EventView[], type: string): EventView[] {
    return events.filter((event) => event.type === type);
  }

  private count(events: EventView[], type: string): number {
    return this.byType(events, type).length;
  }

  private countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
    const result = new Map<string, number>();
    for (const item of items) {
      const value = key(item);
      result.set(value, (result.get(value) ?? 0) + 1);
    }
    return result;
  }

  private isTaskFinished(type: string): boolean {
    return type === "task_finished" || type === "task_completed";
  }

  private isProtected(file: string): boolean {
    return PROTECTED_PATTERNS.some((pattern) => pattern.test(file));
  }

  private isWorkSourceFile(file: string): boolean {
    return this.normalizePath(file).startsWith("src/");
  }

  private normalizePath(file: string): string {
    return file.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  private protectedEditSequences(
    events: EventView[]
  ): { opened: EventView; change: EventView; file: string }[] {
    const ordered = events
      .filter((event): event is EventView & { time: number } => Number.isFinite(event.time))
      .sort((a, b) => a.time - b.time);
    const sequences: { opened: EventView; change: EventView; file: string }[] = [];
    let protectedOpen: (EventView & { time: number; file: string }) | undefined;
    for (const event of ordered) {
      if (event.type === "active_editor_changed" && event.file) {
        protectedOpen = this.isProtected(event.file)
          ? (event as EventView & { time: number; file: string })
          : undefined;
        continue;
      }
      if (
        protectedOpen &&
        ["file_changed", "file_saved", "file_created", "file_deleted"].includes(event.type) &&
        event.time - protectedOpen.time <= PROTECTED_EDIT_WINDOW_MS &&
        (!event.file || event.file === protectedOpen.file)
      ) {
        sequences.push({ opened: protectedOpen, change: event, file: protectedOpen.file });
        protectedOpen = undefined;
      }
      if (protectedOpen && event.time - protectedOpen.time > PROTECTED_EDIT_WINDOW_MS) {
        protectedOpen = undefined;
      }
    }
    return sequences;
  }

  private protectedEditDetail(
    sequences: { opened: EventView; change: EventView; file: string }[]
  ): string {
    if (!sequences.length) {
      return "No hay apertura de archivo protegido seguida por cambio/guardado sospechoso.";
    }
    return sequences
      .map((sequence) => `${sequence.file}: ${sequence.opened.type} -> ${sequence.change.type}`)
      .join("; ");
  }

  private minutesBetween(start?: number, end?: number): number {
    return start !== undefined && end !== undefined && end >= start ? (end - start) / 60_000 : 0;
  }

  private observableMinutes(events: EventView[]): number {
    const windows = new Set<number>();
    for (const event of events) {
      if (event.time !== undefined && ACTION_EVENTS.has(event.type)) {
        windows.add(Math.floor(event.time / (3 * 60_000)));
      }
    }
    return windows.size * 3;
  }

  private ratio(numerator: number, denominator: number): number {
    return this.round(numerator / Math.max(1, denominator));
  }

  private percent(numerator: number, denominator: number): number {
    return this.round((numerator / Math.max(1, denominator)) * 100);
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
  }

  private average(values: number[]): number {
    return values.length ? this.sum(values) / values.length : 0;
  }

  private lineVisits(events: EventView[]): Map<string, number> {
    const visits = new Map<string, number>();
    for (const event of events) {
      if (!event.file) continue;
      for (const line of event.lines) {
        const key = `${event.file}:${line}`;
        visits.set(key, (visits.get(key) ?? 0) + 1);
      }
    }
    return visits;
  }

  private lineDispersions(events: EventView[]): number[] {
    const byFile = new Map<string, number[]>();
    for (const event of events) {
      if (!event.file || !event.lines.length) continue;
      byFile.set(event.file, [...(byFile.get(event.file) ?? []), ...event.lines]);
    }
    return Array.from(byFile.values()).map((lines) => Math.max(...lines) - Math.min(...lines) + 1);
  }

  private topFileDetail(distribution: Map<string, number>): string {
    const [file, count] = Array.from(distribution.entries()).sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];
    return count ? `${file}: ${count} eventos file_changed.` : "No hay file_changed con archivo.";
  }

  private taskDurations(events: EventView[], starts: EventView[], finishes: EventView[]): { taskId: string; minutes: number; estimated: boolean }[] {
    return starts.map((start) => {
      const finish = finishes.find((item) => item.taskId === start.taskId && item.time !== undefined && start.time !== undefined && item.time >= start.time);
      const lastTaskEvent = [...events].reverse().find((item) => item.taskId === start.taskId && item.time !== undefined);
      const end = finish?.time ?? lastTaskEvent?.time ?? start.time;
      return {
        taskId: start.taskId ?? "-",
        minutes: this.minutesBetween(start.time, end),
        estimated: !finish
      };
    });
  }

  private taskDurationDetail(values: { taskId: string; minutes: number; estimated: boolean }[]): string {
    return values.length ? values.map((item) => `${item.taskId}: ${this.round(item.minutes)} min${item.estimated ? " estimado" : ""}`).join("; ") : "No hay task_started con timestamp.";
  }

  private averageByTask(events: EventView[]): number {
    const byTask = this.countBy(events, (event) => event.taskId ?? "outside task");
    return this.average(Array.from(byTask.values()));
  }

  private firstLatency(starts: EventView[], targets: EventView[]): number {
    const latencies = starts
      .map((start) => {
        const target = targets.find((item) => item.time !== undefined && start.time !== undefined && item.time >= start.time && (!start.taskId || !item.taskId || item.taskId === start.taskId));
        return target ? this.minutesBetween(start.time, target.time) : undefined;
      })
      .filter((value): value is number => value !== undefined);
    return latencies.length ? Math.min(...latencies) : 0;
  }

  private mapDetail(values: Map<string, number>): string {
    return Array.from(values.entries()).map(([key, value]) => `${key}: ${value}`).join("; ") || "Sin eventos.";
  }

  private taskShare(values: { taskId: string; minutes: number }[]): string {
    const total = Math.max(1, this.sum(values.map((item) => item.minutes)));
    return values.length ? values.map((item) => `${item.taskId}: ${this.percent(item.minutes, total)}%`).join("; ") : "Sin duraciones de tarea.";
  }

  private changesAfterTaskFinish(changes: EventView[], finishes: EventView[]): number {
    return changes.filter((change) =>
      finishes.some((finish) => finish.taskId === change.taskId && change.time !== undefined && finish.time !== undefined && change.time > finish.time)
    ).length;
  }

  private offTaskAfterStart(events: EventView[], starts: EventView[]): { offTask: number; total: number } {
    const firstStart = Math.min(...starts.map((event) => event.time ?? Number.POSITIVE_INFINITY));
    const scoped = events.filter((event) => event.time !== undefined && event.time >= firstStart && event.type !== "heartbeat");
    return { offTask: scoped.filter((event) => !event.taskId).length, total: scoped.length };
  }

  private lastChangeToExportLatency(changes: EventView[], exports: EventView[]): number {
    const exportEvent = exports[exports.length - 1];
    const exportTime = exportEvent?.time;
    if (exportTime === undefined) return 0;
    const previousChange = [...changes].reverse().find((event) => event.time !== undefined && event.time <= exportTime);
    return previousChange ? this.minutesBetween(previousChange.time, exportTime) : 0;
  }

  private activityBetweenExports(events: EventView[], exports: EventView[]): number {
    let count = 0;
    for (let index = 1; index < exports.length; index += 1) {
      const start = exports[index - 1].time;
      const end = exports[index].time;
      count += events.filter((event) => event.time !== undefined && start !== undefined && end !== undefined && event.time > start && event.time < end && ACTION_EVENTS.has(event.type)).length;
    }
    return count;
  }

  private afterLast(exports: EventView[], events: EventView[]): number {
    const lastExport = exports[exports.length - 1]?.time;
    return lastExport === undefined ? 0 : events.filter((event) => event.time !== undefined && event.time > lastExport).length;
  }

  private sequenceScore(events: EventView[]): number {
    const changed = events.find((event) => event.type === "file_changed")?.time;
    const saved = events.find((event) => event.type === "file_saved" && changed !== undefined && event.time !== undefined && event.time >= changed)?.time;
    const finished = events.find((event) => this.isTaskFinished(event.type) && saved !== undefined && event.time !== undefined && event.time >= saved)?.time;
    const exported = events.find((event) => event.type === "submission_exported" && finished !== undefined && event.time !== undefined && event.time >= finished)?.time;
    return [changed, saved, finished, exported].filter((value) => value !== undefined).length / 4;
  }

  private windowCounts(events: EventView[], sizeMs: number): number[] {
    const windows = this.countBy(events.filter((event) => event.time !== undefined), (event) => String(Math.floor((event.time ?? 0) / sizeMs)));
    return Array.from(windows.values());
  }

  private windowDetail(values: number[]): string {
    return values.length ? `media ${this.round(this.average(values))}, maximo ${Math.max(...values)} cambios/min.` : "Sin file_changed con timestamp.";
  }

  private pauses(events: EventView[]): number[] {
    const times = events.map((event) => event.time).filter((time): time is number => time !== undefined).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let index = 1; index < times.length; index += 1) {
      gaps.push(this.round((times[index] - times[index - 1]) / 60_000));
    }
    return gaps;
  }

  private pauseDetail(values: number[]): string {
    if (!values.length) return "Sin pausas calculables.";
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1];
    return `mediana ${median} min, p90 ${p90} min, >5 min: ${values.filter((value) => value > 5).length}.`;
  }

  private readEditCycles(events: EventView[]): number {
    let count = 0;
    for (let index = 0; index < events.length; index += 1) {
      const read = events[index];
      if (read.type !== "active_editor_changed" || !read.file || read.time === undefined) continue;
      const edit = events.slice(index + 1).find((event) => event.type === "file_changed" && event.file === read.file && event.time !== undefined);
      if (edit?.time !== undefined && edit.time - read.time <= 10 * 60_000) count += 1;
    }
    return count;
  }

  private reopenModifiedFiles(events: EventView[]): number {
    const modified = new Set<string>();
    let currentFile: string | undefined;
    let count = 0;
    for (const event of events) {
      if (event.type === "file_changed" && event.file) {
        modified.add(event.file);
      }
      if (event.type === "active_editor_changed" && event.file) {
        if (modified.has(event.file) && currentFile && currentFile !== event.file) {
          count += 1;
        }
        currentFile = event.file;
      }
    }
    return count;
  }

  private refinementBlocks(changes: EventView[]): Map<string, number> {
    const byFile = new Map<string, EventView[]>();
    for (const change of changes) {
      if (!change.file) continue;
      byFile.set(change.file, [...(byFile.get(change.file) ?? []), change]);
    }
    const blocks = new Map<string, number>();
    for (const [file, fileChanges] of byFile.entries()) {
      const ordered = fileChanges.filter((event) => event.time !== undefined).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
      let count = ordered.length ? 1 : 0;
      for (let index = 1; index < ordered.length; index += 1) {
        if ((ordered[index].time ?? 0) - (ordered[index - 1].time ?? 0) > 2 * 60_000) count += 1;
      }
      blocks.set(file, count);
    }
    return blocks;
  }

  private refinementDetail(blocks: Map<string, number>): string {
    const values = Array.from(blocks.values());
    return values.length ? `media ${this.round(this.average(values))}, maximo ${Math.max(...values)} ciclos por archivo.` : "Sin ciclos de edicion.";
  }

  private autonomyActions(events: EventView[]): number {
    return events.filter((event) =>
      ["file_changed", "file_saved", "file_created", "file_deleted", "active_editor_changed"].includes(event.type)
    ).length;
  }

  private hashDiscontinuities(events: LearningEvent[]): number {
    let count = 0;
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].previousHash !== events[index - 1].hash) count += 1;
    }
    return count;
  }

  private functionalZones(changes: EventView[]): string {
    const zones = new Set<string>();
    for (const change of changes) {
      if (!change.file) continue;
      for (const line of change.lines) {
        zones.add(`${change.file}#${Math.floor(line / 50)}`);
      }
    }
    return zones.size ? `${zones.size} zonas estimadas` : "n/d";
  }

  private nonExpectedEvents(events: EventView[], expectedFiles: Set<string>): EventView[] {
    if (!expectedFiles.size) return [];
    return events.filter((event) => event.file && ACTION_EVENTS.has(event.type) && !expectedFiles.has(event.file));
  }

  private traceabilityScore(input: { changedFiles: number; savedTouchedFiles: number; tasksStarted: number; tasksFinished: number; exports: number; hashDiscontinuities: number }): number {
    const parts = [
      input.changedFiles > 0 ? Math.min(1, input.savedTouchedFiles / input.changedFiles) : 0,
      input.tasksStarted > 0 ? Math.min(1, input.tasksFinished / input.tasksStarted) : 0,
      input.exports > 0 ? 1 : 0,
      input.hashDiscontinuities === 0 ? 1 : 0
    ];
    return this.average(parts);
  }
}
