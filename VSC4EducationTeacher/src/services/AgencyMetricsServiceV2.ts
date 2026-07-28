import { ActivityManifest } from "../types/ActivityManifest";
import { AgentInteraction } from "../types/AgentInteraction";
import {
  AgencyConfidenceV2,
  AgencyIndexV2,
  AgencyReliabilityV2,
  AtomicMetricV2,
  EngagementIndexV2,
  StudentAgencyMetricsV2
} from "../types/AgencyMetricsV2";
import { Contribution } from "../types/Contribution";
import { LearningEvent } from "../types/LearningEvent";

/**
 * Second, independent agency-metrics engine ("v2"), implementing
 * .no_sync/metrics-future-work/metrics-new-approach.md end to end.
 *
 * This file is autonomous on purpose: every formula it needs from the v1
 * engine (`AgencyMetricsService.ts`) is reimplemented locally instead of
 * imported, so v1 stays completely untouched and this file can evolve
 * independently. Where the spec annotates a metric with "(antes metric NN)"
 * the *code* of that v1 metric (not just its prose description) was used as
 * the source of truth, per the migration instructions.
 *
 * Output shape follows spec section 7: four independent indices
 * (Trazabilidad, Compromiso/Proceso, Autoria, Soporte de Agentes) plus a
 * derived executive summary. No signal is scored in more than one index.
 */

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

interface InteractionView {
  interaction: AgentInteraction;
  time?: number;
  taskId?: string;
  actor: "student" | "agent";
  chars: number;
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
  /(^|[\\/])(state|events|agent-interactions|agent-evidence|agent-evidence-state|current-task)\.jsonl?$/i,
  /(^|[\\/])AGENTS\.generated\.md$/i
];

const VARIANT_PATTERN = /(^|[._ -])(copy|copia|backup|old|v\d+|final|prueba|\d+)([._ -]|$)/i;
const TEST_PATTERN = /(^|[\\/])(tests?|__tests__)[\\/]|(\.test|\.spec)\.[^.\\/]+$|(^|[\\/])test_[^\\/]+\.py$/i;
const TEST_TASK_PATTERN = /(test|prueba|testing|validacion|validation)/i;

// --- Provisional fixed thresholds (Modo B fallback), documented in metrics-new-approach.md section 3 ---
const TEMPORAL_GAP_MINUTES = 15; // T9 / C5 large-pause threshold (spec 2.1/2.2)
const PROTECTED_EDIT_WINDOW_MS = 10 * 60 * 1000; // T8 window linking a protected-file open to a following edit
const SMALL_EVENT_MAX_LINES = 2; // A1/A2/A3 "small event" boundary (spec 2.3, same order as A2's full-score bound)
const PASTE_EVENT_ZERO_AT_LINES = 15; // A2 inverse band floor: falls to 0 at >=15 lines in one event (spec section 3)
const TYPING_GAP_MIN_MS = 40; // A3 plausible human typing cadence lower bound (spec 2.3)
const TYPING_GAP_MAX_MS = 2000; // A3 plausible human typing cadence upper bound (spec 2.3)
const REGULAR_CADENCE_CV_THRESHOLD = 0.15; // uniformity flag: CV below this over a burst reads as suspiciously regular (spec 2.3, exact cutoff chosen here)
const REGULAR_CADENCE_MIN_EVENTS = 5; // minimum consecutive small events considered a "burst" for the uniformity flag (spec 2.3)
const REFINEMENT_BLOCK_GAP_MINUTES = 2; // A6 refinement-pass boundary (same as v1 metric 40)
const READ_EDIT_WINDOW_MS = 10 * 60 * 1000; // A7 window (matches v1 metric 36 code; spec prose says 5 min but v1's own implementation uses 10)
const SUPPORT_COVERAGE_WINDOW_MS = 10 * 60 * 1000; // S3 "recent agent interaction" window (spec 2.4)
const C2_C3_FULL_SCORE_MINUTES = 30; // C2/C3 default full-score minutes (spec section 3 table; C3 reuses C2's value by analogy)
const C4_FULL_SCORE_RATIO = 1.0; // C4 default full-score ratio (spec section 3 table)
const C6_BAND_LOW = 0.1; // C6 density band low bound (spec section 3 table)
const C6_BAND_HIGH = 4; // C6 density band high bound (spec section 3 table)
const C8_FULL_SCORE_VOLUME = 30; // C8 default full-score volume (spec section 3 table)
const C9_FULL_SCORE_LINES = 30; // provisional: not listed in spec's table, reuses C8's order of magnitude
const C10_FULL_SCORE_LINES = 20; // C10 default full-score unique lines (spec section 3 table)
const C11_FULL_SCORE_DISPERSION = 40; // provisional: not listed in spec's table
const C14_FULL_SCORE_ZONES = 4; // provisional: reused from v1's own normalization of the same underlying metric (metric 42)
const C16_FULL_SCORE_SAVES = 3; // provisional: reused from v1's own normalization of the same underlying metric (metric 18)
const C17_BAND_LOW = 0.5; // provisional: reused from v1's own normalization of the same underlying metric (metric 19)
const C17_BAND_HIGH = 8;
const C18_C19_ZERO_AT_MINUTES = 60; // provisional latency cutoff for first change/save (not in spec's table)
const C26_C27_FULL_SCORE = 3; // provisional: reused from v1's own normalization of the same underlying metrics (metric 43/44)
const AUTHORSHIP_HIGH_CONFIDENCE_EVENTS = 30; // spec section 5.3
const AUTHORSHIP_MEDIUM_CONFIDENCE_EVENTS = 10; // spec section 5.3
const AUTHORSHIP_HIGH_CONFIDENCE_FILES = 2; // spec section 5.3
const AGENT_SUPPORT_HIGH_THRESHOLD = 50; // provisional "Soporte alto" cutoff used by the interpretation matrix (spec 5.5/6)
const AGENT_SUPPORT_RICH_INTERACTIONS = 10; // provisional cutoff for agentSupport confidence "alta" (spec 5.4 only defines the zero case)

export class AgencyMetricsServiceV2 {
  calculate(contribution: Contribution, manifest: ActivityManifest): StudentAgencyMetricsV2 {
    const events = contribution.events.map((event) => this.view(event));
    const sorted = this.sortedByTime(events);
    const workFileEvents = events.filter((event) => event.file && this.isWorkSourceFile(event.file));
    const expectedFiles = new Set(
      manifest.tasks
        .map((task) => task.file)
        .filter((file): file is string => typeof file === "string")
        .map((file) => this.normalizePath(file))
        .filter((file) => this.isWorkSourceFile(file))
    );

    const traceability = this.computeTraceability(events, sorted, workFileEvents, contribution.events);
    const engagement = this.computeEngagement(events, sorted, workFileEvents, expectedFiles);
    const authorship = this.computeAuthorship(workFileEvents);
    const agentSupport = this.computeAgentSupport(contribution, workFileEvents);

    const interpretationFlag = this.computeInterpretationFlag(authorship, agentSupport);
    const summary = this.computeSummary(traceability, engagement, authorship, agentSupport, interpretationFlag);

    const atoms: Record<string, number> = {};
    [traceability, engagement, authorship, agentSupport].forEach((index) => {
      index.evidence.forEach((entry) => {
        atoms[entry.id] = entry.value;
      });
    });

    return {
      studentId: contribution.studentId,
      metricsSchemaVersion: "2.0.0",
      atoms,
      traceability,
      engagement,
      authorship,
      agentSupport,
      interpretationFlag,
      summary
    };
  }

