import * as vscode from "vscode";
import { ActivityStatus } from "../types/ActivityStatus";
import { ReviewWorkspaceStatus } from "../services/ReviewWorkspaceService";
import { SubmissionReviewModel } from "./submissionReviewHtml";
import { escapeHtml, nonce } from "./webviewUtils";

export interface RevisionPanelV2Model {
  reviewRoot?: string;
  status?: ReviewWorkspaceStatus;
  activity?: ActivityStatus;
  selectedSubmissionRoot?: string;
  reviewModel?: SubmissionReviewModel;
}

export function revisionPanelV2Html(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  model: RevisionPanelV2Model
): string {
  const scriptNonce = nonce();
  const encoded = JSON.stringify(model).replace(/</g, "\\u003c");
  const vueUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "vue", "dist", "vue.global.prod.js")
  );
  const vuetifyJsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "vuetify", "dist", "vuetify.min.js")
  );
  const vuetifyCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "vuetify", "dist", "vuetify.min.css")
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}' 'unsafe-eval';">
  <title>${escapeHtml("Revision Mode V2")}</title>
  <link nonce="${scriptNonce}" rel="stylesheet" href="${vuetifyCssUri.toString()}">
  <style>
    :root { color-scheme: light dark; }
    html, body, #app { width: 100%; min-width: 0; overflow-x: hidden; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }
    .v-theme--vscodeTheme {
      --v-theme-background: 0, 0, 0;
      --v-theme-surface: 0, 0, 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .v-application, .v-application__wrap, .app-shell, .content, .workspace-shell, .tab-shell, .tab-panel {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    .app-shell { min-height: 100vh; background: var(--vscode-editor-background); }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
    .content { margin: 0; padding: 22px; }
    .workspace-shell { display: block; }
    .v-card, .v-sheet {
      background: var(--vscode-sideBar-background) !important;
      color: var(--vscode-foreground) !important;
      border: 1px solid var(--vscode-panel-border) !important;
    }
    .v-btn { text-transform: none; letter-spacing: 0; }
    .muted { color: var(--vscode-descriptionForeground); }
    .main-tabs, .sub-tabs { width: 100%; }
    .v-table { width: 100%; max-width: 100%; overflow-x: auto; }
    .v-table table { min-width: 760px; }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
      max-height: 520px;
      overflow: auto;
    }
    code { font-family: var(--vscode-editor-font-family); }
    .prompt-card { height: 100%; }
    .event-list { max-height: 580px; overflow: auto; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${scriptNonce}" src="${vueUri.toString()}"></script>
  <script nonce="${scriptNonce}" src="${vuetifyJsUri.toString()}"></script>
  <script nonce="${scriptNonce}">
const vscode = acquireVsCodeApi();
const initialModel = ${encoded};
const { createApp, ref, computed, watch } = Vue;
const { createVuetify } = Vuetify;
const post = (type, data = {}) => vscode.postMessage({ type, ...data });
const pretty = (value) => JSON.stringify(value ?? null, null, 2);
const eventType = (event) => event?.type ?? event?.event ?? 'event';
const eventFile = (event) => event?.file ?? event?.data?.file ?? '';
const prompts = [
  {
    id: 'reviewAgainstRubrics',
    title: 'Review against rubrics',
    description: 'Use the imported activity rubrics, solutions, submission files, and evidence to prepare a criterion-level review.'
  },
  {
    id: 'draftFeedback',
    title: 'Draft student feedback',
    description: 'Create clear formative feedback grounded in the submitted work, rubric criteria, and observed process evidence.'
  },
  {
    id: 'analyzeProcessEvidence',
    title: 'Analyze process evidence',
    description: 'Inspect events, task metadata, Git history, and agent interactions to identify relevant review signals.'
  },
  {
    id: 'inspectAgentUse',
    title: 'Inspect agent use',
    description: 'Review recorded agent interactions and decide whether they support learning, debugging, planning, or unexplained authorship.'
  },
  {
    id: 'integrityAndReceipts',
    title: 'Check integrity and receipts',
    description: 'Interpret local event-chain checks and Repository event-server receipts without treating them as absolute proof.'
  },
  {
    id: 'compareWithReferenceSolution',
    title: 'Compare with solution',
    description: 'Compare the submitted implementation with private reference solutions and list meaningful differences.'
  },
  {
    id: 'followUpQuestions',
    title: 'Prepare follow-up questions',
    description: 'Generate short oral or written questions that help verify understanding and guide the student forward.'
  }
];

const app = createApp({
  setup() {
    const model = ref(initialModel);
    const mainTab = ref('activity');
    const submissionTab = ref('home');
    const selectedSubmissionRoot = ref(initialModel.selectedSubmissionRoot ?? '');
    const selectedStudent = ref('');
    const busy = ref(false);
    const feedbackStatus = ref('pending');
    const feedbackComment = ref('');
    const evaluationsText = ref('[]');
    const filters = ref({ task: '', eventType: '', file: '' });

    const status = computed(() => model.value.status);
    const activity = computed(() => model.value.activity);
    const reviewModel = computed(() => model.value.reviewModel);
    const submissions = computed(() => status.value?.submissions ?? []);
    const manifest = computed(() => activity.value?.manifest ?? reviewModel.value?.submission?.manifest);
    const contributions = computed(() => reviewModel.value?.submission?.contributions ?? []);
    const contribution = computed(() => contributions.value.find((item) => item.studentId === selectedStudent.value));
    const summary = computed(() => (reviewModel.value?.summaries ?? []).find((item) => item.studentId === selectedStudent.value) ?? {});
    const agency = computed(() => (reviewModel.value?.agencyMetrics ?? []).find((item) => item.studentId === selectedStudent.value));
    const agencyV2 = computed(() => (reviewModel.value?.agencyMetricsV2 ?? []).find((item) => item.studentId === selectedStudent.value));
    const filteredEvents = computed(() => {
      const task = filters.value.task;
      const type = filters.value.eventType.trim().toLowerCase();
      const file = filters.value.file.trim().toLowerCase();
      return (contribution.value?.events ?? []).filter((event) => {
        return (!task || event.taskId === task)
          && (!type || String(eventType(event)).toLowerCase().includes(type))
          && (!file || String(eventFile(event)).toLowerCase().includes(file));
      });
    });
    const fileSignals = computed(() => {
      const files = new Set();
      for (const event of contribution.value?.events ?? []) {
        const file = eventFile(event);
        if (file) files.add(file);
      }
      return Array.from(files).sort();
    });
    const rubric = computed(() => reviewModel.value?.rubric);
    const canReview = computed(() => Boolean(status.value?.initialized));

    const syncSelection = () => {
      selectedSubmissionRoot.value = model.value.selectedSubmissionRoot ?? submissions.value[0]?.rootPath ?? '';
      selectedStudent.value = contributions.value[0]?.studentId ?? '';
      feedbackStatus.value = 'pending';
      feedbackComment.value = '';
      evaluationsText.value = JSON.stringify((rubric.value?.criteria ?? []).map((criterion) => ({
        criterionId: criterion.id,
        level: 0,
        score: 0,
        comment: '',
        evidence: []
      })), null, 2);
    };
    syncSelection();

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'model') {
        model.value = event.data.model ?? {};
        syncSelection();
      }
      if (event.data?.type === 'ready') busy.value = false;
      if (event.data?.type === 'commitFiles') {
        busy.value = false;
        vscode.postMessage({ type: 'error', message: 'Changed files: ' + ((event.data.files ?? []).join(', ') || 'none') });
      }
    });

    const run = (type, data = {}) => {
      busy.value = true;
      post(type, data);
    };
    const chooseSubmission = () => {
      if (selectedSubmissionRoot.value) run('selectSubmission', { submissionRoot: selectedSubmissionRoot.value });
    };
    const saveFeedback = () => {
      try {
        run('saveFeedback', {
          feedback: {
            submissionId: reviewModel.value?.submission?.id,
            studentId: selectedStudent.value,
            status: feedbackStatus.value,
            updatedAt: new Date().toISOString(),
            generalComment: feedbackComment.value,
            evaluations: JSON.parse(evaluationsText.value)
          }
        });
      } catch {
        post('error', { message: 'Evaluation JSON is invalid' });
      }
    };

    watch(selectedStudent, () => {
      feedbackStatus.value = 'pending';
      feedbackComment.value = '';
      evaluationsText.value = JSON.stringify((rubric.value?.criteria ?? []).map((criterion) => ({
        criterionId: criterion.id,
        level: 0,
        score: 0,
        comment: '',
        evidence: []
      })), null, 2);
    });

    return {
      model, mainTab, submissionTab, selectedSubmissionRoot, selectedStudent, busy,
      feedbackStatus, feedbackComment, evaluationsText, filters, prompts,
      status, activity, reviewModel, submissions, manifest, contributions, contribution,
      summary, agency, agencyV2, filteredEvents, fileSignals, rubric, canReview, pretty,
      eventType, eventFile, run, chooseSubmission, saveFeedback
    };
  },
  template: \`
    <v-app class="app-shell" theme="vscodeTheme">
      <v-main>
        <div class="topbar">
          <v-container fluid class="content">
            <v-row align="center">
              <v-col>
                <h1 class="text-h4 mb-1">Revision Mode V2</h1>
                <div class="muted">{{ model.reviewRoot || 'Choose a review workspace' }}</div>
              </v-col>
              <v-col cols="auto">
                <v-btn :loading="busy" @click="run('refresh')">Refresh</v-btn>
              </v-col>
            </v-row>
          </v-container>
        </div>

        <v-container fluid class="content">
          <div v-if="!canReview" class="workspace-shell">
            <h2 class="text-h3 mb-8">Submission Review</h2>
            <v-row>
              <v-col cols="12" md="4">
                <v-card class="pa-6" role="button" @click="run('createReviewWorkspace')">
                  <h3 class="text-h5">Create review workspace</h3>
                  <p class="muted mt-2">Choose a folder where the activity and submissions will be imported.</p>
                </v-card>
              </v-col>
              <v-col cols="12" md="4">
                <v-card class="pa-6" role="button" @click="run('openReviewWorkspace')">
                  <h3 class="text-h5">Work on existing review workspace</h3>
                  <p class="muted mt-2">Open a folder that already contains review imports.</p>
                </v-card>
              </v-col>
              <v-col cols="12" md="4">
                <v-card class="pa-6" role="button" @click="run('useCurrentReviewWorkspace')">
                  <h3 class="text-h5">Work on current workspace</h3>
                  <p class="muted mt-2">Use the workspace folder already open in VS Code.</p>
                </v-card>
              </v-col>
            </v-row>
          </div>

          <div v-else class="workspace-shell">
            <v-row align="center" class="mb-6">
              <v-col>
                <h2 class="text-h3 mb-1">{{ manifest?.title || 'Review workspace' }}</h2>
                <div class="muted">{{ status.activityImported ? 'Activity imported' : 'Import the teacher activity ZIP before reviewing submissions' }}</div>
              </v-col>
              <v-col cols="auto">
                <v-btn class="mr-2" @click="run('openReviewWorkspace')">Change folder</v-btn>
                <v-btn color="primary" @click="run('importReviewActivity')">Import activity ZIP</v-btn>
              </v-col>
            </v-row>

            <v-tabs v-model="mainTab" class="main-tabs mb-5" grow>
              <v-tab value="activity">Learning Activity</v-tab>
              <v-tab value="submissions">Submissions</v-tab>
              <v-tab value="prompts">Utils prompts</v-tab>
            </v-tabs>

            <section v-show="mainTab === 'activity'" class="tab-panel">
              <v-row>
                <v-col cols="12" md="3"><v-card class="pa-5"><div class="muted">Tasks</div><div class="text-h4">{{ activity?.counts?.tasks ?? manifest?.tasks?.length ?? 0 }}</div></v-card></v-col>
                <v-col cols="12" md="3"><v-card class="pa-5"><div class="muted">Submissions</div><div class="text-h4">{{ submissions.length }}</div></v-card></v-col>
                <v-col cols="12" md="3"><v-card class="pa-5"><div class="muted">Errors</div><div class="text-h4">{{ activity?.counts?.errors ?? 0 }}</div></v-card></v-col>
                <v-col cols="12" md="3"><v-card class="pa-5"><div class="muted">Warnings</div><div class="text-h4">{{ activity?.counts?.warnings ?? 0 }}</div></v-card></v-col>
              </v-row>
              <v-card class="pa-6 mt-5">
                <h3 class="text-h5 mb-3">Activity definition</h3>
                <p class="muted">{{ manifest?.id }}@{{ manifest?.version }}</p>
                <p>{{ manifest?.description || 'No description.' }}</p>
                <v-btn class="mr-2" @click="run('importReviewActivity')">Import teacher activity ZIP</v-btn>
              </v-card>
              <v-card class="pa-6 mt-5">
                <h3 class="text-h5 mb-3">Tasks</h3>
                <v-table>
                  <thead><tr><th>ID</th><th>Title</th><th>File</th><th>Dependencies</th></tr></thead>
                  <tbody>
                    <tr v-for="task in (manifest?.tasks ?? [])" :key="task.id">
                      <td><code>{{ task.id }}</code></td>
                      <td>{{ task.title }}</td>
                      <td><code>{{ task.file || '-' }}</code></td>
                      <td>{{ (task.dependencies ?? []).join(', ') || 'none' }}</td>
                    </tr>
                  </tbody>
                </v-table>
              </v-card>
              <v-card class="pa-6 mt-5">
                <h3 class="text-h5 mb-3">Validation</h3>
                <pre>{{ pretty(activity?.validation ?? { message: 'No validation data available.' }) }}</pre>
              </v-card>
            </section>

            <section v-show="mainTab === 'submissions'" class="tab-panel">
              <v-card class="pa-5 mb-5">
                <v-row align="center">
                  <v-col cols="12" md="8">
                    <v-select
                      v-model="selectedSubmissionRoot"
                      :items="submissions"
                      item-title="label"
                      item-value="rootPath"
                      label="Submission"
                      hide-details
                      @update:model-value="chooseSubmission"
                    ></v-select>
                  </v-col>
                  <v-col cols="12" md="4" class="text-md-right">
                    <v-btn color="primary" class="mr-2" @click="run('importReviewSubmission')">Import submission ZIP</v-btn>
                    <v-btn @click="run('exportFeedback')" :disabled="!reviewModel">Export feedback</v-btn>
                  </v-col>
                </v-row>
              </v-card>

              <v-card v-if="!reviewModel" class="pa-8">
                <h3 class="text-h5">No submission selected</h3>
                <p class="muted mt-2">Import a student submission ZIP or select an existing imported submission.</p>
              </v-card>

              <div v-else>
                <v-tabs v-model="submissionTab" class="sub-tabs mb-5" grow>
                  <v-tab value="home">Overview</v-tab>
                  <v-tab value="agency-metrics-2">Metrics 2</v-tab>
                  <v-tab value="tasks">Tasks</v-tab>
                  <v-tab value="files">Files</v-tab>
                  <v-tab value="events">Evidence</v-tab>
                  <v-tab value="git">Git</v-tab>
                  <v-tab value="agent">Agent</v-tab>
                  <v-tab value="assessment">Assessment</v-tab>
                  <v-tab value="integrity">Integrity</v-tab>
                </v-tabs>

                <v-card class="pa-5 mb-5">
                  <v-row align="center">
                    <v-col cols="12" md="5">
                      <v-select v-model="selectedStudent" :items="contributions.map((item) => item.studentId)" label="Student" hide-details></v-select>
                    </v-col>
                    <v-col cols="12" md="7">
                      <div class="muted">{{ reviewModel.submission.id }} - Imported {{ reviewModel.submission.importedAt }}</div>
                    </v-col>
                  </v-row>
                </v-card>

                <section v-show="submissionTab === 'home'" class="tab-panel">
                  <v-row>
                    <v-col cols="12" md="3"><v-card class="pa-5"><div class="muted">Completed tasks</div><div class="text-h4">{{ summary.tasksCompleted ?? 0 }}/{{ manifest?.tasks?.length ?? 0 }}</div></v-card></v-col>
                    <v-col cols="12" md="3"><v-card class="pa-5"><div class="muted">Active minutes</div><div class="text-h4">{{ summary.activeMinutes ?? 0 }}</div></v-card></v-col>
                    <v-col cols="12" md="3"><v-card class="pa-5"><div class="muted">Files modified</div><div class="text-h4">{{ summary.filesModified ?? 0 }}</div></v-card></v-col>
                    <v-col cols="12" md="3"><v-card class="pa-5"><div class="muted">Agent interactions</div><div class="text-h4">{{ summary.agentInteractions ?? contribution?.agentInteractions?.length ?? 0 }}</div></v-card></v-col>
                  </v-row>
                  <v-card class="pa-6 mt-5">
                    <h3 class="text-h5 mb-3">Agency metrics</h3>
                    <pre>{{ pretty(agency ?? { message: 'No agency metrics available.' }) }}</pre>
                  </v-card>
                </section>

                <section v-show="submissionTab === 'agency-metrics-2'" class="tab-panel">
                  <v-card v-if="!agencyV2" class="pa-8">
                    <p class="muted">No v2 agency metrics available for this contribution.</p>
                  </v-card>
                  <div v-else>
                    <v-alert v-if="agencyV2.interpretationFlag" type="warning" variant="tonal" class="mb-5">{{ agencyV2.interpretationFlag }}</v-alert>
                    <v-row>
                      <v-col cols="12" md="3">
                        <v-card class="pa-5">
                          <div class="muted">Traceability</div>
                          <div class="text-h4">{{ agencyV2.traceability.score }}/100</div>
                          <v-chip size="small" class="mt-2">{{ agencyV2.traceability.confidence }}</v-chip>
                        </v-card>
                      </v-col>
                      <v-col cols="12" md="3">
                        <v-card class="pa-5">
                          <div class="muted">Engagement</div>
                          <div class="text-h4">{{ agencyV2.engagement.score }}/100</div>
                          <v-chip size="small" class="mt-2">{{ agencyV2.engagement.confidence }}</v-chip>
                        </v-card>
                      </v-col>
                      <v-col cols="12" md="3">
                        <v-card class="pa-5">
                          <div class="muted">Authorship</div>
                          <div class="text-h4">{{ agencyV2.authorship.score }}/100</div>
                          <v-chip size="small" class="mt-2">{{ agencyV2.authorship.confidence }}</v-chip>
                        </v-card>
                      </v-col>
                      <v-col cols="12" md="3">
                        <v-card class="pa-5">
                          <div class="muted">Agent support</div>
                          <div class="text-h4">{{ agencyV2.agentSupport.score }}/100</div>
                          <v-chip size="small" class="mt-2">{{ agencyV2.agentSupport.confidence }}</v-chip>
                        </v-card>
                      </v-col>
                    </v-row>

                    <v-card class="pa-6 mt-5">
                      <h3 class="text-h5 mb-3">Executive summary</h3>
                      <p>{{ agencyV2.summary.level }} - {{ agencyV2.summary.score }}/100</p>
                      <ul v-if="agencyV2.summary.flags.length">
                        <li v-for="(flag, index) in agencyV2.summary.flags" :key="index">{{ flag }}</li>
                      </ul>
                      <p v-else class="muted">No summary flags.</p>
                    </v-card>

                    <v-card class="pa-6 mt-5">
                      <h3 class="text-h5 mb-3">Engagement subdimensions</h3>
                      <v-chip v-for="(value, name) in agencyV2.engagement.subdimensions" :key="name" class="mr-2 mb-2">{{ name }}: {{ value }}/100</v-chip>
                    </v-card>

                    <v-row class="mt-1">
                      <v-col
                        cols="12"
                        lg="6"
                        v-for="entry in [
                          { label: 'Traceability', index: agencyV2.traceability },
                          { label: 'Engagement', index: agencyV2.engagement },
                          { label: 'Authorship', index: agencyV2.authorship },
                          { label: 'Agent support', index: agencyV2.agentSupport }
                        ]"
                        :key="entry.label"
                      >
                        <v-card class="pa-6 mb-5">
                          <h3 class="text-h6 mb-2">{{ entry.label }} evidence</h3>
                          <p v-if="entry.index.note" class="muted">{{ entry.index.note }}</p>
                          <ul v-if="entry.index.flags.length">
                            <li v-for="(flag, index) in entry.index.flags" :key="index">{{ flag }}</li>
                          </ul>
                          <p v-else class="muted">No flags for this index.</p>
                          <v-table density="compact">
                            <thead><tr><th>Id</th><th>Metric</th><th>Value</th><th>Reliability</th><th>Reading</th></tr></thead>
                            <tbody>
                              <tr v-for="atom in entry.index.evidence" :key="atom.id">
                                <td><code>{{ atom.id }}</code></td>
                                <td>
                                  {{ atom.name }}
                                  <v-chip v-if="atom.scored" size="x-small" color="primary" class="ml-1">Priority</v-chip>
                                </td>
                                <td>{{ atom.value }}{{ atom.unit ? ' ' + atom.unit : '' }}</td>
                                <td>{{ atom.reliability }}</td>
                                <td>{{ atom.interpretation }}</td>
                              </tr>
                            </tbody>
                          </v-table>
                        </v-card>
                      </v-col>
                    </v-row>
                  </div>
                </section>

                <section v-show="submissionTab === 'tasks'" class="tab-panel">
                  <v-card class="pa-6">
                    <h3 class="text-h5 mb-3">Task state</h3>
                    <pre>{{ pretty(contribution?.state ?? { message: 'No state data available.' }) }}</pre>
                  </v-card>
                </section>

                <section v-show="submissionTab === 'files'" class="tab-panel">
                  <v-card class="pa-6">
                    <h3 class="text-h5 mb-3">Project files referenced by evidence</h3>
                    <v-table>
                      <thead><tr><th>File</th></tr></thead>
                      <tbody><tr v-for="file in fileSignals" :key="file"><td><code>{{ file }}</code></td></tr></tbody>
                    </v-table>
                    <p v-if="!fileSignals.length" class="muted">No file references were found in this contribution's events.</p>
                  </v-card>
                </section>

                <section v-show="submissionTab === 'events'" class="tab-panel">
                  <v-card class="pa-6">
                    <h3 class="text-h5 mb-4">Evidence events</h3>
                    <v-row>
                      <v-col cols="12" md="4">
                        <v-select v-model="filters.task" :items="[{ id: '', title: 'All tasks' }, ...(manifest?.tasks ?? [])]" item-title="title" item-value="id" label="Task"></v-select>
                      </v-col>
                      <v-col cols="12" md="4"><v-text-field v-model="filters.eventType" label="Event type"></v-text-field></v-col>
                      <v-col cols="12" md="4"><v-text-field v-model="filters.file" label="File"></v-text-field></v-col>
                    </v-row>
                    <div class="event-list">
                      <v-card v-for="(event, index) in filteredEvents.slice(0, 120)" :key="index" class="pa-4 mb-3">
                        <strong>{{ eventType(event) }}</strong>
                        <span class="muted ml-2">{{ event.timestamp || event.time || '' }}</span>
                        <pre class="mt-3">{{ pretty(event) }}</pre>
                      </v-card>
                    </div>
                  </v-card>
                </section>

                <section v-show="submissionTab === 'git'" class="tab-panel">
                  <v-card class="pa-6">
                    <h3 class="text-h5 mb-3">Git history</h3>
                    <p class="muted">Detected: {{ reviewModel.submission.hasGit ? 'yes' : 'no' }}</p>
                    <v-card v-for="commit in reviewModel.commits" :key="commit.hash" class="pa-4 mb-3">
                      <code>{{ String(commit.hash || '').slice(0, 10) }}</code>
                      <strong class="ml-2">{{ commit.message }}</strong>
                      <div class="muted">{{ commit.author }} - {{ commit.timestamp }}</div>
                      <v-btn class="mt-3" size="small" @click="run('commitFiles', { commit: commit.hash })">Show changed files</v-btn>
                    </v-card>
                  </v-card>
                </section>

                <section v-show="submissionTab === 'agent'" class="tab-panel">
                  <v-card class="pa-6">
                    <h3 class="text-h5 mb-3">Agent interactions</h3>
                    <v-card v-for="(interaction, index) in (contribution?.agentInteractions ?? [])" :key="index" class="pa-4 mb-3">
                      <strong>{{ interaction.actor }}{{ interaction.agent ? ' - ' + interaction.agent : '' }}</strong>
                      <span class="muted ml-2">{{ interaction.timestamp }}</span>
                      <p class="mt-3">{{ interaction.message }}</p>
                    </v-card>
                    <pre v-if="contribution?.interactionErrors?.length">{{ pretty(contribution.interactionErrors) }}</pre>
                  </v-card>
                </section>

                <section v-show="submissionTab === 'assessment'" class="tab-panel">
                  <v-row>
                    <v-col cols="12" lg="6">
                      <v-card class="pa-6">
                        <h3 class="text-h5 mb-3">Rubric</h3>
                        <pre>{{ pretty(rubric ?? { message: 'No rubric found in submission.' }) }}</pre>
                      </v-card>
                    </v-col>
                    <v-col cols="12" lg="6">
                      <v-card class="pa-6">
                        <h3 class="text-h5 mb-3">Feedback</h3>
                        <v-select v-model="feedbackStatus" :items="['pending', 'completed']" label="Status"></v-select>
                        <v-textarea v-model="feedbackComment" label="General comment" rows="7"></v-textarea>
                        <v-textarea v-model="evaluationsText" label="Criterion evaluations JSON" rows="14"></v-textarea>
                        <v-btn color="primary" class="mr-2" @click="saveFeedback">Save feedback</v-btn>
                        <v-btn @click="run('exportFeedback')">Export feedback</v-btn>
                      </v-card>
                    </v-col>
                  </v-row>
                </section>

                <section v-show="submissionTab === 'integrity'" class="tab-panel">
                  <v-row>
                    <v-col cols="12" lg="6"><v-card class="pa-6"><h3 class="text-h5 mb-3">Local event chain</h3><pre>{{ pretty(reviewModel.integrity?.[selectedStudent]) }}</pre></v-card></v-col>
                    <v-col cols="12" lg="6"><v-card class="pa-6"><h3 class="text-h5 mb-3">Repository receipts</h3><pre>{{ pretty(reviewModel.externalIntegrity?.[selectedStudent]) }}</pre></v-card></v-col>
                  </v-row>
                </section>
              </div>
            </section>

            <section v-show="mainTab === 'prompts'" class="tab-panel">
              <v-card class="pa-6 mb-5">
                <h3 class="text-h5 mb-2">Utils prompts</h3>
                <p class="muted">Copy a complete prompt and paste it into the teacher's preferred agent while the review workspace is open.</p>
              </v-card>
              <v-row>
                <v-col v-for="prompt in prompts" :key="prompt.id" cols="12" md="6" xl="4">
                  <v-card class="pa-5 prompt-card">
                    <h4 class="text-h6">{{ prompt.title }}</h4>
                    <p class="muted mt-2">{{ prompt.description }}</p>
                    <v-btn color="primary" @click="run('copyUtilityPrompt', { promptId: prompt.id })">Copy prompt</v-btn>
                  </v-card>
                </v-col>
              </v-row>
            </section>
          </div>
        </v-container>
      </v-main>
    </v-app>
  \`
});

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'vscodeTheme',
    themes: { vscodeTheme: { dark: true, colors: { primary: '#3794ff' } } }
  }
});
app.use(vuetify);
app.mount('#app');
  </script>
</body>
</html>`;
}
