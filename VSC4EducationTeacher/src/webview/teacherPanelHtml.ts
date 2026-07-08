import * as vscode from "vscode";
import { ActivityStatus } from "../types/ActivityStatus";
import { escapeHtml, webviewDocument } from "./webviewUtils";

export function teacherPanelHtml(
  webview: vscode.Webview,
  status: ActivityStatus
): string {
  const encoded = JSON.stringify(status).replace(/</g, "\\u003c");
  const body = `<header>
  <strong>Learning Activity Teacher</strong>
  <div class="muted">${escapeHtml(status.root)}</div>
</header>
<main id="app"></main>`;
  const script = `
const vscode = acquireVsCodeApi();
let status = ${encoded};
const app = document.getElementById('app');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function post(type, data = {}) { vscode.postMessage({ type, ...data }); }
function openButton(path, label = 'Open file') {
  return \`<button data-open="\${esc(path)}">\${esc(label)}</button>\`;
}
function bindCommon() {
  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => post('openFile', { path: button.dataset.open })));
  document.querySelectorAll('[data-create-file]').forEach((button) => button.addEventListener('click', () => post('createFile', { kind: button.dataset.createFile })));
  document.querySelectorAll('[data-import-legacy]').forEach((button) => button.addEventListener('click', () => post('importLegacyMaterial', { importKind: button.dataset.importLegacy })));
  document.querySelectorAll('[data-reveal]').forEach((button) => button.addEventListener('click', () => post('revealPath', { path: button.dataset.reveal })));
  document.querySelectorAll('[data-register-task]').forEach((button) => button.addEventListener('click', () => post('registerTask', { taskFile: button.dataset.registerTask })));
}
function renderWizard() {
  app.innerHTML = \`
    <h1>Create activity in this project</h1>
    <p>This folder does not contain <code>manifest.json</code>. The wizard will initialize the activity directly here; afterwards, its files remain the source of truth.</p>
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
function metric(label, value, className = '') {
  return \`<div class="card \${className}"><div class="muted">\${esc(label)}</div><strong style="font-size:24px">\${esc(value)}</strong></div>\`;
}
function renderReady() {
  const manifest = status.manifest;
  const validation = status.validation;
  const invalidManifest = !manifest;
  app.innerHTML = \`
    <div class="row" style="justify-content:space-between">
      <div><h1>\${esc(manifest?.title ?? 'Activity files need attention')}</h1><p class="muted">\${esc(manifest?.description ?? status.manifestError ?? '')}</p></div>
      <div class="row"><button id="refresh" class="secondary">Refresh</button><button id="validate" class="secondary">Validate</button><button id="export" \${validation?.valid ? '' : 'disabled'}>Export ZIP</button></div>
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
      <p class="muted">These <code>task-N.md</code> files were detected automatically but are not yet listed in <code>manifest.json</code>.</p>
      \${status.discoveredTasks.map((task) => \`
        <div class="card warning">
          <strong>\${esc(task.title)}</strong> <code>\${esc(task.id)}</code>
          <p class="muted">\${esc(task.file)}</p>
          <div class="row">\${openButton(task.file, 'Edit Markdown')}<button data-register-task="\${esc(task.file)}">Add to activity</button></div>
        </div>\`).join('')}\` : ''}
    <h2>Project files</h2>
    <div class="row"><button data-create-file="theory">Create theory file</button><button data-import-legacy="practice">Import legacy practice</button><button data-import-legacy="theory">Import theory material</button><button data-reveal="theory" class="secondary">Reveal theory folder</button><button data-reveal="starter" class="secondary">Reveal starter project</button></div>
    <table><thead><tr><th>File</th><th>Kind</th><th>Status</th><th></th></tr></thead><tbody>
      \${status.files.map((file) => \`<tr><td><code>\${esc(file.path)}</code></td><td>\${esc(file.kind)}</td><td class="\${file.exists ? '' : 'error'}">\${file.exists ? (file.referenced ? 'referenced' : 'present') : 'missing'}</td><td>\${file.exists ? openButton(file.path) : ''}</td></tr>\`).join('')}
    </tbody></table>
    <h2>Validation</h2>
    <div id="validation">
      \${['errors','warnings','info'].map((group) => \`<h3>\${group}</h3>\${(validation?.[group] ?? []).map((issue) => \`<div class="card \${esc(issue.severity)}"><strong>\${esc(issue.code)}</strong>: \${esc(issue.message)}</div>\`).join('') || '<p class="muted">None</p>'}\`).join('')}
    </div>\`;
  document.getElementById('refresh').addEventListener('click', () => post('refresh'));
  document.getElementById('validate').addEventListener('click', () => post('refresh'));
  document.getElementById('export').addEventListener('click', () => post('export'));
  document.getElementById('add-task').addEventListener('click', () => post('addTask'));
  bindCommon();
}
function render() { status.initialized ? renderReady() : renderWizard(); }
window.addEventListener('message', (event) => { if (event.data.type === 'status') { status = event.data.status; render(); } });
render();`;
  return webviewDocument(webview, "Learning Activity Teacher", body, script);
}
