import { BookOpen } from "lucide-react";
import { t } from "../i18n";
import type { ActivityVersion, Course, CourseGroup } from "../types";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/EmptyState";
import { ZipUploadPanel } from "../components/ZipUploadPanel";
import { ActivityDraftPanel } from "../components/ActivityDraftPanel";

export function CourseActivitiesView(props: {
  course: Course;
  groups: CourseGroup[];
  activities: ActivityVersion[];
  addPanel: string | null;
  onAdd: () => void;
  onUpload: (file: File, groupId: string) => void;
  onRegisterDraft: (form: FormData) => void;
  onOpen: (activity: ActivityVersion) => void;
}) {
  return (
    <>
      <SectionHeader icon={<BookOpen size={20} />} title={t("Learning activities for {0}", props.course.name)} actionLabel={t("Add activity")} onAction={props.onAdd} />
      {props.addPanel === "activity" && (
        <div className="twoColumns">
          <ZipUploadPanel label={t("Activity ZIP")} groups={props.groups} onUpload={props.onUpload} />
          <ActivityDraftPanel groups={props.groups} onRegister={props.onRegisterDraft} />
        </div>
      )}
      <div className="listPanel">
        {props.activities.map((activity) => (
          <button key={activity.id} className="listItem" onClick={() => props.onOpen(activity)}>
            <div>
              <strong>{activity.title}{activity.status === "draft" && <span className="badge">{t("Draft")}</span>}</strong>
              <span>{activity.activityId}@{activity.version}</span>
            </div>
            <div className="itemMeta">
              <span>{(activity.courseGroups ?? []).map((group) => group.name).join(", ") || t("No group")}</span>
              <b>{activity.submissionCount} {t("submissions")}</b>
            </div>
          </button>
        ))}
      </div>
      {props.activities.length === 0 && <EmptyState text={t("This course does not have activities yet.")} />}
    </>
  );
}
