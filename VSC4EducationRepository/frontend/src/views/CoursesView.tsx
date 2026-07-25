import { GraduationCap } from "lucide-react";
import { t } from "../i18n";
import type { Course, CourseGroup } from "../types";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/EmptyState";

export function CoursesView(props: {
  courses: Course[];
  groups: CourseGroup[];
  addPanel: string | null;
  onAdd: () => void;
  onCreate: (form: FormData) => void;
  onOpen: (course: Course) => void;
}) {
  return (
    <>
      <SectionHeader icon={<GraduationCap size={20} />} title={t("Courses")} actionLabel={t("Add course")} onAction={props.onAdd} />
      {props.addPanel === "course" && (
        <form className="formPanel" onSubmit={(event) => {
          event.preventDefault();
          props.onCreate(new FormData(event.currentTarget));
          event.currentTarget.reset();
        }}>
          <input name="name" placeholder={t("Course name")} required />
          <input name="code" placeholder={t("Code")} />
          <input name="description" placeholder={t("Description")} />
          <input name="groupName" placeholder={t("Initial group")} required />
          <input name="term" placeholder={t("Term")} />
          <button>{t("Save")}</button>
        </form>
      )}
      <div className="cardGrid">
        {props.courses.map((course) => {
          const groups = props.groups.filter((group) => group.course === course.id);
          return (
            <button key={course.id} className="entityCard" onClick={() => props.onOpen(course)}>
              <span className="eyebrow">{course.code || t("No code")}</span>
              <strong>{course.name}</strong>
              <small>{groups.length} {groups.length === 1 ? t("group") : t("groups")}</small>
            </button>
          );
        })}
      </div>
      {props.courses.length === 0 && <EmptyState text={t("No courses yet.")} />}
    </>
  );
}
