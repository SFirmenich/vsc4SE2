import { useState } from "react";
import { ChevronDown, ChevronRight, Clipboard, KeyRound } from "lucide-react";
import { postJson, repositoryBaseUrl } from "../../api";
import type { ActivityVersion, ActivityVersionDetail, CourseGroup, EventIngestionTokenResponse } from "../../types";
import { t } from "../../i18n";
import { errorMessage } from "../../lib/errors";
import { eventServerConfigurationFromManifest } from "../../lib/manifest";

export function EventServerConfigPanel(props: {
  activity: ActivityVersion;
  activityDetail: ActivityVersionDetail | null;
  groups: CourseGroup[];
}) {
  const [tokenName, setTokenName] = useState("Teacher panel");
  const [courseGroupId, setCourseGroupId] = useState("");
  const [token, setToken] = useState<EventIngestionTokenResponse | null>(null);
  const [tokenError, setTokenError] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manuallyShowForm, setManuallyShowForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const baseUrl = repositoryBaseUrl();
  const manifestEventServer = eventServerConfigurationFromManifest(props.activityDetail?.manifest);
  const hasExistingConfig = Boolean(manifestEventServer);
  const showForm = !hasExistingConfig || manuallyShowForm || Boolean(token);
  const showDetails = !hasExistingConfig || expanded;
  const generatedEventServerConfiguration = token ? {
    enabled: true,
    baseUrl,
    activityVersionId: props.activity.id,
    ingestionToken: token.token,
    publicSigningKeyUrl: `${baseUrl}/api/integration/student/event-signing-key/`,
    expectedSigningKeyId: token.expectedSigningKeyId,
    expectedPublicKeySha256: token.expectedPublicKeySha256,
    publicSigningKey: token.publicSigningKey,
    requireReceipts: false,
  } : null;
  const eventServerConfiguration = generatedEventServerConfiguration ?? manifestEventServer;
  const configurationText = eventServerConfiguration
    ? JSON.stringify(eventServerConfiguration, null, 2)
    : "";

  async function issueToken() {
    setTokenLoading(true);
    setTokenError("");
    setCopied(false);
    try {
      setToken(await postJson<EventIngestionTokenResponse>(
        `/activity-versions/${props.activity.id}/event-ingestion-token/`,
        {
          name: tokenName,
          courseGroupId: courseGroupId ? Number(courseGroupId) : undefined,
        },
      ));
    } catch (error) {
      setTokenError(errorMessage(error));
    } finally {
      setTokenLoading(false);
    }
  }

  async function copyConfiguration() {
    if (!configurationText) {
      return;
    }
    await navigator.clipboard.writeText(configurationText);
    setCopied(true);
  }

  return (
    <section className="detailPanel">
      <div
        className={hasExistingConfig ? "accordionHeader" : undefined}
        onClick={hasExistingConfig ? () => setExpanded((value) => !value) : undefined}
        role={hasExistingConfig ? "button" : undefined}
        aria-expanded={hasExistingConfig ? expanded : undefined}
      >
        <span className="eyebrow">{t("Teacher configuration")}</span>
        <h2>
          <KeyRound size={18} /> {hasExistingConfig ? t("Event Server settings") : t("Create Event Server settings")}
          {hasExistingConfig && (
            expanded
              ? <ChevronDown size={18} style={{ marginLeft: "auto" }} />
              : <ChevronRight size={18} style={{ marginLeft: "auto" }} />
          )}
        </h2>
        <p>
          {hasExistingConfig && !showForm
            ? t("This activity version already has an ingestion configuration. Regenerating will issue a new token and replace it.")
            : t("Generate an ingestion token for this activity version, then copy the JSON into the Teacher extension Event Server tab.")}
        </p>
      </div>
      {showDetails && (
        <>
          {hasExistingConfig && !showForm && (
            <button className="ghostButton" onClick={() => setManuallyShowForm(true)}>
              <KeyRound size={17} /> {t("Regenerate config")}
            </button>
          )}
          {showForm && (
            <div className="eventConfigGrid">
              <label>
                <span>{t("Token name")}</span>
                <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
              </label>
              <label>
                <span>{t("Course group")}</span>
                <select value={courseGroupId} onChange={(event) => setCourseGroupId(event.target.value)}>
                  <option value="">{t("Any group")}</option>
                  {props.groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}{group.term ? ` - ${group.term}` : ""}</option>
                  ))}
                </select>
              </label>
              <button className="ghostButton" onClick={() => void issueToken()} disabled={tokenLoading}>
                <KeyRound size={17} /> {tokenLoading ? t("Generating") : t("Generate config")}
              </button>
              {hasExistingConfig && !token && (
                <button className="ghostButton" onClick={() => setManuallyShowForm(false)}>
                  {t("Cancel")}
                </button>
              )}
            </div>
          )}
          {tokenError && <div className="inlineError">{tokenError}</div>}
          {eventServerConfiguration && (
            <div className="copyBlock">
              <div className="copyBlockHeader">
                <strong>{generatedEventServerConfiguration ? t("Configuration for manifest.repository.eventServer") : t("Current manifest.repository.eventServer")}</strong>
                <button className="ghostButton" onClick={() => void copyConfiguration()}>
                  <Clipboard size={17} /> {copied ? t("Copied") : t("Copy JSON")}
                </button>
              </div>
              <pre>{configurationText}</pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
