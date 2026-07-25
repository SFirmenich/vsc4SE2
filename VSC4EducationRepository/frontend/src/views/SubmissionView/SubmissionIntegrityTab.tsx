import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { t } from "../../i18n";
import type { SubmissionDetail, SubmissionEventSessions, SubmissionReview } from "../../types";
import { Metric } from "../../components/Metric";
import { integrityLabel } from "../../lib/format";

export function SubmissionIntegrityTab(props: {
  submission: SubmissionDetail;
  review: SubmissionReview | null;
  eventSessions: SubmissionEventSessions | null;
}) {
  const { submission, review } = props;
  const [eventFilter, setEventFilter] = useState("");
  const filteredEvents = (review?.events ?? []).filter((event) => {
    const query = eventFilter.toLowerCase();
    return !query || JSON.stringify(event).toLowerCase().includes(query);
  });

  const liveSessions = props.eventSessions?.sessions ?? [];
  const hasLiveSessions = liveSessions.length > 0;
  const liveEventCount = liveSessions.reduce((sum, session) => sum + session.receiptCount, 0);
  const zipEventCount = submission.event_count;
  const zipEventHashes = new Set(
    (review?.events ?? [])
      .map((event) => event["hash"])
      .filter((hash): hash is string => typeof hash === "string"),
  );
  const hashChainMatches = hasLiveSessions && liveSessions.every(
    (session) => !session.lastEventHash || zipEventHashes.has(session.lastEventHash),
  );
  let syncStatus: string;
  if (!hasLiveSessions) {
    syncStatus = t("Not synced");
  } else if (!hashChainMatches) {
    syncStatus = t("Mismatch");
  } else if (liveEventCount !== zipEventCount) {
    syncStatus = t("Partial");
  } else {
    syncStatus = t("Synced");
  }
  const liveSessionWindow = hasLiveSessions
    ? `${new Date(Math.min(...liveSessions.map((session) => new Date(session.startedAt).getTime()))).toLocaleString()} - ${
        new Date(Math.max(...liveSessions.map((session) => new Date(session.closedAt ?? session.startedAt).getTime()))).toLocaleString()
      }`
    : t("n/d");

  return (
    <>
      <section className="detailPanel">
        <div>
          <span className="eyebrow">{t("Event server")}</span>
          <h2><ShieldCheck size={18} /> {t("Live sync with event server")}</h2>
        </div>
        <div className="metrics">
          <Metric label={t("Sync status")} value={syncStatus} />
          <Metric label={t("Events in .zip")} value={zipEventCount} />
          <Metric label={t("Events received live")} value={hasLiveSessions ? liveEventCount : t("n/d")} />
          <Metric label={t("Hash chain match")} value={hasLiveSessions ? (hashChainMatches ? t("Yes") : t("No")) : t("n/d")} />
          <Metric label={t("Live session window")} value={liveSessionWindow} />
        </div>
      </section>
      <div className="twoColumns">
        <section className={`tablePanel integrityPanel ${review?.integrity.status ?? "not_available"}`}>
          <h2><ShieldCheck size={18} /> {t("Hash chain")}</h2>
          <div className="integrityStatus">
            <strong>{integrityLabel(review?.integrity.status ?? "not_available")}</strong>
            <span>{review?.integrity.message ?? t("No integrity data is available.")}</span>
          </div>
          <table>
            <tbody>
              <tr><th>{t("Verified entries")}</th><td>{review?.integrity.checkedEntries ?? 0}</td></tr>
              <tr><th>{t("First invalid line")}</th><td>{review?.integrity.firstInvalidLine ?? "-"}</td></tr>
              <tr><th>{t("Invalid JSONL lines")}</th><td>{review?.eventParseErrors.length ?? 0}</td></tr>
            </tbody>
          </table>
        </section>
        <section className="tablePanel">
          <div className="panelHeader">
            <h2>{t("Raw events")}</h2>
            <input value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} placeholder={t("Filter events")} />
          </div>
          <div className="eventList">
            {filteredEvents.slice(0, 80).map((event, index) => <pre key={index}>{JSON.stringify(event, null, 2)}</pre>)}
          </div>
          {filteredEvents.length > 80 && <p>{t("Showing the first 80 filtered events.")}</p>}
        </section>
      </div>
    </>
  );
}
