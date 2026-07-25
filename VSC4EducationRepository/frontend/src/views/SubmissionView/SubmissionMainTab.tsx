import { t } from "../../i18n";
import type { SubmissionDetail, SubmissionReview } from "../../types";
import { ObservableAgencyPanel } from "./ObservableAgencyPanel";

export function SubmissionMainTab(props: { submission: SubmissionDetail; review: SubmissionReview | null }) {
  const { submission, review } = props;
  return (
    <>
      {review && <ObservableAgencyPanel agency={review.agencyMetrics.observableAgency} />}
      <div className="twoColumns">
        <section className="tablePanel">
          <h2>{t("Tasks")}</h2>
          <table>
            <thead>
              <tr>
                <th>{t("Task")}</th>
                <th>{t("Status")}</th>
                <th>{t("Duration")}</th>
                <th>{t("Saves")}</th>
                <th>{t("Files")}</th>
              </tr>
            </thead>
            <tbody>
              {submission.task_states.map((task) => (
                <tr key={task.id}>
                  <td>{task.task_id}</td>
                  <td>{task.status || t("No status")}</td>
                  <td>{task.duration_seconds ? `${Math.round(task.duration_seconds / 60)} min` : "-"}</td>
                  <td>{task.save_count}</td>
                  <td>{task.modified_files_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="tablePanel">
          <h2>{t("Events")}</h2>
          <table>
            <thead>
              <tr>
                <th>{t("Type")}</th>
                <th>{t("Count")}</th>
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
  );
}
