import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, ArrowLeft, Bot, BookOpen, FileArchive, GraduationCap, Plus, RefreshCw, ShieldCheck, Upload, UserRound } from "lucide-react";
import { getJson, postJson, uploadZip } from "./api";
import type {
  ActivityVersion,
  ActivityVersionDetail,
  Course,
  CourseGroup,
  Metrics,
  Submission,
  SubmissionDetail,
  SubmissionReview,
} from "./types";
import "./styles.css";

type View = "courses" | "course" | "activity" | "submission";

function App() {
  const [view, setView] = useState<View>("courses");
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
  const [activities, setActivities] = useState<ActivityVersion[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [activityDetail, setActivityDetail] = useState<ActivityVersionDetail | null>(null);
  const [submissionDetail, setSubmissionDetail] = useState<SubmissionDetail | null>(null);
  const [submissionReview, setSubmissionReview] = useState<SubmissionReview | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityVersion | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [addPanel, setAddPanel] = useState<"course" | "activity" | "submission" | null>(null);
  const [message, setMessage] = useState("");

  const selectedCourseGroups = useMemo(
    () => courseGroups.filter((group) => group.course === selectedCourse?.id),
    [courseGroups, selectedCourse],
  );

  async function loadCourses() {
    const [nextCourses, nextGroups] = await Promise.all([
      getJson<Course[]>("/courses/"),
      getJson<CourseGroup[]>("/course-groups/"),
    ]);
    setCourses(nextCourses);
    setCourseGroups(nextGroups);
  }

  async function openCourse(course: Course) {
    setSelectedCourse(course);
    setSelectedActivity(null);
    setActivityDetail(null);
    setSelectedSubmission(null);
    setSubmissionDetail(null);
    setSubmissionReview(null);
    setActivities([]);
    setView("course");
    setAddPanel(null);
    try {
      const nextGroups = await getJson<CourseGroup[]>("/course-groups/");
      const courseGroupsForCourse = nextGroups.filter((group) => group.course === course.id);
      const activityLists = await Promise.all(
        courseGroupsForCourse.map(async (group) => {
          const groupActivities = await getJson<ActivityVersion[]>(`/course-groups/${group.id}/activities/`);
          return groupActivities.map((activity) => ({
            ...activity,
            courseGroups: mergeGroups(activity.courseGroups ?? [], [group]),
          }));
        }),
      );
      const nextActivities = mergeActivities(activityLists.flat());
      setCourseGroups(nextGroups);
      setActivities(nextActivities);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function openActivity(activity: ActivityVersion) {
    setSelectedActivity(activity);
    setSelectedSubmission(null);
    setSubmissionDetail(null);
    setSubmissionReview(null);
    const [detail, nextSubmissions, nextMetrics] = await Promise.all([
      getJson<ActivityVersionDetail>(`/activity-versions/${activity.id}/`),
      getJson<Submission[]>(`/activity-versions/${activity.id}/submissions/${selectedCourse ? `?courseId=${selectedCourse.id}` : ""}`),
      getJson<Metrics>(`/activity-versions/${activity.id}/metrics/`),
    ]);
    setActivityDetail(detail);
    setSubmissions(nextSubmissions);
    setMetrics(nextMetrics);
    setView("activity");
    setAddPanel(null);
  }

  async function openSubmission(submission: Submission) {
    setSelectedSubmission(submission);
    const [detail, review] = await Promise.all([
      getJson<SubmissionDetail>(`/submissions/${submission.id}/`),
      getJson<SubmissionReview>(`/submissions/${submission.id}/review/`),
    ]);
    setSubmissionDetail(detail);
    setSubmissionReview(review);
    setView("submission");
    setAddPanel(null);
  }

  async function createCourse(form: FormData) {
    const course = await postJson<Course>("/courses/", {
      name: form.get("name"),
      code: form.get("code"),
      description: form.get("description"),
    });
    await postJson<CourseGroup>("/course-groups/", {
      course: course.id,
      name: form.get("groupName"),
      term: form.get("term"),
      description: "",
    });
    setMessage("Asignatura creada.");
    setAddPanel(null);
    await loadCourses();
  }

  async function importActivity(file: File, courseGroupId: string) {
    if (!courseGroupId) {
      setMessage("Elegí una comisión para asociar la actividad.");
      return;
    }
    const imported = await uploadZip<ActivityVersion>("/activities/import-zip/", file, { courseGroupId });
    setMessage("Actividad agregada.");
    setAddPanel(null);
    if (selectedCourse) {
      await openCourse(selectedCourse);
      await openActivity(imported);
    }
  }

  async function importSubmission(file: File, courseGroupId: string) {
    if (!selectedActivity) {
      return;
    }
    if (!courseGroupId) {
      setMessage("Elegí una comisión para asociar la entrega.");
      return;
    }
    await uploadZip<Submission>(`/activity-versions/${selectedActivity.id}/submissions/import-zip/`, file, { courseGroupId });
    setMessage("Entrega agregada.");
    setAddPanel(null);
    await openActivity(selectedActivity);
  }

  function goBack() {
    if (view === "submission" && selectedActivity) {
      setView("activity");
      return;
    }
    if (view === "activity" && selectedCourse) {
      setView("course");
      return;
    }
    setView("courses");
  }

  useEffect(() => {
    loadCourses().catch((error) => setMessage(errorMessage(error)));
  }, []);

  return (
    <main>
      <header className="appHeader">
        <div>
          <h1>VSCode4Education Repository</h1>
          <p>{subtitle(view, selectedCourse, selectedActivity, selectedSubmission)}</p>
        </div>
        <div className="headerActions">
          {view !== "courses" && (
            <button className="ghostButton" onClick={goBack}>
              <ArrowLeft size={17} /> Volver
            </button>
          )}
          <button className="iconButton" onClick={() => loadCourses().catch((error) => setMessage(errorMessage(error)))} title="Actualizar">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      {message && <button className="notice" onClick={() => setMessage("")}>{message}</button>}

      <section className="page">
        {view === "courses" && (
          <CoursesView
            courses={courses}
            groups={courseGroups}
            addPanel={addPanel}
            onAdd={() => setAddPanel(addPanel === "course" ? null : "course")}
            onCreate={(form) => createCourse(form).catch((error) => setMessage(errorMessage(error)))}
            onOpen={(course) => {
              void openCourse(course);
            }}
          />
        )}

        {view === "course" && selectedCourse && (
          <CourseActivitiesView
            course={selectedCourse}
            groups={selectedCourseGroups}
            activities={activities}
            addPanel={addPanel}
            onAdd={() => setAddPanel(addPanel === "activity" ? null : "activity")}
            onUpload={(file, groupId) => importActivity(file, groupId).catch((error) => setMessage(errorMessage(error)))}
            onOpen={openActivity}
          />
        )}

        {view === "activity" && selectedActivity && (
          <ActivityView
            activity={activityDetail}
            fallbackActivity={selectedActivity}
            groups={selectedCourseGroups}
            submissions={submissions}
            metrics={metrics}
            addPanel={addPanel}
            onAdd={() => setAddPanel(addPanel === "submission" ? null : "submission")}
            onUpload={(file, groupId) => importSubmission(file, groupId).catch((error) => setMessage(errorMessage(error)))}
            onOpen={openSubmission}
          />
        )}

        {view === "submission" && submissionDetail && (
          <SubmissionView submission={submissionDetail} review={submissionReview} />
        )}
      </section>
    </main>
  );
}

function CoursesView(props: {
  courses: Course[];
  groups: CourseGroup[];
  addPanel: string | null;
  onAdd: () => void;
  onCreate: (form: FormData) => void;
  onOpen: (course: Course) => void;
}) {
  return (
    <>
      <SectionHeader icon={<GraduationCap size={20} />} title="Asignaturas" actionLabel="Agregar asignatura" onAction={props.onAdd} />
      {props.addPanel === "course" && (
        <form className="formPanel" onSubmit={(event) => {
          event.preventDefault();
          props.onCreate(new FormData(event.currentTarget));
          event.currentTarget.reset();
        }}>
          <input name="name" placeholder="Nombre de la asignatura" required />
          <input name="code" placeholder="Código" />
          <input name="description" placeholder="Descripción" />
          <input name="groupName" placeholder="Comisión inicial" required />
          <input name="term" placeholder="Periodo" />
          <button>Guardar</button>
        </form>
      )}
      <div className="cardGrid">
        {props.courses.map((course) => {
          const groups = props.groups.filter((group) => group.course === course.id);
          return (
            <button key={course.id} className="entityCard" onClick={() => props.onOpen(course)}>
              <span className="eyebrow">{course.code || "Sin código"}</span>
              <strong>{course.name}</strong>
              <small>{groups.length} comisión{groups.length === 1 ? "" : "es"}</small>
            </button>
          );
        })}
      </div>
      {props.courses.length === 0 && <EmptyState text="No hay asignaturas todavía." />}
    </>
  );
}

function CourseActivitiesView(props: {
  course: Course;
  groups: CourseGroup[];
  activities: ActivityVersion[];
  addPanel: string | null;
  onAdd: () => void;
  onUpload: (file: File, groupId: string) => void;
  onOpen: (activity: ActivityVersion) => void;
}) {
  return (
    <>
      <SectionHeader icon={<BookOpen size={20} />} title={`Learning activities de ${props.course.name}`} actionLabel="Agregar actividad" onAction={props.onAdd} />
      {props.addPanel === "activity" && <ZipUploadPanel label="ZIP de actividad" groups={props.groups} onUpload={props.onUpload} />}
      <div className="listPanel">
        {props.activities.map((activity) => (
          <button key={activity.id} className="listItem" onClick={() => props.onOpen(activity)}>
            <div>
              <strong>{activity.title}</strong>
              <span>{activity.activityId}@{activity.version}</span>
            </div>
            <div className="itemMeta">
              <span>{(activity.courseGroups ?? []).map((group) => group.name).join(", ") || "Sin comisión"}</span>
              <b>{activity.submissionCount} entregas</b>
            </div>
          </button>
        ))}
      </div>
      {props.activities.length === 0 && <EmptyState text="Esta asignatura todavía no tiene actividades." />}
    </>
  );
}

function ActivityView(props: {
  activity: ActivityVersionDetail | null;
  fallbackActivity: ActivityVersion;
  groups: CourseGroup[];
  submissions: Submission[];
  metrics: Metrics | null;
  addPanel: string | null;
  onAdd: () => void;
  onUpload: (file: File, groupId: string) => void;
  onOpen: (submission: Submission) => void;
}) {
  const activity = props.activity;
  return (
    <>
      <SectionHeader icon={<FileArchive size={20} />} title={activity?.title ?? props.fallbackActivity.title} actionLabel="Agregar entrega" onAction={props.onAdd} />
      <section className="detailPanel">
        <div>
          <span className="eyebrow">{props.fallbackActivity.activityId}@{props.fallbackActivity.version}</span>
          <p>{activity?.description || props.fallbackActivity.description || "Sin descripción."}</p>
        </div>
        <div className="metrics">
          <Metric label="Entregas" value={props.metrics?.submissions ?? props.submissions.length} />
          <Metric label="Estudiantes" value={props.metrics?.uniqueStudents ?? 0} />
          <Metric label="Eventos promedio" value={(props.metrics?.averageEvents ?? 0).toFixed(1)} />
          <Metric label="Con Git" value={`${Math.round((props.metrics?.withGitRatio ?? 0) * 100)}%`} />
        </div>
        {activity?.tasks.length ? (
          <div className="taskStrip">
            {activity.tasks.map((task) => (
              <span key={task.id}>{task.task_id}: {task.title}</span>
            ))}
          </div>
        ) : null}
      </section>

      {props.addPanel === "submission" && <ZipUploadPanel label="ZIP de entrega" groups={props.groups} onUpload={props.onUpload} />}

      <section className="tablePanel">
        <h2><Upload size={18} /> Entregas</h2>
        <table>
          <thead>
            <tr>
              <th>Estudiante</th>
              <th>Comisión</th>
              <th>Eventos</th>
              <th>Agente</th>
              <th>Git</th>
              <th>Warnings</th>
              <th>Importada</th>
            </tr>
          </thead>
          <tbody>
            {props.submissions.map((submission) => (
              <tr key={submission.id} onClick={() => props.onOpen(submission)}>
                <td>{submission.student.display_name || submission.student.institutional_id}</td>
                <td>{submission.courseGroup?.name ?? "Sin comisión"}</td>
                <td>{submission.event_count}</td>
                <td>{submission.agent_interaction_count}</td>
                <td>{submission.has_git ? "Sí" : "No"}</td>
                <td>{submission.warning_count}</td>
                <td>{new Date(submission.imported_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {props.submissions.length === 0 && <EmptyState text="Todavía no hay entregas para esta actividad." />}
      </section>
    </>
  );
}

function SubmissionView(props: { submission: SubmissionDetail; review: SubmissionReview | null }) {
  const submission = props.submission;
  const review = props.review;
  const [tab, setTab] = useState<"main" | "agents" | "metrics" | "integrity">("main");
  const [agentFilter, setAgentFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const filteredInteractions = (review?.agentInteractions ?? []).filter((interaction) => {
    const query = agentFilter.toLowerCase();
    return !query || [interaction.actor, interaction.agent, interaction.taskId, interaction.sessionId, interaction.message].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  const filteredEvents = (review?.events ?? []).filter((event) => {
    const query = eventFilter.toLowerCase();
    return !query || JSON.stringify(event).toLowerCase().includes(query);
  });

  return (
    <>
      <SectionHeader icon={<UserRound size={20} />} title={submission.student.display_name || submission.student.institutional_id} />
      <section className="detailPanel">
        <div className="metrics">
          <Metric label="Eventos" value={submission.event_count} />
          <Metric label="Interacciones agente" value={submission.agent_interaction_count} />
          <Metric label="Git" value={submission.has_git ? "Si" : "No"} />
          <Metric label="Warnings" value={submission.warning_count} />
        </div>
        {review && (
          <div className="metrics">
            <Metric label="Agencia" value={`${review.summary.agency.level} (${review.summary.agency.score}/6)`} />
            <Metric label="Lineas unicas" value={review.summary.uniqueLinesTouched} />
            <Metric label="Tiempo activo" value={`${review.summary.activeMinutes} min`} />
            <Metric label="Integridad" value={integrityLabel(review.integrity.status)} />
          </div>
        )}
      </section>

      <nav className="tabs" aria-label="Entrega">
        <button className={tab === "main" ? "active" : ""} onClick={() => setTab("main")}><Activity size={16} /> Principal</button>
        <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}><Bot size={16} /> Uso de agentes</button>
        <button className={tab === "metrics" ? "active" : ""} onClick={() => setTab("metrics")}><Upload size={16} /> Metricas</button>
        <button className={tab === "integrity" ? "active" : ""} onClick={() => setTab("integrity")}><ShieldCheck size={16} /> Integridad</button>
      </nav>

      {tab === "main" && (
        <>
          {review && (
            <div className="twoColumns">
              <section className="tablePanel">
                <h2>Senales de agencia</h2>
                {review.summary.agency.positives.length ? (
                  <ul className="signalList">{review.summary.agency.positives.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : <p>No hay senales positivas calculadas.</p>}
              </section>
              <section className="tablePanel">
                <h2>Indicadores para revisar</h2>
                {review.summary.agency.concerns.length ? (
                  <ul className="signalList warningText">{review.summary.agency.concerns.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : <p>No hay alertas inmediatas.</p>}
              </section>
            </div>
          )}
          <div className="twoColumns">
            <section className="tablePanel">
              <h2>Tareas</h2>
              <table>
                <thead>
                  <tr>
                    <th>Tarea</th>
                    <th>Estado</th>
                    <th>Duracion</th>
                    <th>Guardados</th>
                    <th>Archivos</th>
                  </tr>
                </thead>
                <tbody>
                  {submission.task_states.map((task) => (
                    <tr key={task.id}>
                      <td>{task.task_id}</td>
                      <td>{task.status || "Sin estado"}</td>
                      <td>{task.duration_seconds ? `${Math.round(task.duration_seconds / 60)} min` : "-"}</td>
                      <td>{task.save_count}</td>
                      <td>{task.modified_files_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="tablePanel">
              <h2>Eventos</h2>
              <table>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {submission.event_summaries.map((event) => (
                    <tr key={event.event_type}>
                      <td>{event.event_type}</td>
                      <td>{event.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}

      {tab === "agents" && (
        <section className="tablePanel">
          <div className="panelHeader">
            <h2><Bot size={18} /> Conversaciones con agentes</h2>
            <input value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} placeholder="Filtrar por actor, agente, tarea o texto" />
          </div>
          {filteredInteractions.length ? (
            <div className="conversationList">
              {filteredInteractions.map((interaction, index) => (
                <article className={`messageItem ${interaction.actor}`} key={`${interaction.timestamp}-${index}`}>
                  <div>
                    <strong>{interaction.actor === "student" ? "Estudiante" : interaction.agent || "Agente"}</strong>
                    <span>{interaction.timestamp}{interaction.taskId ? ` - ${interaction.taskId}` : ""}</span>
                  </div>
                  <p>{interaction.message}</p>
                </article>
              ))}
            </div>
          ) : <EmptyState text="No hay conversaciones de agente registradas para esta entrega." />}
          {(review?.agentInteractionErrors.length ?? 0) > 0 && (
            <div className="warningBlock">
              <strong>Problemas de lectura</strong>
              {review?.agentInteractionErrors.map((error) => <span key={error}>{error}</span>)}
            </div>
          )}
        </section>
      )}

      {tab === "metrics" && (
        <section className="tablePanel">
          <h2>Metricas de agencia</h2>
          {review ? review.agencyMetrics.groups.map((group) => (
            <div className="metricGroup" key={group.dimension}>
              <h3>{group.dimension}</h3>
              <table>
                <thead>
                  <tr>
                    <th>N</th>
                    <th>Metrica</th>
                    <th>Valor</th>
                    <th>Evidencia</th>
                    <th>Lectura</th>
                  </tr>
                </thead>
                <tbody>
                  {group.metrics.map((metric) => (
                    <tr key={metric.id}>
                      <td><code>{metric.id}</code></td>
                      <td><strong>{metric.name}</strong>{metric.priority && <span className="badge">Prioritaria</span>}<br /><small className={`reliability ${metric.reliability}`}>{metric.reliability}</small></td>
                      <td><strong>{metric.value}{metric.unit ? ` ${metric.unit}` : ""}</strong></td>
                      <td>{metric.detail}<br /><small>{metric.evidenceCount} eventos/senales</small></td>
                      <td>{metric.interpretation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : <EmptyState text="No se pudieron cargar las metricas profundas." />}
        </section>
      )}

      {tab === "integrity" && (
        <div className="twoColumns">
          <section className={`tablePanel integrityPanel ${review?.integrity.status ?? "not_available"}`}>
            <h2><ShieldCheck size={18} /> Cadena hash</h2>
            <div className="integrityStatus">
              <strong>{integrityLabel(review?.integrity.status ?? "not_available")}</strong>
              <span>{review?.integrity.message ?? "No hay datos de integridad disponibles."}</span>
            </div>
            <table>
              <tbody>
                <tr><th>Entradas verificadas</th><td>{review?.integrity.checkedEntries ?? 0}</td></tr>
                <tr><th>Primera linea invalida</th><td>{review?.integrity.firstInvalidLine ?? "-"}</td></tr>
                <tr><th>Lineas JSONL invalidas</th><td>{review?.eventParseErrors.length ?? 0}</td></tr>
              </tbody>
            </table>
          </section>
          <section className="tablePanel">
            <div className="panelHeader">
              <h2>Eventos crudos</h2>
              <input value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} placeholder="Filtrar eventos" />
            </div>
            <div className="eventList">
              {filteredEvents.slice(0, 80).map((event, index) => <pre key={index}>{JSON.stringify(event, null, 2)}</pre>)}
            </div>
            {filteredEvents.length > 80 && <p>Mostrando los primeros 80 eventos filtrados.</p>}
          </section>
        </div>
      )}

      {submission.warnings.length > 0 && (
        <section className="tablePanel warningPanel">
          <h2>Advertencias</h2>
          {submission.warnings.map((warning) => (
            <div className="warningItem" key={warning.id}>
              <strong>{warning.code}</strong>
              <span>{warning.message}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function integrityLabel(status: string) {
  if (status === "valid") return "Valida";
  if (status === "invalid") return "Invalida";
  if (status === "incomplete") return "Incompleta";
  return "No disponible";
}

function SectionHeader(props: { icon: React.ReactNode; title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="sectionHeader">
      <h2>{props.icon} {props.title}</h2>
      {props.actionLabel && props.onAction && (
        <button onClick={props.onAction}>
          <Plus size={17} /> {props.actionLabel}
        </button>
      )}
    </div>
  );
}

function ZipUploadPanel(props: { label: string; groups: CourseGroup[]; onUpload: (file: File, groupId: string) => void }) {
  const [groupId, setGroupId] = useState(props.groups[0]?.id ? String(props.groups[0].id) : "");
  return (
    <section className="formPanel horizontal">
      <label>
        {props.label}
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              props.onUpload(file, groupId);
            }
          }}
        />
      </label>
      <label>
        Comisión
        <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
          <option value="">Elegir comisión</option>
          {props.groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}{group.term ? ` · ${group.term}` : ""}</option>
          ))}
        </select>
      </label>
    </section>
  );
}

function Metric(props: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function EmptyState(props: { text: string }) {
  return <div className="emptyState">{props.text}</div>;
}

function subtitle(view: View, course: Course | null, activity: ActivityVersion | null, submission: Submission | null) {
  if (view === "submission" && submission) {
    return "Detalle de entrega";
  }
  if (view === "activity" && activity) {
    return `${activity.activityId}@${activity.version}`;
  }
  if (view === "course" && course) {
    return course.code ? `${course.name} · ${course.code}` : course.name;
  }
  return "Asignaturas, actividades y entregas";
}

function mergeGroups(current: CourseGroup[], incoming: CourseGroup[]) {
  const map = new Map<number, CourseGroup>();
  [...current, ...incoming].forEach((group) => map.set(group.id, group));
  return Array.from(map.values());
}

function mergeActivities(activities: ActivityVersion[]) {
  const map = new Map<number, ActivityVersion>();
  for (const activity of activities) {
    const existing = map.get(activity.id);
    map.set(activity.id, {
      ...activity,
      courseGroups: mergeGroups(existing?.courseGroups ?? [], activity.courseGroups ?? []),
      submissionCount: Math.max(existing?.submissionCount ?? 0, activity.submissionCount ?? 0),
    });
  }
  return Array.from(map.values());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById("root")!).render(<App />);