  // ---------------------------------------------------------------------
  // Trazabilidad (T1-T9) - spec section 2.1 / 5.1
  // ---------------------------------------------------------------------
  private computeTraceability(
    events: EventView[],
    sorted: (EventView & { time: number })[],
    workFileEvents: EventView[],
    rawEvents: LearningEvent[]
  ): AgencyIndexV2 {
    const filesChanged = new Set(
      this.byType(workFileEvents, "file_changed").map((event) => event.file).filter((file): file is string => !!file)
    );
    const filesSaved = new Set(
      this.byType(workFileEvents, "file_saved").map((event) => event.file).filter((file): file is string => !!file)
    );
    const taskStarts = events.filter((event) => event.type === "task_started" && event.taskId && Number.isFinite(event.time));
    const taskFinishes = events.filter((event) => this.isTaskFinished(event.type) && event.taskId && Number.isFinite(event.time));
    const exports = this.byType(events, "submission_exported").filter((event) => Number.isFinite(event.time));
    const hashDiscontinuities = this.hashDiscontinuities(rawEvents);
    const sequenceScore = this.sequenceScore(sorted);
    const protectedSequences = this.protectedEditSequences(sorted);
    const restored = this.count(events, "agents_file_restored");
    const changesAfterExport = this.afterLast(
      exports,
      workFileEvents.filter((event) => ["file_changed", "file_saved", "file_created"].includes(event.type))
    );
    const activePauses = this.pauses(sorted.filter((event) => event.type !== "heartbeat"));
    const temporalGaps = activePauses.filter((gap) => gap >= TEMPORAL_GAP_MINUTES).length;

    const savedTouchedFiles = Array.from(filesChanged).filter((file) => filesSaved.has(file)).length;
    const totalEvents = Math.max(1, events.length);

    const T1 = this.round((filesChanged.size > 0 ? savedTouchedFiles / filesChanged.size : 0) * 100);
    const T2 = this.round((taskStarts.length > 0 ? Math.min(1, taskFinishes.length / taskStarts.length) : 0) * 100);
    const T3 = exports.length > 0 ? 100 : 0;
    const T4 = this.round(this.clamp(1 - hashDiscontinuities / totalEvents, 0, 1) * 100);
    const T5 = this.round(sequenceScore * 100);

    const evidence: AtomicMetricV2[] = [
      this.atomicMetric("T1", "Guardado de archivos modificados", T1, "%", `${savedTouchedFiles}/${filesChanged.size} archivos con file_changed tambien tienen file_saved.`, "Un valor alto indica buena disciplina de guardado; valores bajos pueden senalar cambios sin persistir en disco o exportaciones incompletas.", "direct", true),
      this.atomicMetric("T2", "Cierre explicito de tareas", T2, "%", `${taskFinishes.length}/${Math.max(1, taskStarts.length)} tareas iniciadas tienen cierre (task_finished/task_completed).`, "Senal de control del flujo de trabajo pedagogico: valores altos indican que las tareas iniciadas se cierran explicitamente, no solo se abandonan.", "direct", true),
      this.atomicMetric("T3", "Existencia de envio", T3, "%", `${exports.length} evento(s) submission_exported registrados.`, "Indica si existe al menos un envio formal de la entrega; sin envio, el resto de los indices describen trabajo en curso, no una entrega cerrada.", "direct", true),
      this.atomicMetric("T4", "Continuidad de la cadena hash", T4, "%", `${hashDiscontinuities} discontinuidad(es) de ${totalEvents} eventos totales.`, "Afecta la confianza en la trazabilidad del log; un valor de 100 indica cadena continua, valores menores senalan discontinuidades que conviene revisar antes de confiar en el resto de metricas.", "direct", true),
      this.atomicMetric("T5", "Secuencia ordenada change->save->finish->export", T5, "%", "Proporcion de los 4 hitos detectados en orden temporal valido.", "Una secuencia ordenada (cambio, guardado, cierre, envio) sugiere control del proceso; que falte o se desordene algun hito no acusa nada por si solo, pero resta continuidad narrativa al log.", "estimated", true),
      this.atomicMetric("T6", "Cambios tras el ultimo envio", changesAfterExport, undefined, "Cambios, guardados o creaciones posteriores al ultimo submission_exported.", "Puede indicar que la version final del workspace no coincide con lo efectivamente entregado; revisar si el envio quedo desactualizado.", "estimated", false),
      this.atomicMetric("T7", "Restauraciones automaticas del sistema", restored, undefined, "count(agents_file_restored).", "Valores altos sugieren conflicto con archivos gestionados o con las reglas del entorno, no necesariamente mala fe.", "direct", false),
      this.atomicMetric("T8", "Secuencias sospechosas en archivos protegidos", protectedSequences.length, undefined, "Apertura de archivo protegido seguida de cambio/guardado/creacion/borrado.", "Apertura de un archivo protegido seguida de cambio o guardado en una ventana sospechosa; es un indicador para revisar, nunca una acusacion automatica.", "estimated", false),
      this.atomicMetric("T9", "Discontinuidades temporales grandes", temporalGaps, undefined, `Pausas >= ${TEMPORAL_GAP_MINUTES} min entre eventos no-heartbeat.`, "Ayuda a no sobreinterpretar silencios en el log; aqui solo actua como modificador de cobertura y confianza, nunca resta puntos al indice.", "direct", false)
    ];

    const score = this.round(this.average([T1, T2, T3, T4, T5]));

    const flags: string[] = [];
    if (changesAfterExport > 0) flags.push(`Hay ${changesAfterExport} cambio(s) despues del ultimo envio`);
    if (restored > 0) flags.push(`Hay ${restored} restauracion(es) automatica(s) del sistema en archivos gestionados`);
    if (protectedSequences.length > 0) flags.push(`Hay ${protectedSequences.length} secuencia(s) sospechosa(s) de edicion en archivos protegidos`);
    if (temporalGaps > 0) flags.push(`Hay ${temporalGaps} discontinuidad(es) temporal(es) grande(s) (pausas >= ${TEMPORAL_GAP_MINUTES} min)`);

    let confidence: AgencyConfidenceV2;
    if (taskStarts.length === 0 || exports.length === 0) {
      confidence = "limitada";
    } else if (T4 === 100 && T3 === 100) {
      // T9 acts only as a coverage/confidence modifier, never subtracts points (spec section 2.1).
      confidence = temporalGaps > 0 ? "media" : "alta";
    } else {
      confidence = "media";
    }

    return { score, confidence, flags, evidence };
  }

