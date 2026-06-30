import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, BookOpen, FileArchive, GraduationCap, Plus, RefreshCw, Upload, UserRound } from "lucide-react";
import { getJson, postJson, uploadZip } from "./api";
import type {
  ActivityVersion,
  ActivityVersionDetail,
  Course,
  CourseGroup,
  Metrics,
  Submission,
  SubmissionDetail,
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
    const detail = await getJson<SubmissionDetail>(`/submissions/${submission.id}/`);
    setSubmissionDetail(detail);
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
          <SubmissionView submission={submissionDetail} />
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

function SubmissionView(props: { submission: SubmissionDetail }) {
  const submission = props.submission;
  return (
    <>
      <SectionHeader icon={<UserRound size={20} />} title={submission.student.display_name || submission.student.institutional_id} />
      <section className="detailPanel">
        <div className="metrics">
          <Metric label="Eventos" value={submission.event_count} />
          <Metric label="Interacciones agente" value={submission.agent_interaction_count} />
          <Metric label="Git" value={submission.has_git ? "Sí" : "No"} />
          <Metric label="Warnings" value={submission.warning_count} />
        </div>
      </section>

      <div className="twoColumns">
        <section className="tablePanel">
          <h2>Tareas</h2>
          <table>
            <thead>
              <tr>
                <th>Tarea</th>
                <th>Estado</th>
                <th>Duración</th>
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
