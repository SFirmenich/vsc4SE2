import { useState } from "react";
import { t } from "../i18n";
import type { CourseGroup } from "../types";

export function ZipUploadPanel(props: { label: string; groups: CourseGroup[]; includeName?: boolean; onUpload: (file: File, groupId: string, submissionName?: string) => void }) {
  const [groupId, setGroupId] = useState(props.groups[0]?.id ? String(props.groups[0].id) : "");
  const [submissionName, setSubmissionName] = useState("");
  return (
    <section className="formPanel horizontal">
      {props.includeName && (
        <label>
          {t("Name")}
          <input value={submissionName} onChange={(event) => setSubmissionName(event.target.value)} placeholder={t("Group A, official solution...")} />
        </label>
      )}
      <label>
        {props.label}
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              props.onUpload(file, groupId, submissionName.trim());
            }
          }}
        />
      </label>
      <label>
        {t("Group")}
        <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
          <option value="">{t("Choose group")}</option>
          {props.groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}{group.term ? ` - ${group.term}` : ""}</option>
          ))}
        </select>
      </label>
    </section>
  );
}