  // ---------------------------------------------------------------------
  // Compromiso / Proceso (C1-C35) - spec section 2.2 / 4 / 5.2
  // ---------------------------------------------------------------------
  private computeEngagement(
    events: EventView[],
    sorted: (EventView & { time: number })[],
    workFileEvents: EventView[],
    expectedFiles: Set<string>
  ): EngagementIndexV2 {
    const nonHeartbeatSorted = sorted.filter((event) => event.type !== "heartbeat");
    const firstTime = sorted[0]?.time;
    const lastTime = sorted[sorted.length - 1]?.time;
    const sessionMinutes = this.minutesBetween(firstTime, lastTime);
    const observableMinutes = this.observableMinutes(sorted);
    const actions = events.filter((event) => ACTION_EVENTS.has(event.type));
    const activePauses = this.pauses(nonHeartbeatSorted);
    const temporalGaps = activePauses.filter((gap) => gap >= TEMPORAL_GAP_MINUTES).length;

    const taskStarts = events.filter((event) => event.type === "task_started" && event.taskId && Number.isFinite(event.time));
    const taskFinishes = events.filter((event) => this.isTaskFinished(event.type) && event.taskId && Number.isFinite(event.time));
    const taskDurations = this.taskDurations(events, taskStarts, taskFinishes);

    const fileChanges = this.byType(workFileEvents, "file_changed");
    const effectiveChanges = fileChanges.filter((event) => event.changeCount > 0 || event.lineCount > 0);
    const saves = this.byType(workFileEvents, "file_saved");
    const created = this.byType(workFileEvents, "file_created");
    const deleted = this.byType(workFileEvents, "file_deleted");

    const changeVolume = this.sum(fileChanges.map((event) => event.changeCount));
    const totalLineTouches = this.sum(fileChanges.map((event) => event.lineCount));
    const lineVisits = this.lineVisits(fileChanges);
    const uniqueLineCount = lineVisits.size;
    const dispersion = this.average(this.lineDispersions(fileChanges));
    const fileChangeDistribution = this.countBy(fileChanges, (event) => event.file ?? "-");
    const topFileCount = Math.max(0, ...Array.from(fileChangeDistribution.values()));

    const expectedTouched = Array.from(expectedFiles).filter((file) => fileChanges.some((event) => event.file === file));
    const zones = this.functionalZonesCount(fileChanges);
    const outsideSrcEvents = events.filter((event) => event.file && !this.isWorkSourceFile(event.file) && ACTION_EVENTS.has(event.type));
    const nonExpected = this.nonExpectedEvents(workFileEvents, expectedFiles);

    const averageSavesPerTask = this.averageByTask(saves);
    const changesSaveRatio = this.ratio(effectiveChanges.length, saves.length);
    const firstChangeLatency = this.firstLatency(taskStarts, fileChanges);
    const firstSaveLatency = this.firstLatency(taskStarts, saves);
    const actionsByTaskCount = actions.filter((event) => event.taskId).length;
    const offTask = this.offTaskAfterStart(events, taskStarts);

    const exportsAll = this.byType(events, "submission_exported").filter((event) => Number.isFinite(event.time));
    const lastChangeExportLatency = this.lastChangeToExportLatency(fileChanges, exportsAll);
    const activityBetweenExports = this.activityBetweenExports(events, exportsAll);

    const testActivity = workFileEvents.filter((event) => event.file && TEST_PATTERN.test(event.file) && ACTION_EVENTS.has(event.type));
    const testingTaskActivity = events.filter((event) => event.taskId && TEST_TASK_PATTERN.test(event.taskId) && ACTION_EVENTS.has(event.type));

    const massiveChanges = fileChanges.filter((event) => event.lineCount > 20 || event.changeCount > 20);
    const incrementalBlocks = this.incrementalEditBlocks(effectiveChanges);
    const changeWindows = this.windowCounts(fileChanges, 60_000);
    const variantFiles = created.filter((event) => event.file && VARIANT_PATTERN.test(event.file));
    const changesAfterFinish = this.changesAfterTaskFinish(fileChanges, taskFinishes);
    const pauseInfo = this.pauseSummary(activePauses);

    // --- Presencia: only C2/C3/C4 score the sub-dimension; C1/C5 are informative (spec section 8 worked example) ---
    const C1 = this.round(sessionMinutes);
    const C2 = this.round(this.capScore(this.sum(taskDurations.map((task) => task.minutes)), C2_C3_FULL_SCORE_MINUTES));
    const C3 = this.round(this.capScore(observableMinutes, C2_C3_FULL_SCORE_MINUTES));
    const C4 = this.round(this.capScore(this.ratio(actions.length, Math.max(1, observableMinutes)), C4_FULL_SCORE_RATIO));
    const C5 = temporalGaps;

    // --- Intensidad de edicion (C6-C11, all scored) ---
    const C6 = this.round(this.bandScore(this.ratio(fileChanges.length, observableMinutes), C6_BAND_LOW, C6_BAND_HIGH));
    const C7 = this.percent(effectiveChanges.length, fileChanges.length);
    const C8 = this.round(this.capScore(changeVolume, C8_FULL_SCORE_VOLUME));
    const C9 = this.round(this.capScore(totalLineTouches, C9_FULL_SCORE_LINES));
    const C10 = this.round(this.capScore(uniqueLineCount, C10_FULL_SCORE_LINES));
    const C11 = this.round(this.capScore(dispersion, C11_FULL_SCORE_DISPERSION));

    // --- Alineacion con tareas esperadas (C12-C14 scored, C15 flag only) ---
    const C12 = expectedFiles.size ? this.percent(expectedTouched.length, expectedFiles.size) : 50;
    const C13 = this.percent(topFileCount, fileChanges.length);
    const C14 = this.round(this.capScore(zones, C14_FULL_SCORE_ZONES));
    const C15 = outsideSrcEvents.length + nonExpected.length;

    // --- Gestion de proceso (C16-C22, all scored) ---
    const C16 = this.round(this.capScore(averageSavesPerTask, C16_FULL_SCORE_SAVES));
    const C17 = this.round(this.bandScore(changesSaveRatio, C17_BAND_LOW, C17_BAND_HIGH));
    const C18 = this.round(this.decayScore(firstChangeLatency, C18_C19_ZERO_AT_MINUTES));
    const C19 = this.round(this.decayScore(firstSaveLatency, C18_C19_ZERO_AT_MINUTES));
    const C20 = this.round(this.taskDurationBalance(taskDurations));
    const C21 = this.percent(actionsByTaskCount, actions.length);
    const C22 = this.round(this.clamp(100 - this.percent(offTask.offTask, offTask.total), 0, 100));

    // --- Envio: descriptive only, NOT part of the weighted average (section 4's weight table sums to 100% without it) ---
    const C23 = this.round(this.bandScore(lastChangeExportLatency, 1, 60));
    const C24 = activityBetweenExports;
    const C25 = exportsAll.length;

    // --- Validacion (C26-C27, scored) ---
    const C26 = this.round(this.capScore(testActivity.length, C26_C27_FULL_SCORE));
    const C27 = this.round(this.capScore(testingTaskActivity.length, C26_C27_FULL_SCORE));

    // --- Patrones de edicion y exploracion (C28-C35): flags/context only, never scored ---
    const C28 = massiveChanges.length;
    const C29 = this.percent(incrementalBlocks.small, incrementalBlocks.total);
    const C30 = this.round(this.average(changeWindows));
    const C31 = activePauses.length;
    const C32 = created.length;
    const C33 = variantFiles.length;
    const C34 = deleted.length;
    const C35 = changesAfterFinish;

    const presencia = this.average([C2, C3, C4]);
    const intensidad = this.average([C6, C7, C8, C9, C10, C11]);
    const alineacion = this.average([C12, C13, C14]);
    const gestionProceso = this.average([C16, C17, C18, C19, C20, C21, C22]);
    const validacion = this.average([C26, C27]);

    const score = this.round(
      presencia * 0.2 + intensidad * 0.25 + alineacion * 0.2 + gestionProceso * 0.2 + validacion * 0.15
    );

    const evidence: AtomicMetricV2[] = [
      this.atomicMetric("C1", "Tiempo total de sesion", C1, "min", "Primer evento a ultimo evento (solo informativo, no puntua Presencia).", "Duracion bruta segun el log; por si sola no equivale a trabajo efectivo, es solo informativa y no puntua Presencia.", "direct", false),
      this.atomicMetric("C2", "Tiempo activo dentro de tareas", C2, undefined, `${this.round(this.sum(taskDurations.map((task) => task.minutes)))} min sumados entre task_started y task_finished/completed.`, "Tiempo entre el inicio y el cierre de cada tarea; si falta el cierre, se estima hasta el ultimo evento de esa tarea.", "estimated", true),
      this.atomicMetric("C3", "Tiempo con actividad observable", C3, undefined, `${observableMinutes} min en ventanas de 3 min con al menos una accion no pasiva.`, "Filtra periodos con solo heartbeat o presencia pasiva, quedandose con ventanas donde hubo alguna accion real.", "estimated", true),
      this.atomicMetric("C4", "Ratio de actividad efectiva", C4, undefined, "Acciones observables por minuto observable (no por heartbeat).", "Un valor alto sugiere interaccion activa en vez de presencia pasiva; el denominador es tiempo observable real, no heartbeats, para evitar manipular el ratio.", "estimated", true),
      this.atomicMetric("C5", "Discontinuidades temporales (presencia)", C5, undefined, `Pausas >= ${TEMPORAL_GAP_MINUTES} min entre acciones (dato descriptivo, no penaliza).`, "Mismo conteo de pausas largas que en Trazabilidad, pero aqui es puramente descriptivo de la presencia del alumno: no penaliza ni resta puntos.", "direct", false),
      this.atomicMetric("C6", "Densidad de edicion en src", C6, undefined, `${fileChanges.length} file_changed en ${this.round(observableMinutes)} min observables.`, "Densidades extremas conviene revisarlas: puede haber pegado, formateo automatico o bloqueo segun el caso.", "estimated", true),
      this.atomicMetric("C7", "Proporcion de cambios efectivos", C7, "%", `${effectiveChanges.length}/${fileChanges.length} file_changed con changeCount o lineas > 0.`, "Distingue cambios materiales del ruido tecnico del editor (eventos sin lineas ni cambios reales).", "direct", true),
      this.atomicMetric("C8", "Volumen total de cambios", C8, undefined, `sum(changeCount) = ${changeVolume}.`, "Volumen bruto de cambios; interpretar junto con las lineas afectadas y el ritmo de edicion.", "direct", true),
      this.atomicMetric("C9", "Lineas afectadas totales", C9, undefined, `sum(lines) = ${totalLineTouches}.`, "Aproxima el alcance textual del trabajo, contando tambien las repeticiones sobre las mismas lineas.", "direct", true),
      this.atomicMetric("C10", "Lineas unicas modificadas", C10, undefined, `${uniqueLineCount} pares file:line distintos.`, "Evita contar varias veces las visitas repetidas a la misma linea, a diferencia del total de lineas afectadas.", "direct", true),
      this.atomicMetric("C11", "Dispersion de lineas modificadas", C11, undefined, `Promedio por archivo de max(line)-min(line)+1 = ${this.round(dispersion)}.`, "Indica si la edicion esta repartida por el archivo o concentrada en una zona pequena.", "estimated", true),
      this.atomicMetric("C12", "Cobertura de archivos esperados", C12, "%", expectedFiles.size ? `${expectedTouched.length}/${expectedFiles.size} archivos de tareas modificados.` : "El manifest no declara task.file.", "Una cobertura baja puede indicar trabajo incompleto o una estrategia alternativa valida; conviene mirar el detalle antes de concluir.", expectedFiles.size ? "direct" : "limited", true),
      this.atomicMetric("C13", "Concentracion de edicion por archivo", C13, "%", `El archivo mas tocado concentra ${topFileCount}/${fileChanges.length} eventos file_changed.`, "Muestra si el esfuerzo se concentra en un unico archivo dominante frente al resto.", "direct", true),
      this.atomicMetric("C14", "Zonas funcionales distribuidas", C14, undefined, `${zones} zona(s) estimadas por bloques de 50 lineas.`, "Aproxima la distribucion funcional del trabajo por bloques de 50 lineas, sin analizar la semantica real del codigo.", "limited", true),
      this.atomicMetric("C15", "Actividad fuera de src / no esperada", C15, undefined, "Acciones fuera de src/ o fuera de task.file cuando esa lista existe.", "Indicador contextual de revision; no cuenta como trabajo efectivo y puede ser exploracion legitima fuera del alcance declarado.", expectedFiles.size ? "estimated" : "limited", false),
      this.atomicMetric("C16", "Saves por tarea", C16, undefined, `Promedio ${this.round(averageSavesPerTask)} file_saved por tarea.`, "Muchos guardados pueden indicar ciclos incrementales de trabajo; un valor bajo puede deberse simplemente al autoguardado del editor.", "direct", true),
      this.atomicMetric("C17", "Ratio cambios/guardado", C17, undefined, `${effectiveChanges.length} cambios efectivos / ${saves.length} guardados.`, "Relaciona el volumen de edicion con la frecuencia de guardado; valores extremos en cualquier sentido merecen contexto.", "direct", true),
      this.atomicMetric("C18", "Latencia al primer cambio", C18, undefined, `${this.round(firstChangeLatency)} min desde task_started hasta el primer file_changed.`, "Una latencia alta puede deberse a lectura, planificacion o bloqueo antes de empezar a escribir codigo.", taskStarts.length ? "direct" : "limited", true),
      this.atomicMetric("C19", "Latencia al primer guardado", C19, undefined, `${this.round(firstSaveLatency)} min desde task_started hasta el primer file_saved.`, "Marca el primer hito persistido en disco, cuando existen guardados explicitos que registrar.", taskStarts.length ? "direct" : "limited", true),
      this.atomicMetric("C20", "Duracion relativa por tarea (balance)", C20, undefined, `Balance temporal entre ${taskDurations.length} tarea(s) (mayor puntaje = reparto mas equilibrado).`, "Detecta desequilibrios entre tareas o tareas cerradas sin tiempo observable asociado; un valor alto indica reparto mas equilibrado.", taskDurations.some((task) => task.estimated) ? "estimated" : "direct", true),
      this.atomicMetric("C21", "Actividad por tarea", C21, "%", `${actionsByTaskCount}/${actions.length} acciones tienen taskId asignado.`, "Proporcion de acciones que quedan asociadas a una tarea concreta; un valor bajo sugiere mucha actividad libre o fuera de seguimiento.", "direct", true),
      this.atomicMetric("C22", "Actividad fuera de tarea", C22, "%", `${offTask.offTask}/${Math.max(1, offTask.total)} acciones tras iniciar tareas no tienen taskId (score invertido: menos es mejor).`, "Ayuda a reconstruir trabajo libre o fuera del tracker; el score esta invertido (menos actividad fuera de tarea puntua mejor).", "direct", true),
      this.atomicMetric("C23", "Latencia ultimo cambio -> envio (contexto)", C23, undefined, `${this.round(lastChangeExportLatency)} min entre el ultimo file_changed y el ultimo submission_exported.`, "Margen de revision antes de enviar; dato de contexto, no puntua el indice de Compromiso.", exportsAll.length && fileChanges.length ? "direct" : "limited", false),
      this.atomicMetric("C24", "Actividad entre envios (contexto)", C24, undefined, "Acciones entre pares consecutivos de submission_exported.", "Cambios detectados entre envios sucesivos sugieren refinamiento posterior al primer envio; dato de contexto.", exportsAll.length > 1 ? "direct" : "limited", false),
      this.atomicMetric("C25", "Numero de envios (contexto)", C25, undefined, "count(submission_exported); no vuelve a puntuar para evitar doble conteo con T3.", "Multiples envios pueden indicar iteracion o pruebas administrativas; la existencia binaria ya puntua en T3, aqui solo se muestra el conteo como contexto.", "direct", false),
      this.atomicMetric("C26", "Actividad en tests", C26, undefined, `${testActivity.length} accion(es) sobre rutas/archivos de test.`, "Indica trabajo dirigido a comprobar la propia solucion, cuando la actividad existe sobre rutas de test.", "estimated", true),
      this.atomicMetric("C27", "Actividad en tarea de testing", C27, undefined, `${testingTaskActivity.length} accion(es) en taskId relacionado con validacion.`, "Mide la actividad visible en tareas cuyo identificador sugiere verificacion o validacion.", "estimated", true),
      this.atomicMetric("C28", "Cambios masivos subitos", C28, undefined, "file_changed con >20 lineas o changeCount>20.", "Senal para revisar posible pegado, formateo automatico, generacion de codigo o sustituciones amplias.", "estimated", false),
      this.atomicMetric("C29", "Indice de edicion incremental (por bloques >=30s)", C29, "%", `${incrementalBlocks.small}/${incrementalBlocks.total} bloques de actividad compuestos solo por eventos pequenos.`, "Un valor alto es compatible con construccion paso a paso; se agrega por bloques de actividad de >=30s para no confundirlo con la granularidad normal del tecleo.", "estimated", false),
      this.atomicMetric("C30", "Ritmo de edicion por ventanas de 1 min", C30, "cambios/min", "Promedio de file_changed agrupados en ventanas de 1 minuto.", "Picos breves e intensos de edicion merecen revision de contexto; por si solos son solo descriptivos.", "estimated", false),
      this.atomicMetric("C31", "Pausas entre acciones activas", C31, undefined, `Mediana ${pauseInfo.median} min, p90 ${pauseInfo.p90} min, ${pauseInfo.over5} pausa(s) > 5 min.`, "Las pausas pueden deberse a lectura, consulta externa, bloqueo o trabajo fuera del editor; es descriptivo, no penaliza.", "direct", false),
      this.atomicMetric("C32", "Archivos creados", C32, undefined, "count(file_created).", "Crear archivos puede indicar exploracion, estructuracion del proyecto o pruebas alternativas; es neutro por si solo.", "direct", false),
      this.atomicMetric("C33", "Variantes/copias creadas", C33, undefined, "file_created con nombres tipo copy/backup/v2.", "Puede senalar exploracion o inseguridad segun el volumen y el contexto; un nombre de variante no es en si mismo un problema.", "estimated", false),
      this.atomicMetric("C34", "Archivos eliminados", C34, undefined, "count(file_deleted).", "Puede reflejar limpieza o descarte de trabajo; conviene revisar si afecta a archivos protegidos.", "direct", false),
      this.atomicMetric("C35", "Cambios tras cierre de tarea", C35, undefined, "file_changed posteriores a task_finished/completed de la misma tarea.", "Puede indicar una revision legitima posterior o un desajuste en el flujo de cierre de la tarea.", "estimated", false)
    ];

    const flags: string[] = [];
    if (C15 > 0) flags.push(`Hay ${C15} accion(es) fuera de src/ o de archivos no esperados por el manifest`);
    massiveChanges.slice(0, 3).forEach((change) => {
      const size = Math.max(change.lineCount, change.changeCount);
      const when = change.time ? ` (${new Date(change.time).toISOString()})` : "";
      flags.push(`Cambio subito de ${size} lineas en ${change.file ?? "archivo desconocido"}${when} (revisar contexto)`);
    });
    if (variantFiles.length > 0) flags.push(`Se crearon ${variantFiles.length} archivo(s) con nombre de variante/copia`);
    if (changesAfterFinish > 0) flags.push(`Hay ${changesAfterFinish} cambio(s) despues del cierre de la tarea (puede ser revision legitima)`);
    if (temporalGaps > 0) flags.push(`Hay ${temporalGaps} discontinuidad(es) temporal(es) (pausas >= ${TEMPORAL_GAP_MINUTES} min) - nota de cobertura, no penaliza`);

    const presenciaReliabilities: AgencyReliabilityV2[] = ["estimated", "estimated", "estimated"];
    const intensidadReliabilities: AgencyReliabilityV2[] = ["estimated", "direct", "direct", "direct", "direct", "estimated"];
    const alineacionReliabilities: AgencyReliabilityV2[] = [expectedFiles.size ? "direct" : "limited", "direct", "limited"];
    const gestionReliabilities: AgencyReliabilityV2[] = [
      "direct",
      "direct",
      taskStarts.length ? "direct" : "limited",
      taskStarts.length ? "direct" : "limited",
      taskDurations.some((task) => task.estimated) ? "estimated" : "direct",
      "direct",
      "direct"
    ];
    const validacionReliabilities: AgencyReliabilityV2[] = ["estimated", "estimated"];
    const subdimensionReliabilities = [
      presenciaReliabilities,
      intensidadReliabilities,
      alineacionReliabilities,
      gestionReliabilities,
      validacionReliabilities
    ];
    const majorityDirectCount = subdimensionReliabilities.filter((list) => this.isMajorityDirect(list)).length;
    const directRatio = majorityDirectCount / subdimensionReliabilities.length;
    const confidence: AgencyConfidenceV2 = directRatio >= 0.8 ? "alta" : directRatio >= 0.4 ? "media" : "limitada";

    return {
      score,
      confidence,
      flags,
      evidence,
      subdimensions: {
        presencia: this.round(presencia),
        intensidad: this.round(intensidad),
        alineacion: this.round(alineacion),
        gestionProceso: this.round(gestionProceso),
        validacion: this.round(validacion)
      }
    };
  }

