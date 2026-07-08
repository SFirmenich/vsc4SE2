import * as vscode from "vscode";
import { ActivityManifest } from "../types/ActivityManifest";
import { Rubric } from "../types/Rubric";
import { escapeHtml, webviewDocument } from "./webviewUtils";

export interface ActivityDesignerModel {
  manifest: ActivityManifest;
  rubric?: Rubric;
  instructions: string;
  validation?: unknown;
  root: string;
}

export function activityDesignerHtml(
  webview: vscode.Webview,
  model: ActivityDesignerModel
): string {
  const encoded = JSON.stringify(model).replace(/</g, "\\u003c");
  const tabs = [
    ["general", "General"],
    ["tasks", "Tasks"],
    ["dependencies", "Dependencies"],
    ["theory", "Theory"],
    ["starter", "Starter project"],
    ["agent", "Agent instructions"],
    ["rubric", "Rubric"],
    ["validation", "Validation"],
    ["export", "Export"]
  ];
  const body = `<header>
  <strong>Learning Activity Tracker - Teacher</strong>
  <div class="muted">${escapeHtml(model.root)}</div>
  <nav>${tabs
    .map(
      ([id, label]) =>
        `<button class="secondary tab" data-tab="${id}">${label}</button>`
    )
    .join("")}</nav>
</header>
<main>
  <section id="general" class="active">
    <h2>General information</h2>
    <div class="grid">
      <div><label for="activity-id">ID</label><input id="activity-id"></div>
      <div><label for="title">Title</label><input id="title"></div>
      <div><label for="version">Version</label><input id="version"></div>
      <div><label for="type">Type</label><select id="type"><option value="exercise">Exercise</option><option value="project">Project</option></select></div>
    </div>
    <label for="description">Description</label><textarea id="description"></textarea>
    <p><button id="save-general">Save manifest</button></p>
  </section>
  <section id="tasks"><h2>Tasks</h2><div id="task-list"></div><button id="add-task">Add task</button></section>
  <section id="dependencies"><h2>Dependencies</h2><p class="muted">Dependencies are edited as comma-separated task IDs. Validation detects missing references and cycles.</p><div id="dependency-list"></div></section>
  <section id="theory"><h2>Theory</h2><p>Add Markdown files under <code>theory/</code>. Refer to them from task descriptions or agent instructions as needed.</p><button data-command="revealPath" data-path="theory">Reveal theory folder</button></section>
  <section id="starter"><h2>Starter project</h2><p>Files under <code>starter/</code> are copied into the student's <code>src/</code> folder.</p><button data-command="revealPath" data-path="starter">Reveal starter folder</button></section>
  <section id="agent"><h2>Agent instructions</h2><textarea id="instructions" style="min-height:360px"></textarea><p><button id="save-instructions">Save instructions</button></p></section>
  <section id="rubric"><h2>Rubric</h2><p class="muted">Edit the rubric as JSON. Criteria IDs must be unique, task references valid, weights non-negative, and levels ordered.</p><textarea id="rubric-json" style="min-height:420px"></textarea><p><button id="save-rubric">Save rubric</button></p></section>
  <section id="validation"><h2>Validation</h2><button id="run-validation">Run validation</button><div id="validation-results"></div></section>
  <section id="export"><h2>Export</h2><p>Export creates a student-compatible ZIP after successful validation. SHA-256 hashes are local evidence and are not presented as a digital signature.</p><button id="run-export">Export package</button></section>
</main>`;
  const script = `
const vscode = acquireVsCodeApi();
let model = ${encoded};
const byId = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function showTab(id) {
  document.querySelectorAll('section').forEach((section) => section.classList.toggle('active', section.id === id));
}
document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
document.querySelectorAll('[data-command="revealPath"]').forEach((button) => button.addEventListener('click', () => vscode.postMessage({ type: 'revealPath', path: button.dataset.path })));

function render() {
  byId('activity-id').value = model.manifest.id ?? '';
  byId('title').value = model.manifest.title ?? '';
  byId('description').value = model.manifest.description ?? '';
  byId('version').value = model.manifest.version ?? '';
  byId('type').value = model.manifest.type ?? 'exercise';
  byId('instructions').value = model.instructions ?? '';
  byId('rubric-json').value = JSON.stringify(model.rubric ?? { id: 'main-rubric', title: 'Main rubric', criteria: [] }, null, 2);
  renderTasks();
  renderValidation(model.validation);
}

function renderTasks() {
  byId('task-list').innerHTML = (model.manifest.tasks ?? []).map((task, index) => \`
    <div class="card" data-task-index="\${index}">
      <div class="grid">
        <div><label>ID</label><input data-field="id" value="\${esc(task.id)}"></div>
        <div><label>Title</label><input data-field="title" value="\${esc(task.title)}"></div>
        <div><label>Markdown file</label><input data-field="file" value="\${esc(task.file ?? '')}"></div>
        <div><label>Dependencies</label><input data-field="dependencies" value="\${esc((task.dependencies ?? []).join(', '))}"></div>
      </div>
      <label>Description</label><textarea data-field="description">\${esc(task.description ?? '')}</textarea>
      <label>Acceptance criteria (one per line)</label><textarea data-field="acceptanceCriteria">\${esc((task.acceptanceCriteria ?? []).join('\\n'))}</textarea>
      <label>Expected evidence (one per line)</label><textarea data-field="expectedEvidence">\${esc((task.expectedEvidence ?? []).join('\\n'))}</textarea>
      <div class="row"><button data-action="up">Up</button><button data-action="down">Down</button><button data-action="remove">Remove</button></div>
    </div>\`).join('');
  byId('dependency-list').innerHTML = (model.manifest.tasks ?? []).map((task) => \`<div class="card"><strong>\${esc(task.id)}</strong> depends on \${esc((task.dependencies ?? []).join(', ') || 'nothing')}</div>\`).join('');
  document.querySelectorAll('[data-task-index]').forEach((card) => {
    const index = Number(card.dataset.taskIndex);
    card.querySelectorAll('[data-field]').forEach((input) => input.addEventListener('change', () => updateTask(index, input.dataset.field, input.value)));
    card.querySelector('[data-action="remove"]').addEventListener('click', () => { model.manifest.tasks.splice(index, 1); saveManifest(); });
    card.querySelector('[data-action="up"]').addEventListener('click', () => moveTask(index, -1));
    card.querySelector('[data-action="down"]').addEventListener('click', () => moveTask(index, 1));
  });
}

function updateTask(index, field, value) {
  const lines = () => value.split(/\\r?\\n/).map((item) => item.trim()).filter(Boolean);
  if (field === 'dependencies') model.manifest.tasks[index][field] = value.split(',').map((item) => item.trim()).filter(Boolean);
  else if (field === 'acceptanceCriteria' || field === 'expectedEvidence') model.manifest.tasks[index][field] = lines();
  else model.manifest.tasks[index][field] = value;
  saveManifest();
}
function moveTask(index, offset) {
  const target = index + offset;
  if (target < 0 || target >= model.manifest.tasks.length) return;
  [model.manifest.tasks[index], model.manifest.tasks[target]] = [model.manifest.tasks[target], model.manifest.tasks[index]];
  saveManifest();
}
function collectGeneral() {
  model.manifest = { ...model.manifest, id: byId('activity-id').value.trim(), title: byId('title').value.trim(), description: byId('description').value, version: byId('version').value.trim(), type: byId('type').value };
}
function saveManifest() { collectGeneral(); vscode.postMessage({ type: 'saveManifest', manifest: model.manifest }); renderTasks(); }
function renderValidation(result) {
  if (!result) { byId('validation-results').innerHTML = '<p class="muted">Validation has not run yet.</p>'; return; }
  byId('validation-results').innerHTML = ['errors','warnings','info'].map((group) => \`<h3>\${group}</h3>\${(result[group] ?? []).map((issue) => \`<div class="card \${esc(issue.severity)}"><strong>\${esc(issue.code)}</strong>: \${esc(issue.message)}</div>\`).join('') || '<p class="muted">None</p>'}\`).join('');
}
byId('save-general').addEventListener('click', saveManifest);
byId('add-task').addEventListener('click', () => { model.manifest.tasks.push({ id: 'task-' + String(model.manifest.tasks.length + 1).padStart(2, '0'), title: 'New task', file: 'tasks/task-' + String(model.manifest.tasks.length + 1).padStart(2, '0') + '.md', dependencies: [], acceptanceCriteria: [], expectedEvidence: [] }); saveManifest(); });
byId('save-instructions').addEventListener('click', () => vscode.postMessage({ type: 'saveInstructions', content: byId('instructions').value }));
byId('save-rubric').addEventListener('click', () => { try { model.rubric = JSON.parse(byId('rubric-json').value); vscode.postMessage({ type: 'saveRubric', rubric: model.rubric }); } catch { vscode.postMessage({ type: 'showError', message: 'Rubric JSON is invalid' }); } });
byId('run-validation').addEventListener('click', () => vscode.postMessage({ type: 'validate' }));
byId('run-export').addEventListener('click', () => vscode.postMessage({ type: 'export' }));
window.addEventListener('message', (event) => { if (event.data.type === 'model') { model = event.data.model; render(); } });
render();`;
  return webviewDocument(webview, "Activity Designer", body, script);
}
