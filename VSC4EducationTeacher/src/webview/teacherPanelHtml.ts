import * as vscode from "vscode";
import { ActivityStatus } from "../types/ActivityStatus";
import { ReviewWorkspaceStatus } from "../services/ReviewWorkspaceService";
import { escapeHtml, webviewDocument } from "./webviewUtils";
import { SubmissionReviewModel } from "./submissionReviewHtml";

export interface TeacherPanelModel {
  mode?: "activity" | "review";
  fixedMode?: "activity" | "review";
  activityRoot?: string;
  activity?: ActivityStatus;
  review?: {
    status: ReviewWorkspaceStatus;
    activity?: ActivityStatus;
    selectedSubmissionRoot?: string;
    reviewModel?: SubmissionReviewModel;
  };
}

export function teacherPanelHtml(
  webview: vscode.Webview,
  model: TeacherPanelModel,
  extensionUri: vscode.Uri
): string {
  const encoded = JSON.stringify(model).replace(/</g, "\\u003c");
  const d3Uri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "d3", "dist", "d3.min.js")
  );
  const navigation = model.fixedMode
    ? ""
    : `<nav>
    <button class="secondary mode" data-mode="activity">Activity Creation</button>
    <button class="secondary mode" data-mode="review">Submissions Review</button>
  </nav>`;
  const body = `<header>
  <strong>${escapeHtml(title(model))}</strong>
  <div class="muted" id="subtitle">${escapeHtml(subtitle(model))}</div>
  ${navigation}
</header>
<main id="app"></main>`;
  const script = `
const vscode = acquireVsCodeApi();
let model = ${encoded};
const app = document.getElementById('app');
const subtitle = document.getElementById('subtitle');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const pretty = (value) => esc(JSON.stringify(value, null, 2));
const post = (type, data = {}) => vscode.postMessage({ type, ...data });
const getEventType = (event) => event.type ?? event.event ?? 'event';
const getEventFile = (event) => event.file ?? event.data?.file ?? '-';
let activeReviewTab = 'activity-tab';
let activeSubmissionTab = 'report';

function setSubtitle() {
  subtitle.textContent = model.mode === 'activity'
    ? (model.activityRoot || 'Choose an activity workspace')
    : model.mode === 'review'
      ? (model.review?.status?.root || 'Choose a review workspace')
      : 'Choose a mode';
}
function openButton(path, label = 'Open file') {
  return \`<button data-open="\${esc(path)}">\${esc(label)}</button>\`;
}
function metric(label, value, className = '') {
  return \`<div class="card \${className}"><div class="muted">\${esc(label)}</div><strong style="font-size:24px">\${esc(value)}</strong></div>\`;
}
function bindActivityCommon() {
  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => post('openFile', { path: button.dataset.open })));
  document.querySelectorAll('[data-create-file]').forEach((button) => button.addEventListener('click', () => post('createFile', { kind: button.dataset.createFile })));
  document.querySelectorAll('[data-import-legacy]').forEach((button) => button.addEventListener('click', () => post('importLegacyMaterial', { importKind: button.dataset.importLegacy })));
  document.querySelectorAll('[data-copy-migration-prompt]').forEach((button) => button.addEventListener('click', () => post('copyMigrationPrompt')));
  document.querySelectorAll('[data-reveal]').forEach((button) => button.addEventListener('click', () => post('revealPath', { path: button.dataset.reveal })));
  document.querySelectorAll('[data-register-task]').forEach((button) => button.addEventListener('click', () => post('registerTask', { taskFile: button.dataset.registerTask })));
  bindActionButtons();
}
function bindActionButtons() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      runAction(button.dataset.action);
    });
  });
}
function actionButtonFromEvent(event) {
  const target = event.target;
  if (target?.closest) return target.closest('[data-action]');
  return target?.parentElement?.closest?.('[data-action]') ?? null;
}
function runAction(action) {
  if (action === 'import-review-activity') post('importReviewActivity');
  if (action === 'import-review-submission') {
    activeReviewTab = 'submissions-tab';
    post('importReviewSubmission');
  }
  if (action === 'export-student') post('exportStudent');
  if (action === 'export-teacher') post('exportTeacher');
}
function renderLanding() {
  app.innerHTML = \`
    <div class="grid">
      <button class="mode-card" data-mode="activity"><strong>Activity Creation</strong><span>Create, edit, validate, and export learning activity packages.</span></button>
      <button class="mode-card" data-mode="review"><strong>Submissions Review</strong><span>Create or open review workspaces and inspect student submissions.</span></button>
    </div>\`;
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => post('selectMode', { mode: button.dataset.mode })));
}
function renderActivityMode() {
  if (!model.activity) {
    app.innerHTML = \`
      <h1>Activity Creation</h1>
      <div class="grid">
        <button class="mode-card" id="start-activity"><strong>Start new learning activity</strong><span>Choose a working folder and scaffold the activity files.</span></button>
        <button class="mode-card" id="open-activity"><strong>Work on an existing learning activity</strong><span>Open a folder that already contains or will contain the activity definition.</span></button>
        <button class="mode-card" id="current-activity"><strong>Work on current workspace</strong><span>Use the workspace folder already open in VS Code.</span></button>
      </div>\`;
    document.getElementById('start-activity').addEventListener('click', () => post('startActivity'));
    document.getElementById('open-activity').addEventListener('click', () => post('openActivity'));
    document.getElementById('current-activity').addEventListener('click', () => post('useCurrentActivityWorkspace'));
    return;
  }
  const status = model.activity;
  status.initialized ? renderActivityReady(status) : renderActivityWizard();
}
function renderActivityWizard() {
  app.innerHTML = \`
    <div class="row" style="justify-content:space-between"><h1>Create activity in this project</h1><button id="change-folder" class="secondary">Choose another folder</button></div>
    <p class="muted">This folder does not contain <code>manifest.json</code>. The wizard will initialize the activity directly here.</p>
    <div class="card">
      <div class="grid">
        <div><label for="id">Identifier</label><input id="id" placeholder="poo-basico-01"></div>
        <div><label for="title">Title</label><input id="title" placeholder="Basic OOP"></div>
        <div><label for="version">Version</label><input id="version" value="1.0.0"></div>
        <div><label for="type">Type</label><select id="type"><option value="exercise">Exercise</option><option value="project">Project</option></select></div>
      </div>
      <label for="description">Description</label><textarea id="description"></textarea>
      <label for="first-task-title">First task title</label><input id="first-task-title" value="First task">
      <p><button id="create">Create activity files</button></p>
    </div>\`;
  document.getElementById('change-folder').addEventListener('click', () => post('openActivity'));
  document.getElementById('create').addEventListener('click', () => post('createActivity', {
    activity: {
      id: document.getElementById('id').value.trim(),
      title: document.getElementById('title').value.trim(),
      description: document.getElementById('description').value,
      version: document.getElementById('version').value.trim(),
      type: document.getElementById('type').value,
      firstTaskTitle: document.getElementById('first-task-title').value.trim()
    }
  }));
}
function renderActivityReady(status) {
  const manifest = status.manifest;
  const validation = status.validation;
  const invalidManifest = !manifest;
  app.innerHTML = \`
    <div class="row" style="justify-content:space-between">
      <div><h1>\${esc(manifest?.title ?? 'Activity files need attention')}</h1><p class="muted">\${esc(manifest?.description ?? status.manifestError ?? '')}</p></div>
      <div class="row"><button id="change-folder" class="secondary">Change folder</button><button id="refresh" class="secondary">Refresh</button><button data-action="export-student" \${validation?.valid ? '' : 'disabled'}>Export student ZIP</button><button data-action="export-teacher" \${validation?.valid ? '' : 'disabled'}>Export teacher package ZIP</button></div>
    </div>
    <div class="grid">
      \${metric('Tasks', status.counts.tasks)}
      \${metric('Theory files', status.counts.theoryFiles)}
      \${metric('Starter files', status.counts.starterFiles)}
      \${metric('Errors', status.counts.errors, status.counts.errors ? 'error' : '')}
      \${metric('Warnings', status.counts.warnings, status.counts.warnings ? 'warning' : '')}
    </div>
    <h2>Activity definition</h2>
    <div class="card">
      <div class="row">
        \${openButton('manifest.json', 'Edit manifest.json')}
        \${openButton('agent/instructions.md', 'Edit agent instructions')}
        \${status.files.some((file) => file.path === 'rubrics/main.json' && file.exists) ? openButton('rubrics/main.json', 'Edit rubric') : '<button data-create-file="rubric">Create rubric</button>'}
      </div>
      \${invalidManifest ? '<p class="error">The manifest cannot be parsed. Open it, correct the JSON, and save it; this panel will refresh automatically.</p>' : ''}
    </div>
    <h2>Tasks</h2>
    <div class="row"><button id="add-task">Add task</button><button data-reveal="tasks" class="secondary">Reveal tasks folder</button></div>
    <div id="tasks">\${status.tasks.map((task) => \`
      <div class="card">
        <strong>\${esc(task.title)}</strong> <code>\${esc(task.id)}</code>
        <p class="muted">Dependencies: \${esc(task.dependencies.join(', ') || 'none')}</p>
        \${task.file ? (task.fileExists ? openButton(task.file, 'Edit task Markdown') : \`<span class="error">Missing \${esc(task.file)}</span>\`) : '<span class="warning">No Markdown file assigned</span>'}
      </div>\`).join('') || '<p class="muted">No registered tasks found.</p>'}</div>
    \${status.discoveredTasks.length ? \`
      <h3>Discovered task files</h3>
      \${status.discoveredTasks.map((task) => \`
        <div class="card warning">
          <strong>\${esc(task.title)}</strong> <code>\${esc(task.id)}</code>
          <p class="muted">\${esc(task.file)}</p>
          <div class="row">\${openButton(task.file, 'Edit Markdown')}<button data-register-task="\${esc(task.file)}">Add to activity</button></div>
        </div>\`).join('')}\` : ''}
    <h2>Project files</h2>
    <div class="row"><button data-create-file="theory">Create theory file</button><button data-import-legacy="practice">Import legacy practice</button><button data-import-legacy="theory">Import theory material</button><button data-copy-migration-prompt>Copy migration prompt</button><button data-reveal="theory" class="secondary">Reveal theory folder</button><button data-reveal="starter" class="secondary">Reveal starter project</button></div>
    <table><thead><tr><th>File</th><th>Kind</th><th>Status</th><th></th></tr></thead><tbody>
      \${status.files.map((file) => \`<tr><td><code>\${esc(file.path)}</code></td><td>\${esc(file.kind)}</td><td class="\${file.exists ? '' : 'error'}">\${file.exists ? (file.referenced ? 'referenced' : 'present') : 'missing'}</td><td>\${file.exists ? openButton(file.path) : ''}</td></tr>\`).join('')}
    </tbody></table>
    <h2>Validation</h2>
    <div id="validation">\${['errors','warnings','info'].map((group) => \`<h3>\${group}</h3>\${(validation?.[group] ?? []).map((issue) => \`<div class="card \${esc(issue.severity)}"><strong>\${esc(issue.code)}</strong>: \${esc(issue.message)}</div>\`).join('') || '<p class="muted">None</p>'}\`).join('')}</div>\`;
  document.getElementById('change-folder').addEventListener('click', () => post('openActivity'));
  document.getElementById('refresh').addEventListener('click', () => post('refresh'));
  document.getElementById('add-task').addEventListener('click', () => post('addTask'));
  bindActivityCommon();
}
function renderReviewMode() {
  if (!model.review) {
    app.innerHTML = \`
      <h1>Submissions Review</h1>
      <div class="grid">
        <button class="mode-card" id="create-review"><strong>Create a new review workspace</strong><span>Create learning-activity-definition and submissions folders.</span></button>
        <button class="mode-card" id="open-review"><strong>Open a review workspace</strong><span>Continue reviewing submissions from an existing workspace.</span></button>
        <button class="mode-card" id="current-review"><strong>Work on current workspace</strong><span>Use the workspace folder already open in VS Code.</span></button>
      </div>\`;
    document.getElementById('create-review').addEventListener('click', () => post('createReviewWorkspace'));
    document.getElementById('open-review').addEventListener('click', () => post('openReviewWorkspace'));
    document.getElementById('current-review').addEventListener('click', () => post('useCurrentReviewWorkspace'));
    return;
  }
  const review = model.review;
  const reviewTab = activeReviewTab === 'submissions-tab' ? 'submissions-tab' : 'activity-tab';
  app.innerHTML = \`
    <div class="row" style="justify-content:space-between">
      <div><h1>Submissions Review</h1><p class="muted">\${esc(review.status.root)}</p></div>
      <div class="row"><button id="open-review" class="secondary">Change workspace</button><button id="refresh" class="secondary">Refresh</button></div>
    </div>
    <nav><button class="secondary review-tab" data-tab="activity-tab">Learning activity</button><button class="secondary review-tab" data-tab="submissions-tab">Submissions</button></nav>
    <section id="activity-tab" class="\${reviewTab === 'activity-tab' ? 'active' : ''}">\${renderReviewActivity(review)}</section>
    <section id="submissions-tab" class="\${reviewTab === 'submissions-tab' ? 'active' : ''}">\${renderReviewSubmissions(review)}</section>\`;
  document.getElementById('open-review').addEventListener('click', () => post('openReviewWorkspace'));
  document.getElementById('refresh').addEventListener('click', () => post('refresh'));
  document.querySelectorAll('.review-tab').forEach((button) => button.addEventListener('click', () => {
    activeReviewTab = button.dataset.tab;
    document.querySelectorAll('#app > section').forEach((section) => section.classList.toggle('active', section.id === activeReviewTab));
  }));
  const select = document.getElementById('submission-select');
  if (select) select.addEventListener('change', () => {
    activeReviewTab = 'submissions-tab';
    post('selectSubmission', { submissionRoot: select.value });
  });
  bindActionButtons();
  bindSubmissionReview();
}
function renderReviewActivity(review) {
  if (!review.status.activityImported) {
    return \`<div class="card"><p class="muted">Import the teacher activity package ZIP to populate <code>learning-activity-definition/</code>.</p><button data-action="import-review-activity">Import teacher activity ZIP</button></div>\`;
  }
  const activity = review.activity;
  const manifest = activity?.manifest;
  return \`
    <div class="row"><button data-action="import-review-activity" class="secondary">Import another activity ZIP</button></div>
    <div class="grid">
      \${metric('Activity', manifest?.title ?? 'Loaded')}
      \${metric('Version', manifest?.version ?? '-')}
      \${metric('Tasks', activity?.counts?.tasks ?? 0)}
      \${metric('Validation errors', activity?.counts?.errors ?? 0, activity?.counts?.errors ? 'error' : '')}
    </div>
    <div class="card"><h3>Manifest</h3><pre>\${pretty(manifest ?? {})}</pre></div>\`;
}
function renderReviewSubmissions(review) {
  const submissions = review.status.submissions;
  const selected = review.selectedSubmissionRoot ?? '';
  return \`
    <div class="row">
      <div style="min-width:280px"><label for="submission-select">Submission to review</label><select id="submission-select">\${submissions.map((item) => \`<option value="\${esc(item.rootPath)}" \${item.rootPath === selected ? 'selected' : ''}>\${esc(item.label)}</option>\`).join('')}</select></div>
      <button data-action="import-review-submission">Import submission ZIP</button>
    </div>
    \${submissions.length ? renderSubmissionDashboard(review.reviewModel) : '<p class="muted">No submissions imported yet.</p>'}\`;
}
function renderSubmissionDashboard(reviewModel) {
  if (!reviewModel) return '<p class="muted">Select a submission to calculate the review dashboard.</p>';
  const firstStudent = reviewModel.submission.contributions[0]?.studentId ?? '';
  const submissionTabs = ['report','agency-metrics','evidence','git','agents','integrity','rubric','feedback'];
  const submissionTab = submissionTabs.includes(activeSubmissionTab) ? activeSubmissionTab : 'report';
  return \`
    <div id="review-dashboard" data-student="\${esc(firstStudent)}">
      <nav>
        <button class="secondary submission-tab" data-tab="report">Report</button>
        <button class="secondary submission-tab" data-tab="agency-metrics">Agency metrics</button>
        <button class="secondary submission-tab" data-tab="evidence">Evidence</button>
        <button class="secondary submission-tab" data-tab="git">Git</button>
        <button class="secondary submission-tab" data-tab="agents">Agent</button>
        <button class="secondary submission-tab" data-tab="integrity">Integrity</button>
        <button class="secondary submission-tab" data-tab="rubric">Rubric</button>
        <button class="secondary submission-tab" data-tab="feedback">Feedback</button>
      </nav>
      <div class="grid">
        <div><label for="student">Student</label><select id="student">\${reviewModel.submission.contributions.map((item) => \`<option value="\${esc(item.studentId)}">\${esc(item.studentId)}</option>\`).join('')}</select></div>
        <div><label for="task-filter">Task</label><select id="task-filter"><option value="">All tasks</option>\${(reviewModel.submission.manifest.tasks ?? []).map((task) => \`<option value="\${esc(task.id)}">\${esc(task.title)}</option>\`).join('')}</select></div>
        <div><label for="event-filter">Event type</label><input id="event-filter" placeholder="e.g. file_changed"></div>
        <div><label for="file-filter">File</label><input id="file-filter" placeholder="path fragment"></div>
      </div>
      <section id="report" class="\${submissionTab === 'report' ? 'active' : ''}"></section>
      <section id="agency-metrics" class="\${submissionTab === 'agency-metrics' ? 'active' : ''}"></section>
      <section id="evidence" class="\${submissionTab === 'evidence' ? 'active' : ''}"></section>
      <section id="git" class="\${submissionTab === 'git' ? 'active' : ''}"></section>
      <section id="agents" class="\${submissionTab === 'agents' ? 'active' : ''}"></section>
      <section id="integrity" class="\${submissionTab === 'integrity' ? 'active' : ''}"></section>
      <section id="rubric" class="\${submissionTab === 'rubric' ? 'active' : ''}"></section>
      <section id="feedback" class="\${submissionTab === 'feedback' ? 'active' : ''}"></section>
    </div>\`;
}
function bindSubmissionReview() {
  if (!model.review?.reviewModel) return;
  const reviewModel = model.review.reviewModel;
  let selectedStudent = reviewModel.submission.contributions[0]?.studentId ?? '';
  const byId = (id) => document.getElementById(id);
  const contribution = () => reviewModel.submission.contributions.find((item) => item.studentId === selectedStudent);
  function renderStudent() {
    const item = contribution();
    if (!item) return;
    const summary = reviewModel.summaries.find((value) => value.studentId === selectedStudent);
    const task = byId('task-filter').value;
    const eventTypeFilter = byId('event-filter').value.toLowerCase();
    const file = byId('file-filter').value.toLowerCase();
    const events = item.events.filter((event) => (!task || event.taskId === task) && (!eventTypeFilter || String(getEventType(event)).toLowerCase().includes(eventTypeFilter)) && (!file || String(getEventFile(event)).toLowerCase().includes(file)));
    const agency = summary?.agency ?? {};
    byId('report').innerHTML = \`
      <h2>Teacher report</h2>
      <p class="muted">Signals support teacher judgement; they are not an automatic grade.</p>
      <div class="grid">
        \${metric('Agency', agency.level ?? 'unknown')}
        \${metric('Completed tasks', \`\${summary?.tasksCompleted ?? 0}/\${reviewModel.submission.manifest.tasks?.length ?? 0}\`)}
        \${metric('Lines touched', summary?.uniqueLinesTouched ?? 0)}
        \${metric('Files modified', summary?.filesModified ?? 0)}
        \${metric('Active minutes', summary?.activeMinutes ?? 0)}
        \${metric('Agent messages', summary?.agentInteractions ?? 0)}
      </div>
      <div class="grid"><div class="card"><h3>Agency signals</h3>\${signalList(agency.positives, 'No positive signals calculated.')}</div><div class="card"><h3>Review flags</h3>\${signalList(agency.concerns, 'No immediate flags.')}</div></div>\`;
    byId('agency-metrics').innerHTML = renderAgencyMetrics(reviewModel.agencyMetrics.find((value) => value.studentId === selectedStudent));
    byId('evidence').innerHTML = renderEvidenceTimeline(events);
    byId('git').innerHTML = \`<h2>Git repository</h2><p>Detected: \${reviewModel.submission.hasGit ? 'yes' : 'no'}</p>\` + reviewModel.commits.map((commit) => \`<div class="card"><strong><code>\${esc(commit.hash?.slice(0, 10))}</code> \${esc(commit.message)}</strong><br><span class="muted">\${esc(commit.author)} - \${esc(commit.timestamp)}</span><br><button data-commit="\${esc(commit.hash)}">Show changed files</button></div>\`).join('');
    byId('agents').innerHTML = \`<h2>Agent conversations</h2>\` + item.agentInteractions.map((interaction) => \`<div class="card"><strong>\${esc(interaction.actor)}\${interaction.agent ? ' - ' + esc(interaction.agent) : ''}</strong><br><span class="muted">\${esc(interaction.timestamp)}</span><p>\${esc(interaction.message)}</p></div>\`).join('') + (item.interactionErrors.length ? \`<pre class="warning">\${pretty(item.interactionErrors)}</pre>\` : '');
    byId('integrity').innerHTML = \`<h2>Integrity</h2><div class="card"><p class="muted">A valid chain is local consistency evidence, not forensic proof.</p><pre>\${pretty(reviewModel.integrity[selectedStudent])}</pre></div>\`;
    byId('rubric').innerHTML = \`<h2>Rubric</h2><div class="card"><pre>\${pretty(reviewModel.rubric ?? { message: 'No rubric found in submission' })}</pre></div>\`;
    byId('feedback').innerHTML = \`<h2>Feedback</h2><div class="card"><label>Status</label><select id="feedback-status"><option value="pending">Pending</option><option value="completed">Completed</option></select><label>General comment</label><textarea id="general-comment"></textarea><label>Criterion evaluations (JSON)</label><textarea id="evaluations" style="min-height:240px">\${esc(JSON.stringify((reviewModel.rubric?.criteria ?? []).map((criterion) => ({ criterionId: criterion.id, level: 0, score: 0, comment: '', evidence: [] })), null, 2))}</textarea><p><button id="save-feedback">Save feedback</button> <button id="export-feedback">Export feedback</button></p></div>\`;
    document.querySelectorAll('[data-commit]').forEach((button) => button.addEventListener('click', () => post('commitFiles', { commit: button.dataset.commit })));
    byId('save-feedback').addEventListener('click', () => { try { post('saveFeedback', { feedback: { submissionId: reviewModel.submission.id, studentId: selectedStudent, status: byId('feedback-status').value, updatedAt: new Date().toISOString(), generalComment: byId('general-comment').value, evaluations: JSON.parse(byId('evaluations').value) } }); } catch { post('error', { message: 'Evaluation JSON is invalid' }); } });
    byId('export-feedback').addEventListener('click', () => post('exportFeedback'));
  }
  function signalList(values, empty) {
    return Array.isArray(values) && values.length ? \`<ul>\${values.map((value) => \`<li>\${esc(value)}</li>\`).join('')}</ul>\` : \`<p class="muted">\${esc(empty)}</p>\`;
  }
  function renderAgencyMetrics(metrics) {
    if (!metrics?.groups?.length) return '<h2>Agency metrics</h2><p>No metrics available for this contribution.</p>';
    const totals = metrics.groups.reduce((acc, group) => {
      group.metrics.forEach((metric) => {
        acc.total += 1;
        if (metric.priority) acc.priority += 1;
        acc[metric.reliability] = (acc[metric.reliability] ?? 0) + 1;
      });
      return acc;
    }, { total: 0, priority: 0, direct: 0, estimated: 0, limited: 0 });
    return \`
      <h2>Agency metrics</h2>
      <p class="muted">Calculated from the imported event log for \${esc(metrics.studentId)}. Prioritized metrics are marked for first-pass review.</p>
      <div class="grid">
        \${metricCard('Metrics', esc(totals.total), \`\${esc(totals.priority)} prioritized\`)}
        \${metricCard('Direct', esc(totals.direct), 'computed directly from events')}
        \${metricCard('Estimated', esc(totals.estimated), 'uses event-derived heuristics')}
        \${metricCard('Limited', esc(totals.limited), 'needs extra context to read strongly')}
      </div>
      \${metrics.groups.map(renderMetricGroup).join('')}\`;
  }
  function renderMetricGroup(group) {
    return \`<div class="card agency-group">
      <h3>\${esc(group.dimension)}</h3>
      <table>
        <thead><tr><th>N</th><th>Metric</th><th>Value</th><th>Evidence</th><th>How to read it</th></tr></thead>
        <tbody>\${group.metrics.map(renderAgencyMetric).join('')}</tbody>
      </table>
    </div>\`;
  }
  function renderAgencyMetric(metric) {
    const badge = metric.priority ? '<span class="badge">Priority</span>' : '';
    const reliability = \`<span class="reliability \${esc(metric.reliability)}">\${esc(metric.reliability)}</span>\`;
    const value = \`\${esc(metric.value)}\${metric.unit ? ' ' + esc(metric.unit) : ''}\`;
    return \`<tr>
      <td><code>\${esc(metric.id)}</code></td>
      <td><strong>\${esc(metric.name)}</strong> \${badge}<br><span class="muted">\${reliability}</span></td>
      <td><strong>\${value}</strong></td>
      <td><span class="muted">\${esc(metric.detail)}</span><br><small>\${esc(metric.evidenceCount)} source events/signals</small></td>
      <td>\${esc(metric.interpretation)}</td>
    </tr>\`;
  }
  function metricCard(label, value, detail) {
    return \`<div class="card metric"><span class="muted metric-label">\${label}</span><strong>\${value}</strong><small>\${detail}</small></div>\`;
  }
  function renderEvidenceTimeline(events) {
    if (!events.length) return '<h2>Evidence timeline</h2><p>No matching events.</p>';
    return '<h2>Evidence timeline</h2>' + events.map((event) => {
      const details = Object.fromEntries(Object.entries(event).filter(([key]) => !['content','fileContent','hash','previousHash'].includes(key)));
      return \`<div class="card"><strong>\${esc(event.timestamp ?? 'No timestamp')} - \${esc(getEventType(event))}</strong><br><span class="muted">Task: \${esc(event.taskId ?? '-')} - File: \${esc(getEventFile(event))}</span><pre>\${pretty(details)}</pre></div>\`;
    }).join('');
  }
  document.querySelectorAll('.submission-tab').forEach((button) => button.addEventListener('click', () => {
    activeSubmissionTab = button.dataset.tab;
    document.querySelectorAll('#review-dashboard > section').forEach((section) => section.classList.toggle('active', section.id === activeSubmissionTab));
  }));
  byId('student').addEventListener('change', () => { selectedStudent = byId('student').value; renderStudent(); });
  ['task-filter','event-filter','file-filter'].forEach((id) => byId(id).addEventListener('input', renderStudent));
  renderStudent();
}
function render() {
  setSubtitle();
  document.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active-mode', button.dataset.mode === model.mode));
  if (!model.mode) renderLanding();
  else if (model.mode === 'activity') renderActivityMode();
  else renderReviewMode();
}
document.querySelectorAll('header [data-mode]').forEach((button) => button.addEventListener('click', () => post('selectMode', { mode: button.dataset.mode })));
document.addEventListener('click', (event) => {
  const button = actionButtonFromEvent(event);
  if (button) runAction(button.dataset.action);
});
window.addEventListener('message', (event) => {
  if (event.data.type === 'model') { model = event.data.model; render(); }
  if (event.data.type === 'commitFiles') alert(event.data.files.join('\\n') || 'No changed files');
});
render();`;
  return webviewDocument(webview, "Teach Panel", body, script, [d3Uri]);
}

function subtitle(model: TeacherPanelModel): string {
  if (model.mode === "activity") return model.activityRoot ?? "Choose an activity workspace";
  if (model.mode === "review") {
    return model.review?.status.root ?? "Choose a review workspace";
  }
  return "Choose a mode";
}

function title(model: TeacherPanelModel): string {
  if (model.fixedMode === "activity") return "Activity Creation";
  if (model.fixedMode === "review") return "Submission Review";
  return "Teach Panel";
}