  // ---------------------------------------------------------------------
  // Autoria (A1-A10) - spec section 2.3 / 5.3 (new logic, no v1 equivalent for A1-A4)
  // ---------------------------------------------------------------------
  private computeAuthorship(workFileEvents: EventView[]): AgencyIndexV2 {
    const changes = this.byType(workFileEvents, "file_changed");
    const timedChanges = changes.filter((event): event is EventView & { time: number } => Number.isFinite(event.time));
    // Per the critical parsing note: event size is changeCount (data.changeCount, falls back to lines.length).
    const sizedChanges = timedChanges.filter((event) => event.changeCount > 0);

    const totalSize = this.sum(sizedChanges.map((event) => event.changeCount));
    const smallChanges = sizedChanges.filter((event) => event.changeCount <= SMALL_EVENT_MAX_LINES);
    const smallSize = this.sum(smallChanges.map((event) => event.changeCount));
    const A1 = totalSize > 0 ? this.percent(smallSize, totalSize) : 50; // neutral: no sized activity to judge

    const maxEventSize = sizedChanges.length ? Math.max(...sizedChanges.map((event) => event.changeCount)) : 0;
    const A2 = this.round(this.inverseBandScore(maxEventSize, SMALL_EVENT_MAX_LINES, PASTE_EVENT_ZERO_AT_LINES));

    const smallByFile = new Map<string, (EventView & { time: number })[]>();
    for (const change of smallChanges) {
      if (!change.file) continue;
      smallByFile.set(change.file, [...(smallByFile.get(change.file) ?? []), change]);
    }
    const allGapsMs: number[] = [];
    const burstFlags: string[] = [];
    for (const [file, list] of smallByFile.entries()) {
      const ordered = [...list].sort((a, b) => a.time - b.time);
      const gaps: number[] = [];
      for (let index = 1; index < ordered.length; index += 1) {
        gaps.push(ordered[index].time - ordered[index - 1].time);
      }
      allGapsMs.push(...gaps);
      for (let start = 0; start + (REGULAR_CADENCE_MIN_EVENTS - 1) <= gaps.length; start += 1) {
        const window = gaps.slice(start, start + REGULAR_CADENCE_MIN_EVENTS - 1);
        const cv = this.coefficientOfVariation(window);
        if (window.every((gap) => gap > 0) && cv < REGULAR_CADENCE_CV_THRESHOLD) {
          const startTime = new Date(ordered[start].time).toISOString();
          const endTime = new Date(ordered[start + REGULAR_CADENCE_MIN_EVENTS - 1].time).toISOString();
          burstFlags.push(`Ritmo de tecleo inusualmente regular en ${file} entre ${startTime} y ${endTime}, revisar si es pegado fragmentado para simular tecleo`);
          break;
        }
      }
    }
    const plausibleGaps = allGapsMs.filter((gap) => gap >= TYPING_GAP_MIN_MS && gap <= TYPING_GAP_MAX_MS);
    const A3 = allGapsMs.length ? this.percent(plausibleGaps.length, allGapsMs.length) : 50;

    const allByFile = new Map<string, (EventView & { time: number })[]>();
    for (const change of sizedChanges) {
      if (!change.file) continue;
      allByFile.set(change.file, [...(allByFile.get(change.file) ?? []), change]);
    }
    const correlations: number[] = [];
    for (const list of allByFile.values()) {
      const ordered = [...list].sort((a, b) => a.time - b.time);
      if (ordered.length < 3) continue;
      const xs = ordered.map((_, index) => index + 1);
      let cumulative = 0;
      const ys = ordered.map((event) => {
        cumulative += event.changeCount;
        return cumulative;
      });
      correlations.push(this.clamp(this.pearson(xs, ys), 0, 1));
    }
    const A4 = correlations.length ? this.round(this.average(correlations) * 100) : 50;

    const lineVisits = this.lineVisits(changes);
    const uniqueLineCount = lineVisits.size;
    const lineRepeats = Array.from(lineVisits.values()).filter((count) => count > 1).length;
    const A5 = this.percent(lineRepeats, uniqueLineCount);

    const refinementBlocks = this.refinementBlocks(changes);
    const A6 = this.round(this.capScore(this.average(Array.from(refinementBlocks.values())), 4));

    const readEditCycles = this.readEditCycles(workFileEvents);
    const filesConsulted = new Set(
      this.byType(workFileEvents, "active_editor_changed").map((event) => event.file).filter((file): file is string => !!file)
    );
    const filesChangedSet = new Set(changes.map((event) => event.file).filter((file): file is string => !!file));
    const A7 = readEditCycles;
    const A8 = filesConsulted.size;
    const A9 = this.ratio(filesConsulted.size, filesChangedSet.size);
    const A10 = this.reopenModifiedFiles(workFileEvents);

    const score = this.round(A1 * 0.35 + A2 * 0.2 + A3 * 0.15 + A4 * 0.1 + A5 * 0.1 + A6 * 0.1);

    const evidence: AtomicMetricV2[] = [
      this.atomicMetric("A1", "Fraccion tecleada", A1, "%", `${this.round(smallSize)}/${this.round(totalSize)} unidades de cambio llegaron via eventos pequenos (<= ${SMALL_EVENT_MAX_LINES} lineas).`, "Un valor alto sugiere que la mayoria del contenido llego mediante tecleo incremental observable; un valor bajo sugiere que gran parte llego ya formada (pegado, generacion, sustitucion masiva) y merece revisarse junto con A2.", "estimated", true),
      this.atomicMetric("A2", "Evento de pegado maximo", A2, undefined, `Mayor evento file_changed detectado: ${maxEventSize} lineas (banda inversa 100 en ${SMALL_EVENT_MAX_LINES}, 0 en ${PASTE_EVENT_ZERO_AT_LINES}).`, "Complementa a A1: una entrega puede tener A1 alto en promedio y aun asi esconder un evento de pegado grande; se puntua de forma inversa (evento grande = score bajo) y se reporta siempre tambien como flag con archivo y momento concretos.", "estimated", true),
      this.atomicMetric("A3", "Cadencia de tecleo plausible", A3, "%", `${plausibleGaps.length}/${allGapsMs.length} gaps entre eventos pequenos caen en ${TYPING_GAP_MIN_MS}-${TYPING_GAP_MAX_MS} ms.`, "Gaps por debajo del rango humano son fisicamente incompatibles con tecleo real (sugieren automatizacion o eventos generados por herramienta); gaps muy por encima ya se cuentan aparte como pausas (C5/T9).", "estimated", true),
      this.atomicMetric("A4", "Crecimiento gradual del archivo", A4, "%", `Correlacion de Pearson promedio (recortada a [0,1]) sobre ${correlations.length} archivo(s) con >=3 eventos.`, "Un crecimiento aproximadamente lineal es la firma de tecleo progresivo; un crecimiento en escalon (poco cambio y luego un salto grande) es la firma de pegado, sin importar cuantos eventos pequenos rodeen el salto.", "estimated", true),
      this.atomicMetric("A5", "Revision de la misma linea", A5, "%", `${lineRepeats}/${uniqueLineCount} lineas unicas tocadas 2+ veces.`, "Dificil de fingir con un pegado directo: revisar y corregir la misma linea varias veces es un patron de elaboracion propia, no de trasplante de texto ya terminado.", "estimated", true),
      this.atomicMetric("A6", "Profundidad de refinamiento por archivo", A6, undefined, "Bloques de edicion separados por >2 min de inactividad, por archivo.", "Complementa a A5: mide si el archivo se retomo y se trabajo en varias pasadas separadas en vez de completarse de una sola vez.", "estimated", true),
      this.atomicMetric("A7", "Alternancia lectura-edicion", A7, undefined, `active_editor_changed seguido de file_changed en el mismo archivo dentro de ${READ_EDIT_WINDOW_MS / 60_000} min.`, "Sugiere lectura o inspeccion antes de editar; describe exploracion, no tecleo propio, por eso es solo contexto y no puntua Autoria.", "estimated", false),
      this.atomicMetric("A8", "Archivos consultados", A8, undefined, "Archivos distintos en active_editor_changed.", "Mide la amplitud de la exploracion del proyecto; por si sola es neutra, ni buena ni mala senal de autoria.", "direct", false),
      this.atomicMetric("A9", "Ratio consultados/modificados", A9, undefined, "Archivos consultados / archivos modificados.", "Valores altos sugieren busqueda de contexto o exploracion dispersa frente a los archivos realmente modificados; es contextual.", "direct", false),
      this.atomicMetric("A10", "Reapertura de archivos modificados", A10, undefined, "Vuelta a archivos ya editados tras enfocar otros archivos.", "Puede ser revision legitima, depuracion o refinamiento, o simplemente navegacion sin intencion particular; no puntua Autoria.", "estimated", false)
      // S4-equivalent for authorship (similitud de texto) is not part of this index; see agentSupport for the fase-2 note.
    ];

    const flags: string[] = [...burstFlags];
    if (sizedChanges.length && maxEventSize > SMALL_EVENT_MAX_LINES) {
      const biggest = sizedChanges.reduce((max, event) => (event.changeCount > max.changeCount ? event : max), sizedChanges[0]);
      flags.push(`Evento unico de ${biggest.changeCount} lineas en ${biggest.file ?? "archivo desconocido"} a las ${new Date(biggest.time).toISOString()} (metrica A2)`);
    }

    const filesTouchedCount = filesChangedSet.size;
    let confidence: AgencyConfidenceV2;
    if (timedChanges.length >= AUTHORSHIP_HIGH_CONFIDENCE_EVENTS && filesTouchedCount >= AUTHORSHIP_HIGH_CONFIDENCE_FILES) {
      confidence = "alta";
    } else if (timedChanges.length >= AUTHORSHIP_MEDIUM_CONFIDENCE_EVENTS) {
      confidence = "media";
    } else {
      confidence = "limitada";
    }
    const note =
      confidence === "limitada"
        ? "Muestra de eventos de edicion insuficiente para estimar tecleo con confianza"
        : "Estimado a partir de metadatos de edicion (tamano/ritmo de evento), ciego a la conversacion con el agente";

    return { score, confidence, flags, note, evidence };
  }

