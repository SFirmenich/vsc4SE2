import { useState } from "react";
import { Bot } from "lucide-react";
import { t } from "../../i18n";
import type { SubmissionReview } from "../../types";
import { EmptyState } from "../../components/EmptyState";

export function SubmissionAgentsTab(props: { review: SubmissionReview | null }) {
  const [agentFilter, setAgentFilter] = useState("");
  const filteredInteractions = (props.review?.agentInteractions ?? []).filter((interaction) => {
    const query = agentFilter.toLowerCase();
    return !query || [interaction.actor, interaction.agent, interaction.taskId, interaction.sessionId, interaction.message].some((value) => String(value ?? "").toLowerCase().includes(query));
  });

  return (
    <section className="tablePanel">
      <div className="panelHeader">
        <h2><Bot size={18} /> {t("Agent conversations")}</h2>
        <input value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} placeholder={t("Filter by actor, agent, task, or text")} />
      </div>
      {filteredInteractions.length ? (
        <div className="conversationList">
          {filteredInteractions.map((interaction, index) => (
            <article className={`messageItem ${interaction.actor}`} key={`${interaction.timestamp}-${index}`}>
              <div>
                <strong>{interaction.actor === "student" ? t("Student") : interaction.agent || t("Agent")}</strong>
                <span>{interaction.timestamp}{interaction.taskId ? ` - ${interaction.taskId}` : ""}</span>
              </div>
              <p>{interaction.message}</p>
            </article>
          ))}
        </div>
      ) : <EmptyState text={t("No agent conversations are recorded for this submission.")} />}
      {(props.review?.agentInteractionErrors.length ?? 0) > 0 && (
        <div className="warningBlock">
          <strong>{t("Reading issues")}</strong>
          {props.review?.agentInteractionErrors.map((error) => <span key={error}>{error}</span>)}
        </div>
      )}
    </section>
  );
}
