import * as vscode from "vscode";
import { ActivityStatus } from "../types/ActivityStatus";
import { escapeHtml, nonce } from "./webviewUtils";

export interface CreationPanelV2Model {
  activityRoot?: string;
  activity?: ActivityStatus;
}

export function creationPanelV2Html(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  model: CreationPanelV2Model
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
  <title>${escapeHtml("Activity Creation V2")}</title>
  <link nonce="${scriptNonce}" rel="stylesheet" href="${vuetifyCssUri.toString()}">
  <style>
    :root { color-scheme: light dark; }
    html,
    body,
    #app {
      width: 100%;
      min-width: 0;
      overflow-x: hidden;
    }
    * {
      box-sizing: border-box;
    }
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
    .v-application,
    .v-application__wrap,
    .app-shell {
      width: 100%;
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
    .content {
      width: 100%;
      max-width: none;
      min-width: 0;
      margin: 0;
      padding: 22px;
    }
    .activity-workspace {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      margin: 0 auto;
    }
    .tab-shell,
    .tab-content,
    .tab-panel,
    .tab-content .v-card {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    .tab-content {
      display: block;
      min-width: 0;
    }
    .tab-panel > .v-card,
    .tab-panel > .v-row {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    .v-row {
      max-width: 100%;
      min-width: 0;
    }
    .v-table {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
    }
    .v-table table {
      min-width: 760px;
    }
    .v-list,
    .v-list-item {
      max-width: 100%;
      min-width: 0;
    }
    .v-card, .v-sheet {
      background: var(--vscode-sideBar-background) !important;
      color: var(--vscode-foreground) !important;
      border: 1px solid var(--vscode-panel-border) !important;
    }
    .v-btn { text-transform: none; letter-spacing: 0; }
    .field-label {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 6px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .help-dot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 50%;
      color: var(--vscode-foreground);
      background: transparent;
      font-size: 12px;
      line-height: 1;
      cursor: help;
    }
    .event-server-card .v-input {
      width: 100%;
    }
    .muted { color: var(--vscode-descriptionForeground); }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
    }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${scriptNonce}" src="${vueUri.toString()}"></script>
  <script nonce="${scriptNonce}" src="${vuetifyJsUri.toString()}"></script>
  <script nonce="${scriptNonce}">
const vscode = acquireVsCodeApi();
const initialModel = ${encoded};
const { createApp, ref, computed } = Vue;
const { createVuetify } = Vuetify;

const post = (type, data = {}) => vscode.postMessage({ type, ...data });
const LOCAL_REPOSITORY_BASE_URL = 'http://127.0.0.1:8000';
const emptyEventServer = () => ({
  enabled: false,
  baseUrl: '',
  activityVersionId: '',
  ingestionToken: '',
  publicSigningKeyUrl: '',
  expectedSigningKeyId: '',
  expectedPublicKeySha256: '',
  requireReceipts: false
});
const eventServerFromModel = (value) => {
  const eventServer = value?.activity?.manifest?.repository?.eventServer ?? {};
  return {
    ...emptyEventServer(),
    ...eventServer,
    activityVersionId: eventServer.activityVersionId ?? '',
    requireReceipts: eventServer.requireReceipts === true
  };
};

createApp({
  setup() {
    const model = ref(initialModel);
    const busy = ref(false);
    const activeTab = ref('home');
    const eventServerForm = ref(eventServerFromModel(initialModel));
    const hasActivity = computed(() => Boolean(model.value.activity));
    const initialized = computed(() => Boolean(model.value.activity?.initialized));
    const manifest = computed(() => model.value.activity?.manifest);
    const canExport = computed(() => Boolean(
      model.value.activity?.validation?.valid &&
      model.value.activity?.signaturesGenerated
    ));
    const counts = computed(() => model.value.activity?.counts ?? {
      tasks: 0,
      theoryFiles: 0,
      starterFiles: 0,
      errors: 0,
      warnings: 0
    });
    const files = computed(() => model.value.activity?.files ?? []);
    const tasks = computed(() => model.value.activity?.tasks ?? []);
    const validationGroups = computed(() => {
      const validation = model.value.activity?.validation;
      return [
        { title: 'Errors', items: validation?.errors ?? [], color: 'error' },
        { title: 'Warnings', items: validation?.warnings ?? [], color: 'warning' },
        { title: 'Info', items: validation?.info ?? [], color: 'info' }
      ];
    });
    const run = (type, data = {}) => {
      busy.value = true;
      post(type, data);
    };
    const fillLocalEventServerDefaults = () => {
      const baseUrl = (eventServerForm.value.baseUrl || LOCAL_REPOSITORY_BASE_URL).replace(/\\/+$/, '');
      eventServerForm.value = {
        ...eventServerForm.value,
        enabled: true,
        baseUrl,
        publicSigningKeyUrl: eventServerForm.value.publicSigningKeyUrl || baseUrl + '/api/integration/student/event-signing-key/',
        requireReceipts: eventServerForm.value.requireReceipts === true
      };
    };
    const saveEventServer = () => run('saveEventServerConfiguration', {
      configuration: eventServerForm.value
    });
    window.addEventListener('message', (event) => {
      if (event.data.type === 'model') {
        model.value = event.data.model;
        eventServerForm.value = eventServerFromModel(event.data.model);
        busy.value = false;
      }
      if (event.data.type === 'ready') {
        busy.value = false;
      }
    });
    return {
      model,
      busy,
      activeTab,
      hasActivity,
      initialized,
      manifest,
      canExport,
      counts,
      files,
      tasks,
      eventServerForm,
      validationGroups,
      run,
      fillLocalEventServerDefaults,
      saveEventServer,
      post
    };
  },
  template: \`
    <v-app class="app-shell">
      <div class="topbar">
        <div class="content py-4">
          <div class="d-flex align-start justify-space-between ga-4 flex-wrap">
            <div>
              <div class="text-h6 font-weight-bold">Activity Creation V2</div>
              <div class="muted">{{ model.activityRoot || 'Choose an activity workspace' }}</div>
            </div>
            <v-btn variant="tonal" :loading="busy" @click="run('refresh')">Refresh</v-btn>
          </div>
        </div>
      </div>

      <main class="content">
        <section v-if="!hasActivity">
          <h1 class="text-h4 mb-2">Activity Creation</h1>
          <p class="muted mb-6">Create a new VSCode4Education activity or connect this panel to an existing workspace.</p>
          <v-row>
            <v-col cols="12" md="4">
              <v-card min-height="170" class="pa-5 d-flex flex-column">
                <div class="text-h6 mb-2">Start new learning activity</div>
                <p class="muted">Choose a folder and immediately scaffold the activity files.</p>
                <v-spacer></v-spacer>
                <v-btn color="primary" block :loading="busy" @click="run('startActivity')">Start</v-btn>
              </v-card>
            </v-col>
            <v-col cols="12" md="4">
              <v-card min-height="170" class="pa-5 d-flex flex-column">
                <div class="text-h6 mb-2">Work on existing activity</div>
                <p class="muted">Open a folder that already contains the activity definition.</p>
                <v-spacer></v-spacer>
                <v-btn color="primary" variant="tonal" block :loading="busy" @click="run('openActivity')">Open</v-btn>
              </v-card>
            </v-col>
            <v-col cols="12" md="4">
              <v-card min-height="170" class="pa-5 d-flex flex-column">
                <div class="text-h6 mb-2">Current workspace</div>
                <p class="muted">Use the workspace folder already open in VS Code.</p>
                <v-spacer></v-spacer>
                <v-btn color="primary" variant="tonal" block :loading="busy" @click="run('useCurrentActivityWorkspace')">Use current</v-btn>
              </v-card>
            </v-col>
          </v-row>
        </section>

        <section v-else-if="!initialized">
          <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-5">
            <div>
              <h1 class="text-h4 mb-1">Create activity in this project</h1>
              <p class="muted">This folder does not contain <code>manifest.json</code>.</p>
            </div>
            <v-btn variant="tonal" @click="run('openActivity')">Choose another folder</v-btn>
          </div>
          <v-card class="pa-5">
            <p class="muted mb-4">Use the original panel if you need custom metadata before scaffold. V2 creates a default activity from the selected folder name.</p>
            <v-btn color="primary" :loading="busy" @click="run('initializeCurrent')">Create default activity files</v-btn>
          </v-card>
        </section>

        <section v-else>
          <div class="activity-workspace">
            <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-5">
              <div>
                <h1 class="text-h4 mb-1">{{ manifest?.title || 'Activity files need attention' }}</h1>
                <p class="muted">{{ manifest?.description || model.activity?.manifestError || 'Ready for authoring' }}</p>
              </div>
              <div class="d-flex ga-2 flex-wrap">
                <v-btn variant="tonal" @click="run('openActivity')">Change folder</v-btn>
              </div>
            </div>

            <v-card class="mb-4 tab-shell">
              <v-tabs v-model="activeTab" density="comfortable" grow>
              <v-tab value="home">Home</v-tab>
              <v-tab value="tasks">Tasks</v-tab>
              <v-tab value="files">Files</v-tab>
              <v-tab value="validation">Validation</v-tab>
              <v-tab value="event-server">Event Server</v-tab>
              </v-tabs>
            </v-card>

            <div class="tab-content">
            <div v-show="activeTab === 'home'" class="tab-panel">
              <v-row class="mb-2">
                <v-col cols="6" md="2"><v-card class="pa-4"><div class="muted">Tasks</div><div class="text-h5">{{ counts.tasks }}</div></v-card></v-col>
                <v-col cols="6" md="2"><v-card class="pa-4"><div class="muted">Theory</div><div class="text-h5">{{ counts.theoryFiles }}</div></v-card></v-col>
                <v-col cols="6" md="2"><v-card class="pa-4"><div class="muted">Starter</div><div class="text-h5">{{ counts.starterFiles }}</div></v-card></v-col>
                <v-col cols="6" md="2"><v-card class="pa-4"><div class="muted">Errors</div><div class="text-h5">{{ counts.errors }}</div></v-card></v-col>
                <v-col cols="6" md="2"><v-card class="pa-4"><div class="muted">Warnings</div><div class="text-h5">{{ counts.warnings }}</div></v-card></v-col>
              </v-row>

              <v-card class="pa-5 my-4">
                <div class="text-h6 mb-3">Export</div>
                <div class="d-flex ga-2 flex-wrap">
                  <v-btn color="primary" variant="tonal" @click="run('generateSignatures')">Generate signatures</v-btn>
                  <v-btn color="primary" @click="run('exportStudent')" :disabled="!canExport">Export student ZIP</v-btn>
                  <v-btn color="primary" @click="run('exportTeacher')" :disabled="!canExport">Export teacher ZIP</v-btn>
                </div>
                <p v-if="model.activity?.validation?.valid && !model.activity?.signaturesGenerated" class="muted mt-3">Generate signatures before exporting packages.</p>
              </v-card>

              <v-card class="pa-5 my-4">
                <div class="text-h6 mb-3">Activity definition</div>
                <div class="d-flex ga-2 flex-wrap">
                  <v-btn @click="run('openFile', { path: 'manifest.json' })">Edit manifest</v-btn>
                  <v-btn @click="run('openFile', { path: 'agent/instructions.md' })">Edit agent instructions</v-btn>
                  <v-btn @click="run('createFile', { kind: 'rubric' })">Open assessment rubric</v-btn>
                  <v-btn variant="tonal" @click="run('revealPath', { path: 'assessment' })">Reveal assessment</v-btn>
                </div>
              </v-card>
            </div>

            <div v-show="activeTab === 'tasks'" class="tab-panel">
              <v-card class="pa-5">
                <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-3">
                  <div class="text-h6">Tasks</div>
                  <div class="d-flex ga-2">
                    <v-btn color="primary" @click="run('addTask')">Add task</v-btn>
                    <v-btn variant="tonal" @click="run('revealPath', { path: 'tasks' })">Reveal tasks</v-btn>
                  </div>
                </div>
                <v-list bg-color="transparent">
                  <v-list-item v-for="task in tasks" :key="task.id">
                    <template #title>{{ task.title }} <code>{{ task.id }}</code></template>
                    <template #subtitle>Dependencies: {{ task.dependencies.join(', ') || 'none' }}</template>
                    <template #append>
                      <v-btn size="small" variant="tonal" @click="run('openFile', { path: task.file })" :disabled="!task.file || !task.fileExists">Task</v-btn>
                      <v-btn size="small" variant="tonal" @click="run('openFile', { path: 'assessment/rubrics/' + task.id + '.yml' })">Rubric</v-btn>
                      <v-btn size="small" variant="tonal" @click="run('openFile', { path: 'assessment/solutions/' + task.id + '.md' })">Solution</v-btn>
                    </template>
                  </v-list-item>
                </v-list>
              </v-card>
            </div>

            <div v-show="activeTab === 'files'" class="tab-panel">
              <v-card class="pa-5">
                <div class="text-h6 mb-3">Project files</div>
                <div class="d-flex ga-2 flex-wrap mb-4">
                  <v-btn @click="run('createFile', { kind: 'theory' })">Create theory file</v-btn>
                  <v-btn variant="tonal" @click="run('importLegacyMaterial', { importKind: 'practice' })">Import legacy practice</v-btn>
                  <v-btn variant="tonal" @click="run('importLegacyMaterial', { importKind: 'theory' })">Import theory material</v-btn>
                  <v-btn variant="tonal" @click="run('copyMigrationPrompt')">Copy migration prompt</v-btn>
                </div>
                <v-table density="compact">
                  <thead><tr><th>File</th><th>Kind</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    <tr v-for="file in files" :key="file.path">
                      <td><code>{{ file.path }}</code></td>
                      <td>{{ file.kind }}</td>
                      <td>{{ file.exists ? (file.referenced ? 'referenced' : 'present') : 'missing' }}</td>
                      <td><v-btn v-if="file.exists" size="small" variant="tonal" @click="run('openFile', { path: file.path })">Open</v-btn></td>
                    </tr>
                  </tbody>
                </v-table>
              </v-card>
            </div>

            <div v-show="activeTab === 'validation'" class="tab-panel">
              <v-card class="pa-5">
                <div class="text-h6 mb-3">Validation</div>
                <v-expansion-panels variant="accordion">
                  <v-expansion-panel v-for="group in validationGroups" :key="group.title">
                    <v-expansion-panel-title>{{ group.title }} ({{ group.items.length }})</v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <div v-if="!group.items.length" class="muted">None</div>
                      <v-alert v-for="issue in group.items" :key="issue.code + issue.message" :type="group.color" variant="tonal" class="mb-2">
                        <strong>{{ issue.code }}</strong>: {{ issue.message }}
                      </v-alert>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
              </v-card>
            </div>

            <div v-show="activeTab === 'event-server'" class="tab-panel">
              <v-card class="pa-5 event-server-card">
                <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-3">
                  <div>
                    <div class="text-h6">Event Server</div>
                    <p class="muted">Configure <code>repository.eventServer</code> in <code>manifest.json</code>.</p>
                    <p class="muted">Use Repository to issue the ingestion token for the imported activity version.</p>
                  </div>
                  <div>
                    <div class="field-label">
                      Use event server
                      <button class="help-dot" type="button" title="Enables sending activity evidence to the configured repository event server." aria-label="Use event server help">?</button>
                    </div>
                    <v-switch v-model="eventServerForm.enabled" color="primary" label="Use event server" hide-details></v-switch>
                  </div>
                </div>
                <v-row>
                  <v-col cols="12" md="8">
                    <div class="field-label">
                      Base URL
                      <button class="help-dot" type="button" title="Root HTTP URL of the repository service that receives event batches." aria-label="Base URL help">?</button>
                    </div>
                    <v-text-field v-model="eventServerForm.baseUrl" placeholder="http://127.0.0.1:8000" :disabled="!eventServerForm.enabled" hide-details="auto"></v-text-field>
                  </v-col>
                  <v-col cols="12" md="4">
                    <div class="field-label">
                      Activity version ID
                      <button class="help-dot" type="button" title="Repository-side activity version identifier used to associate incoming events with this activity." aria-label="Activity version ID help">?</button>
                    </div>
                    <v-text-field v-model="eventServerForm.activityVersionId" type="number" min="1" :disabled="!eventServerForm.enabled" hide-details="auto"></v-text-field>
                  </v-col>
                  <v-col cols="12" md="6">
                    <div class="field-label">
                      Ingestion token
                      <button class="help-dot" type="button" title="Secret token included by clients when posting event batches to the server." aria-label="Ingestion token help">?</button>
                    </div>
                    <v-text-field v-model="eventServerForm.ingestionToken" type="password" :disabled="!eventServerForm.enabled" hide-details="auto"></v-text-field>
                  </v-col>
                  <v-col cols="12" md="6">
                    <div class="field-label">
                      Public signing key URL
                      <button class="help-dot" type="button" title="Optional URL where clients can fetch the public key used to verify server receipts." aria-label="Public signing key URL help">?</button>
                    </div>
                    <v-text-field v-model="eventServerForm.publicSigningKeyUrl" :disabled="!eventServerForm.enabled" hide-details="auto"></v-text-field>
                  </v-col>
                  <v-col cols="12" md="6">
                    <div class="field-label">
                      Expected signing key ID
                      <button class="help-dot" type="button" title="Pinned server signing key identifier expected in event receipts." aria-label="Expected signing key ID help">?</button>
                    </div>
                    <v-text-field v-model="eventServerForm.expectedSigningKeyId" :disabled="!eventServerForm.enabled" hide-details="auto"></v-text-field>
                  </v-col>
                  <v-col cols="12" md="6">
                    <div class="field-label">
                      Expected public key SHA-256
                      <button class="help-dot" type="button" title="Optional SHA-256 fingerprint used to pin the receipt signing public key." aria-label="Expected public key SHA-256 help">?</button>
                    </div>
                    <v-text-field v-model="eventServerForm.expectedPublicKeySha256" :disabled="!eventServerForm.enabled" hide-details="auto"></v-text-field>
                  </v-col>
                  <v-col cols="12">
                    <div class="field-label">
                      Require server receipts
                      <button class="help-dot" type="button" title="Marks server receipts as required evidence when this activity is reviewed." aria-label="Require server receipts help">?</button>
                    </div>
                    <v-checkbox v-model="eventServerForm.requireReceipts" label="Require server receipts" :disabled="!eventServerForm.enabled" hide-details></v-checkbox>
                  </v-col>
                </v-row>
                <div class="d-flex ga-2 flex-wrap">
                  <v-btn variant="tonal" @click="fillLocalEventServerDefaults">Fill local defaults</v-btn>
                  <v-btn color="primary" :loading="busy" @click="saveEventServer">Save event server config</v-btn>
                  <v-btn variant="tonal" @click="run('openFile', { path: 'manifest.json' })">Open manifest.json</v-btn>
                </div>
              </v-card>
            </div>
            </div>
          </div>
        </section>
      </main>
    </v-app>
  \`
}).use(createVuetify({
  theme: {
    defaultTheme: 'vscodeTheme',
    themes: {
      vscodeTheme: {
        dark: true,
        colors: {
          primary: '#3794ff',
          background: '#1e1e1e',
          surface: '#252526',
          error: '#f14c4c',
          warning: '#cca700',
          info: '#3794ff'
        }
      }
    }
  }
})).mount('#app');
  </script>
</body>
</html>`;
}