  // ---------------------------------------------------------------------
  // Soporte de Agentes (S1-S4) - spec section 2.4 / 5.4 (new logic, uses agentInteractions)
  // ---------------------------------------------------------------------
  private computeAgentSupport(contribution: Contribution, workFileEvents: EventView[]): AgencyIndexV2 {
    const interactions = contribution.agentInteractions.map((interaction) => this.interactionView(interaction));
    const timedInteractions = interactions.filter((item): item is InteractionView & { time: number } => Number.isFinite(item.time));
    const agentMessages = timedInteractions.filter((item) => item.actor === "agent");
    const fileChanges = this.byType(workFileEvents, "file_changed").filter(
      (event): event is EventView & { time: number } => Number.isFinite(event.time)
    );

    const byTask = new Map<string, { student: number; agent: number }>();
    for (const interaction of timedInteractions) {
      const key = interaction.taskId ?? "sin tarea";
      const bucket = byTask.get(key) ?? { student: 0, agent: 0 };
      if (interaction.actor === "student") bucket.student += interaction.chars;
      else bucket.agent += interaction.chars;
      byTask.set(key, bucket);
    }
    const ratiosPerTask = Array.from(byTask.values()).map((bucket) => bucket.student / Math.max(1, bucket.student + bucket.agent));
    const S1 = ratiosPerTask.length ? this.round(this.average(ratiosPerTask) * 100) : 0;

    const latencies: number[] = [];
    for (const message of agentMessages) {
      const next = fileChanges.find(
        (change) => change.time >= message.time && (!message.taskId || !change.taskId || change.taskId === message.taskId)
      );
      if (next) latencies.push((next.time - message.time) / 60_000);
    }
    const S2Median = this.round(this.median(latencies));

    const withSupport = fileChanges.filter((change) =>
      agentMessages.some(
        (message) =>
          message.time <= change.time &&
          change.time - message.time <= SUPPORT_COVERAGE_WINDOW_MS &&
          (!change.taskId || !message.taskId || change.taskId === message.taskId)
      )
    );
    const S3 = fileChanges.length ? this.percent(withSupport.length, fileChanges.length) : 0;

    const score = this.round(S3 * 0.55 + S1 * 0.45);

    const evidence: AtomicMetricV2[] = [
      this.atomicMetric("S1", "Ratio de iniciativa en la conversacion", S1, "%", `Caracteres del alumno frente al total de la conversacion, promediado sobre ${byTask.size} grupo(s) por tarea.`, "Un alumno que solo escribe 'hazlo' tiene un ratio bajo; uno que explica, pregunta y corrige tiene un ratio alto. Mide participacion real en la conversacion, no solo el numero de mensajes.", "estimated", true),
      this.atomicMetric("S2", "Latencia sugerencia -> cambio (mediana, contexto)", S2Median, "min", `Mediana sobre ${latencies.length} par(es) mensaje del agente -> siguiente file_changed de la misma tarea. Interpretar junto con A2.`, "Se interpreta siempre junto con Autoria (A2 en particular): una latencia casi nula junto con un evento de pegado grande es la combinacion que mas debe llamar la atencion. Es solo contexto, no entra en el promedio de Soporte.", "estimated", false),
      this.atomicMetric("S3", "Cobertura de apoyo IA en los cambios", S3, "%", `${withSupport.length}/${fileChanges.length} file_changed con interaccion de agente en los ${SUPPORT_COVERAGE_WINDOW_MS / 60_000} min previos (misma tarea).`, "Un valor alto indica que buena parte de los cambios ocurrieron poco despues de una interaccion con el agente; nunca interpretar en solitario, cruzar siempre con Autoria (ver la matriz de interpretacion).", "estimated", true)
      // S4 (similitud de texto agente <-> resultado final) is spec's fase-2 signal; deliberately not computed here.
    ];

    const flags: string[] = [];
    let confidence: AgencyConfidenceV2;
    let note: string | undefined;
    if (contribution.agentInteractions.length === 0) {
      confidence = "limitada";
      note = "No hay registro de conversacion con el agente para esta entrega; no se puede estimar el soporte recibido";
    } else if (contribution.agentInteractions.length >= AGENT_SUPPORT_RICH_INTERACTIONS) {
      confidence = "alta";
    } else {
      confidence = "media";
      note = `Solo ${contribution.agentInteractions.length} interaccion(es) con el agente registradas; interpretar con cautela`;
    }

    return { score, confidence, flags, note, evidence };
  }

