import { t } from "../i18n";
import type { CourseGroup } from "../types";

export function ActivityDraftPanel(props: { groups: CourseGroup[]; onRegister: (form: FormData) => void }) {
  return (
    <form className="formPanel stacked" onSubmit={(event) => {
      event.preventDefault();
      props.onRegister(new FormData(event.currentTarget));
    }}>
      <span className="eyebrow">{t("Register activity draft")}</span>
      <input name="activityId" placeholder={t("Activity ID")} required />
      <input name="version" placeholder={t("Version")} defaultValue="1.0.0" required />
      <input name="title" placeholder={t("Title")} required />
      <input name="description" placeholder={t("Description")} />
      <select name="courseGroupId" required>
        <option value="">{t("Choose group")}</option>
        {props.groups.map((group) => (
          <option key={group.id} value={group.id}>{group.name}{group.term ? ` - ${group.term}` : ""}</option>
        ))}
      </select>
      <button>{t("Register draft")}</button>
      <p>{t("Use this when the Teacher ZIP does not exist yet and you need Event Server configuration first.")}</p>
    </form>
  );
}