  // ---------------------------------------------------------------------
  // Cruce Autoria x Soporte (5.5) y resumen ejecutivo (6)
  // ---------------------------------------------------------------------
  private computeInterpretationFlag(authorship: AgencyIndexV2, agentSupport: AgencyIndexV2): string | null {
    if (authorship.score >= 40) return null;
    const supportHigh = agentSupport.confidence !== "limitada" && agentSupport.score >= AGENT_SUPPORT_HIGH_THRESHOLD;
    if (supportHigh) {
      return `Autoria baja (${authorship.score}) junto con Soporte de Agentes alto (${agentSupport.score}): los eventos de pegado detectados coinciden con interaccion de agente reciente -- sospecha de copia literal, revisar`;
    }
    return `Autoria baja (${authorship.score}) junto con Soporte de Agentes bajo o sin datos (${agentSupport.score}): contenido llegado sin tecleo y sin registro de conversacion con el agente -- posible pegado de una fuente no registrada (otro archivo, internet, IA externa), revisar igual`;
  }

  private computeSummary(
    traceability: AgencyIndexV2,
    engagement: EngagementIndexV2,
    authorship: AgencyIndexV2,
    agentSupport: AgencyIndexV2,
    interpretationFlag: string | null
  ): StudentAgencyMetricsV2["summary"] {
    const score = this.round(
      traceability.score * 0.2 + engagement.score * 0.3 + authorship.score * 0.4 + agentSupport.score * 0.1
    );
    const flags: string[] = [];
    if (traceability.score < 40) {
      flags.push("Trazabilidad insuficiente: los demas indices deben leerse con cautela");
    }
    if (interpretationFlag) flags.push(interpretationFlag);
    const validacion = engagement.subdimensions.validacion;
    if (typeof validacion === "number" && validacion < 40) {
      flags.push(`Validacion baja (${validacion}): poca evidencia de actividad en tests`);
    }
    return { score, level: this.summaryLevel(score), flags };
  }

  private summaryLevel(score: number): StudentAgencyMetricsV2["summary"]["level"] {
    if (score >= 85) return "muy alta";
    if (score >= 65) return "alta";
    if (score >= 40) return "media";
    if (score >= 15) return "baja";
    return "insuficiente";
  }

  // ---------------------------------------------------------------------
  // Shared event/interaction views
  // ---------------------------------------------------------------------
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

  private interactionView(interaction: AgentInteraction): InteractionView {
    const time = Date.parse(String(interaction.timestamp ?? ""));
    return {
      interaction,
      time: Number.isFinite(time) ? time : undefined,
      taskId: interaction.taskId,
      actor: interaction.actor,
      chars: interaction.message?.length ?? 0
    };
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

  // ---------------------------------------------------------------------
  // Generic helpers (autonomous re-implementation of v1's utility layer)
  // ---------------------------------------------------------------------
  private atomicMetric(
    id: string,
    name: string,
    value: number,
    unit: string | undefined,
    detail: string,
    interpretation: string,
    reliability: AgencyReliabilityV2,
    scored: boolean
  ): AtomicMetricV2 {
    return { id, name, value, unit, detail, interpretation, reliability, scored };
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

  private sortedByTime(events: EventView[]): (EventView & { time: number })[] {
    return events
      .filter((event): event is EventView & { time: number } => Number.isFinite(event.time))
      .sort((a, b) => a.time - b.time);
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
  }

  private average(values: number[]): number {
    return values.length ? this.sum(values) / values.length : 0;
  }

  private median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private stdev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = this.average(values);
    return Math.sqrt(this.average(values.map((value) => (value - mean) ** 2)));
  }

  private coefficientOfVariation(values: number[]): number {
    const mean = this.average(values);
    return mean === 0 ? 0 : this.stdev(values) / mean;
  }

  private pearson(xs: number[], ys: number[]): number {
    const n = xs.length;
    if (n < 2) return 0;
    const meanX = this.average(xs);
    const meanY = this.average(ys);
    let numerator = 0;
    let dx2 = 0;
    let dy2 = 0;
    for (let index = 0; index < n; index += 1) {
      const dx = xs[index] - meanX;
      const dy = ys[index] - meanY;
      numerator += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    const denominator = Math.sqrt(dx2 * dy2);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  private ratio(numerator: number, denominator: number): number {
    return this.round(numerator / Math.max(1, denominator));
  }

  private percent(numerator: number, denominator: number): number {
    return this.round((numerator / Math.max(1, denominator)) * 100);
  }

  private minutesBetween(start?: number, end?: number): number {
    return start !== undefined && end !== undefined && end >= start ? (end - start) / 60_000 : 0;
  }

  private capScore(value: number, fullScoreAt: number): number {
    return this.clamp((value / Math.max(1e-6, fullScoreAt)) * 100, 0, 100);
  }

  private bandScore(value: number, low: number, high: number): number {
    if (value < low) return this.clamp((value / Math.max(low, 0.1)) * 70, 0, 100);
    if (value <= high) return 100;
    return this.clamp(100 - ((value - high) / Math.max(high, 1)) * 60, 0, 100);
  }

  private inverseBandScore(value: number, fullAt: number, zeroAt: number): number {
    if (value <= fullAt) return 100;
    if (value >= zeroAt) return 0;
    return this.clamp(100 - ((value - fullAt) / (zeroAt - fullAt)) * 100, 0, 100);
  }

  private decayScore(value: number, zeroAt: number): number {
    return this.clamp(100 - (value / Math.max(1e-6, zeroAt)) * 100, 0, 100);
  }

  private isMajorityDirect(reliabilities: AgencyReliabilityV2[]): boolean {
    if (!reliabilities.length) return false;
    return reliabilities.filter((reliability) => reliability === "direct").length > reliabilities.length / 2;
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

  private pauses(events: EventView[]): number[] {
    const times = events.map((event) => event.time).filter((time): time is number => time !== undefined).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let index = 1; index < times.length; index += 1) {
      gaps.push(this.round((times[index] - times[index - 1]) / 60_000));
    }
    return gaps;
  }

  private pauseSummary(values: number[]): { median: number; p90: number; over5: number } {
    if (!values.length) return { median: 0, p90: 0, over5: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1];
    return { median, p90, over5: values.filter((value) => value > 5).length };
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

  private functionalZonesCount(changes: EventView[]): number {
    const zones = new Set<string>();
    for (const change of changes) {
      if (!change.file) continue;
      for (const line of change.lines) {
        zones.add(`${change.file}#${Math.floor(line / 50)}`);
      }
    }
    return zones.size;
  }

  private nonExpectedEvents(events: EventView[], expectedFiles: Set<string>): EventView[] {
    if (!expectedFiles.size) return [];
    return events.filter((event) => event.file && ACTION_EVENTS.has(event.type) && !expectedFiles.has(event.file));
  }

  private averageByTask(events: EventView[]): number {
    const byTask = this.countBy(events, (event) => event.taskId ?? "outside task");
    return this.average(Array.from(byTask.values()));
  }

  private firstLatency(starts: EventView[], targets: EventView[]): number {
    const latencies = starts
      .map((start) => {
        const target = targets.find(
          (item) => item.time !== undefined && start.time !== undefined && item.time >= start.time && (!start.taskId || !item.taskId || item.taskId === start.taskId)
        );
        return target ? this.minutesBetween(start.time, target.time) : undefined;
      })
      .filter((value): value is number => value !== undefined);
    return latencies.length ? Math.min(...latencies) : 0;
  }

  private taskDurationBalance(durations: { taskId: string; minutes: number }[]): number {
    if (durations.length < 2) return 50; // neutral: cannot assess balance with fewer than two tasks
    const cv = this.coefficientOfVariation(durations.map((task) => task.minutes));
    return this.clamp(100 - cv * 100, 0, 100);
  }

  private offTaskAfterStart(events: EventView[], starts: EventView[]): { offTask: number; total: number } {
    if (!starts.length) return { offTask: 0, total: 0 };
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
      count += events.filter(
        (event) => event.time !== undefined && start !== undefined && end !== undefined && event.time > start && event.time < end && ACTION_EVENTS.has(event.type)
      ).length;
    }
    return count;
  }

  private afterLast(exports: EventView[], events: EventView[]): number {
    const lastExport = exports[exports.length - 1]?.time;
    return lastExport === undefined ? 0 : events.filter((event) => event.time !== undefined && event.time > lastExport).length;
  }

  private changesAfterTaskFinish(changes: EventView[], finishes: EventView[]): number {
    return changes.filter((change) =>
      finishes.some((finish) => finish.taskId === change.taskId && change.time !== undefined && finish.time !== undefined && change.time > finish.time)
    ).length;
  }

  private windowCounts(events: EventView[], sizeMs: number): number[] {
    const windows = this.countBy(events.filter((event) => event.time !== undefined), (event) => String(Math.floor((event.time ?? 0) / sizeMs)));
    return Array.from(windows.values());
  }

  private incrementalEditBlocks(changes: EventView[]): { small: number; total: number } {
    const timed = changes.filter((event): event is EventView & { time: number } => Number.isFinite(event.time));
    const byFile = new Map<string, (EventView & { time: number })[]>();
    for (const change of timed) {
      if (!change.file) continue;
      byFile.set(change.file, [...(byFile.get(change.file) ?? []), change]);
    }
    let total = 0;
    let small = 0;
    for (const list of byFile.values()) {
      const ordered = [...list].sort((a, b) => a.time - b.time);
      let block: (EventView & { time: number })[] = [];
      const flushBlock = (): void => {
        if (!block.length) return;
        total += 1;
        if (block.every((event) => event.changeCount <= SMALL_EVENT_MAX_LINES)) small += 1;
        block = [];
      };
      ordered.forEach((event, index) => {
        if (index > 0 && event.time - ordered[index - 1].time > 30_000) flushBlock();
        block.push(event);
      });
      flushBlock();
    }
    return { small, total };
  }

  private readEditCycles(events: EventView[]): number {
    let count = 0;
    for (let index = 0; index < events.length; index += 1) {
      const read = events[index];
      if (read.type !== "active_editor_changed" || !read.file || read.time === undefined) continue;
      const edit = events.slice(index + 1).find((event) => event.type === "file_changed" && event.file === read.file && event.time !== undefined);
      if (edit?.time !== undefined && edit.time - read.time <= READ_EDIT_WINDOW_MS) count += 1;
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
        if ((ordered[index].time ?? 0) - (ordered[index - 1].time ?? 0) > REFINEMENT_BLOCK_GAP_MINUTES * 60_000) count += 1;
      }
      blocks.set(file, count);
    }
    return blocks;
  }

  private hashDiscontinuities(events: LearningEvent[]): number {
    let count = 0;
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].previousHash !== events[index - 1].hash) count += 1;
    }
    return count;
  }

  private sequenceScore(events: EventView[]): number {
    const changed = events.find((event) => event.type === "file_changed")?.time;
    const saved = events.find((event) => event.type === "file_saved" && changed !== undefined && event.time !== undefined && event.time >= changed)?.time;
    const finished = events.find((event) => this.isTaskFinished(event.type) && saved !== undefined && event.time !== undefined && event.time >= saved)?.time;
    const exported = events.find((event) => event.type === "submission_exported" && finished !== undefined && event.time !== undefined && event.time >= finished)?.time;
    return [changed, saved, finished, exported].filter((value) => value !== undefined).length / 4;
  }

  private protectedEditSequences(ordered: EventView[]): { opened: EventView; change: EventView; file: string }[] {
    const sequences: { opened: EventView; change: EventView; file: string }[] = [];
    let protectedOpen: (EventView & { time: number; file: string }) | undefined;
    for (const event of ordered) {
      if (event.type === "active_editor_changed" && event.file) {
        protectedOpen = this.isProtected(event.file) ? (event as EventView & { time: number; file: string }) : undefined;
        continue;
      }
      if (
        protectedOpen &&
        event.time !== undefined &&
        ["file_changed", "file_saved", "file_created", "file_deleted"].includes(event.type) &&
        event.time - protectedOpen.time <= PROTECTED_EDIT_WINDOW_MS &&
        (!event.file || event.file === protectedOpen.file)
      ) {
        sequences.push({ opened: protectedOpen, change: event, file: protectedOpen.file });
        protectedOpen = undefined;
      }
      if (protectedOpen && event.time !== undefined && event.time - protectedOpen.time > PROTECTED_EDIT_WINDOW_MS) {
        protectedOpen = undefined;
      }
    }
    return sequences;
  }

  private taskDurations(
    events: EventView[],
    starts: EventView[],
    finishes: EventView[]
  ): { taskId: string; minutes: number; estimated: boolean }[] {
    return starts.map((start) => {
      const finish = finishes.find(
        (item) => item.taskId === start.taskId && item.time !== undefined && start.time !== undefined && item.time >= start.time
      );
      const lastTaskEvent = [...events].reverse().find((item) => item.taskId === start.taskId && item.time !== undefined);
      const end = finish?.time ?? lastTaskEvent?.time ?? start.time;
      return {
        taskId: start.taskId ?? "-",
        minutes: this.minutesBetween(start.time, end),
        estimated: !finish
      };
    });
  }
}
