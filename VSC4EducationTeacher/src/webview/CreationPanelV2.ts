import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ActivityPackageService } from "../services/ActivityPackageService";
import { ActivityProjectService } from "../services/ActivityProjectService";
import { ActivityStatusService } from "../services/ActivityStatusService";
import { EvidenceCryptoService } from "../services/EvidenceCryptoService";
import {
  ActivityManifest,
  RepositoryEventServerConfiguration
} from "../types/ActivityManifest";
import { pathExists } from "../utils/fs";
import { resolveInside } from "../utils/paths";
import { VALID_ID } from "../utils/validation";
import {
  creationPanelV2Html,
  CreationPanelV2Model
} from "./creationPanelV2Html";

interface CreateActivityPayload {
  id: string;
  title: string;
  description?: string;
  version: string;
  type: "exercise" | "project";
  firstTaskTitle: string;
}

type LegacyImportKind = "practice" | "theory";

interface EventServerConfigurationPayload {
  enabled: boolean;
  baseUrl?: string;
  activityVersionId?: number | string;
  ingestionToken?: string;
  publicSigningKeyUrl?: string;
  expectedSigningKeyId?: string;
  expectedPublicKeySha256?: string;
  publicSigningKey?: Record<string, unknown>;
  requireReceipts?: boolean;
}

type UtilityPromptId =
  | "tasksFromImports"
  | "theoryFromImports"
  | "solutionsForTasks"
  | "rubricsForTasks"
  | "reviewManifest"
  | "acceptanceCriteria"
  | "alignTasksWithTheory"
  | "migrateLegacyMaterial"
  | "starterDirectoriesPerExercise"
  | "polishActivityLanguage";

export class CreationPanelV2 {
  private static current: CreationPanelV2 | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private activityRoot: string | undefined;

  static async show(context: vscode.ExtensionContext): Promise<void> {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One);
      await this.current.refresh(true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "learningActivityTeacherCreationV2",
      "Activity Creation V2",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
      }
    );
    const instance = new CreationPanelV2(
      panel,
      context.extensionUri
    );
    this.current = instance;
    panel.onDidDispose(() => {
      instance.dispose();
      if (this.current === instance) {
        this.current = undefined;
      }
    });
    await instance.refresh(true);
  }

  static registerSerializer(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer(
      "learningActivityTeacherCreationV2",
      {
        deserializeWebviewPanel: async (panel) => {
          panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [context.extensionUri]
          };
          const instance = new CreationPanelV2(
            panel,
            context.extensionUri
          );
          this.current = instance;
          panel.onDidDispose(() => {
            instance.dispose();
            if (this.current === instance) {
              this.current = undefined;
            }
          });
          await instance.refresh(true);
        }
      }
    );
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly projects = new ActivityProjectService(),
    private readonly statusService = new ActivityStatusService(),
    private readonly packages = new ActivityPackageService(),
    private readonly evidence = new EvidenceCryptoService()
  ) {
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message) => this.handle(message)),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.contains(document.uri.fsPath)) this.scheduleRefresh();
      }),
      vscode.workspace.onDidCreateFiles((event) => {
        if (event.files.some((uri) => this.contains(uri.fsPath))) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidDeleteFiles((event) => {
        if (event.files.some((uri) => this.contains(uri.fsPath))) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        if (
          event.files.some(
            (file) =>
              this.contains(file.oldUri.fsPath) ||
              this.contains(file.newUri.fsPath)
          )
        ) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.hydrateRoot().then(() => this.scheduleRefresh());
      })
    );
  }

  private contains(target: string): boolean {
    if (!this.activityRoot) return false;
    const relative = path.relative(this.activityRoot, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 150);
  }

  private async refresh(replaceHtml = false): Promise<void> {
    await this.hydrateRoot();
    const model = await this.model();
    if (replaceHtml || !this.panel.webview.html) {
      this.panel.webview.html = creationPanelV2Html(
        this.panel.webview,
        this.extensionUri,
        model
      );
    } else {
      await this.panel.webview.postMessage({ type: "model", model });
      await this.panel.webview.postMessage({ type: "ready" });
    }
  }

  private async model(): Promise<CreationPanelV2Model> {
    if (!this.activityRoot) return {};
    return {
      activityRoot: this.activityRoot,
      activity: await this.statusService.inspect(this.activityRoot)
    };
  }

  private async handle(message: {
    type: string;
    path?: string;
    kind?: "task" | "theory" | "rubric";
    importKind?: LegacyImportKind;
    promptId?: UtilityPromptId;
    configuration?: EventServerConfigurationPayload;
  }): Promise<void> {
    try {
      switch (message.type) {
        case "startActivity":
          await this.startNewActivity();
          break;
        case "openActivity":
          await this.selectActivityRoot("Work on existing learning activity");
          break;
        case "useCurrentActivityWorkspace":
          await this.useCurrentActivityWorkspace();
          break;
        case "initializeCurrent":
          await this.initializeCurrentActivity();
          break;
        case "refresh":
          await this.refresh();
          break;
        case "openFile":
          if (message.path) await this.openFile(message.path);
          break;
        case "createFile":
          if (message.kind) await this.createFile(message.kind);
          break;
        case "importLegacyMaterial":
          if (message.importKind) await this.importLegacyMaterial(message.importKind);
          break;
        case "copyMigrationPrompt":
          await this.copyMigrationPrompt();
          break;
        case "copyUtilityPrompt":
          if (message.promptId) await this.copyUtilityPrompt(message.promptId);
          break;
        case "addTask":
          await this.addNextTask();
          break;
        case "revealPath":
          if (message.path) await this.revealPath(message.path);
          break;
        case "generateSignatures":
          await this.generateSignatures();
          break;
        case "exportStudent":
          await this.exportStudent();
          break;
        case "exportTeacher":
          await this.exportTeacher();
          break;
        case "saveEventServerConfiguration":
          if (message.configuration) {
            await this.saveEventServerConfiguration(message.configuration);
          }
          break;
        case "pasteEventServerConfiguration":
          await this.pasteEventServerConfiguration();
          break;
      }
    } catch (error) {
      await this.panel.webview.postMessage({ type: "ready" });
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async selectActivityRoot(title: string): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: title,
      title
    });
    if (!selected?.[0]) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    this.activityRoot = selected[0].fsPath;
    this.addFolderToWorkspace(this.activityRoot, "Learning Activity");
    await this.refresh();
  }

  private async startNewActivity(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Start new learning activity",
      title: "Select the folder for the new learning activity"
    });
    if (!selected?.[0]) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    const root = selected[0].fsPath;
    this.activityRoot = root;
    await this.initializeDefaultActivity(root);
    this.addFolderToWorkspace(root, "Learning Activity");
    this.panel.dispose();
    void vscode.window.showInformationMessage("Activity initialized");
  }

  private async useCurrentActivityWorkspace(): Promise<void> {
    const root = await this.currentWorkspaceRoot(
      "Select the current workspace folder to use as the learning activity"
    );
    if (!root) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    this.activityRoot = root;
    await this.refresh();
  }

  private async initializeCurrentActivity(): Promise<void> {
    const root = this.requireActivityRoot();
    await this.initializeDefaultActivity(root);
    await this.refresh();
    void vscode.window.showInformationMessage("Activity initialized");
  }

  private async initializeDefaultActivity(root: string): Promise<void> {
    if (await pathExists(path.join(root, "manifest.json"))) {
      throw new Error("This project already contains manifest.json");
    }
    const activityName = this.activityNameFromFolder(root);
    await this.initializeActivityFiles(root, {
      id: activityName.id,
      title: activityName.title,
      description: "",
      version: "1.0.0",
      type: "exercise",
      firstTaskTitle: "First task"
    });
  }

  private async initializeActivityFiles(
    root: string,
    activity: CreateActivityPayload
  ): Promise<void> {
    if (!VALID_ID.test(activity.id)) {
      throw new Error(
        "The activity ID may contain only letters, numbers, dots, hyphens, and underscores"
      );
    }
    const taskId = "task-01";
    const manifest: ActivityManifest = {
      id: activity.id,
      title: activity.title,
      description: activity.description,
      version: activity.version,
      type: activity.type,
      tasks: [
        {
          id: taskId,
          title: activity.firstTaskTitle,
          file: `tasks/${taskId}.md`,
          dependencies: [],
          acceptanceCriteria: [],
          expectedEvidence: ["source_changes", "task_events", "git_commits"]
        }
      ]
    };
    await this.projects.initialize(root, manifest);
    await fs.writeFile(
      path.join(root, "tasks", `${taskId}.md`),
      `# ${activity.firstTaskTitle}\n`,
      "utf8"
    );
    await this.projects.ensureAssessmentFiles(root, manifest);
  }

  private activityNameFromFolder(root: string): { id: string; title: string } {
    const basename = path.basename(root);
    const id = basename
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+/i, "")
      .replace(/[^a-z0-9]+$/i, "");
    return {
      id: VALID_ID.test(id) ? id : "learning-activity",
      title: basename.trim() || "Learning Activity"
    };
  }

  private async openFile(relativePath: string): Promise<void> {
    const target = resolveInside(this.requireActivityRoot(), relativePath);
    if (!(await pathExists(target))) {
      throw new Error(`File does not exist: ${relativePath}`);
    }
    await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: false });
    await this.panel.webview.postMessage({ type: "ready" });
  }

  private async createFile(kind: "task" | "theory" | "rubric"): Promise<void> {
    if (kind === "rubric") {
      const root = this.requireActivityRoot();
      const status = await this.statusService.inspect(root);
      if (!status.manifest) throw new Error("Fix manifest.json before creating assessment rubrics");
      await this.projects.ensureAssessmentFiles(root, status.manifest);
      const firstTask = status.manifest.tasks[0];
      await this.openFile(`assessment/rubrics/${firstTask.id}.yml`);
      await this.refresh();
      return;
    }
    if (kind === "task") {
      await this.addNextTask();
      return;
    }
    const root = this.requireActivityRoot();
    const name = await vscode.window.showInputBox({
      title: "Create theory file",
      prompt: "Markdown filename without extension",
      validateInput: (value) =>
        VALID_ID.test(value.trim())
          ? undefined
          : "Use only letters, numbers, dots, hyphens, and underscores"
    });
    if (!name) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    const relativePath = `theory/${name}.md`;
    const target = resolveInside(root, relativePath);
    if (await pathExists(target)) throw new Error(`${relativePath} already exists`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `# ${name}\n`, "utf8");
    await this.openFile(relativePath);
    await this.refresh();
  }

  private async importLegacyMaterial(kind: LegacyImportKind): Promise<void> {
    const root = this.requireActivityRoot();
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: kind === "practice" ? "Import legacy practice" : "Import theory material"
    });
    const source = selection?.[0]?.fsPath;
    if (!source) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    const importsRoot = resolveInside(root, path.join("imports", kind));
    await fs.mkdir(importsRoot, { recursive: true });
    const destination = await this.nextAvailableImportPath(
      importsRoot,
      path.basename(source)
    );
    await fs.copyFile(source, destination);
    void vscode.window.showInformationMessage(
      `Imported ${path.basename(source)} to ${path.relative(root, destination)}`
    );
    await this.refresh();
  }

  private async nextAvailableImportPath(
    directory: string,
    filename: string
  ): Promise<string> {
    const parsed = path.parse(filename);
    let candidate = path.join(directory, filename);
    let suffix = 1;
    while (await pathExists(candidate)) {
      candidate = path.join(directory, `${parsed.name}-${suffix}${parsed.ext}`);
      suffix += 1;
    }
    return candidate;
  }

  private async copyMigrationPrompt(): Promise<void> {
    await vscode.env.clipboard.writeText(this.migrationPrompt());
    void vscode.window.showInformationMessage("Migration prompt copied to clipboard");
    await this.panel.webview.postMessage({ type: "ready" });
  }

  private async copyUtilityPrompt(promptId: UtilityPromptId): Promise<void> {
    await vscode.env.clipboard.writeText(this.utilityPrompt(promptId));
    void vscode.window.showInformationMessage("Utility prompt copied to clipboard");
    await this.panel.webview.postMessage({ type: "ready" });
  }

  private migrationPrompt(): string {
    return `You are helping me migrate legacy teaching material into a VSCode4Education teacher activity project.

Workspace root: ${this.requireActivityRoot()}

Use the files under imports/ as source material only:
- imports/theory/ contains legacy theory material, slides, notes, PDFs, DOCX files, or references.
- imports/practice/ contains legacy practice statements, exercises, examples, tests, solutions, or assignment material.

Create or update the canonical activity files from that material while preserving the VSCode4Education compatibility contract.`;
  }

  private utilityPrompt(promptId: UtilityPromptId): string {
    const root = this.requireActivityRoot();
    const context = this.utilityPromptContext(root);
    switch (promptId) {
      case "tasksFromImports":
        return `${context}

Task: create learning activity tasks from scratch based on the imported material.

Use these sources:
- imports/practice/ as the primary source for exercises, assignment statements, examples, tests, constraints, and grading notes.
- imports/theory/ as supporting context for concepts, vocabulary, sequencing, and expected prior knowledge.
- manifest.json to understand the current activity id, title, version, and any existing task IDs.

Expected results:
- Create or update Markdown task files under tasks/.
- Update manifest.json so manifest.tasks contains one entry for each task.
- Every task must have a stable id, clear title, relative file path, dependencies, acceptanceCriteria, and expectedEvidence.
- Use task IDs like task-01, task-02, etc. unless the existing manifest already uses a different stable convention.
- Make the tasks progressive: each task should be achievable, assessable, and aligned with the imported material.
- If you infer dependencies, declare them explicitly in manifest.tasks[*].dependencies.

Constraints:
- Do not put private solutions or grading rubrics in tasks/.
- Do not modify signatures/, teacher-private/, node_modules/, dist/, out/, or .git/.
- Preserve the VSCode4Education activity format. Student-facing tasks must not reveal complete solutions.
- After editing, briefly report which files you changed and any assumptions you made.`;
      case "theoryFromImports":
        return `${context}

Task: create student-facing theory files from scratch based on the imported material.

Use these sources:
- imports/theory/ as the primary source for explanations, definitions, examples, slides, notes, and references.
- imports/practice/ as context for what the theory must prepare students to do.
- manifest.json and tasks/ to understand the expected learning sequence.

Expected results:
- Create Markdown theory files under theory/.
- Structure the material into short, readable files with clear headings and examples.
- Keep the theory aligned with the task progression, but do not include complete task solutions.
- If a task needs prerequisite concepts, make sure those concepts are covered before the task would be attempted.
- Use filenames that are stable, descriptive, and safe relative paths.

Constraints:
- Do not overwrite useful existing theory files without preserving their intent.
- Do not modify signatures/, teacher-private/, node_modules/, dist/, out/, or .git/.
- Keep the content student-facing: clear, helpful, and pedagogical, without private grading notes.
- After editing, summarize the theory files created or updated and how they map to the tasks.`;
      case "solutionsForTasks":
        return `${context}

Task: create private reference solutions for the tasks in the assessment folder.

Use these sources:
- manifest.json for the canonical task list and task IDs.
- tasks/ for the student-facing task statements.
- starter/ for the starting project structure and constraints.
- imports/practice/ and imports/theory/ for any legacy expectations or examples.

Expected results:
- For each manifest task, create or update assessment/solutions/<taskId>.md.
- Each solution file should explain the intended approach, key implementation details, and expected final state.
- Include code snippets only when they are useful for teacher review; keep them private in assessment/solutions/.
- Note common valid alternatives and likely misconceptions if the task allows multiple solutions.
- Ensure every solution uses the exact task ID from manifest.tasks[*].id.

Constraints:
- Do not place solutions in tasks/, theory/, starter/, or agent/instructions.md.
- Do not modify signatures/, teacher-private/, node_modules/, dist/, out/, or .git/.
- Do not change the student-facing task unless you find a clear inconsistency; if you do, explain it.
- After editing, list which solution files were created or updated.`;
      case "rubricsForTasks":
        return `${context}

Task: create private assessment rubrics for the tasks.

Use these sources:
- manifest.json for task IDs, titles, dependencies, acceptance criteria, and expected evidence.
- tasks/ for student-facing requirements.
- assessment/solutions/ for expected approaches when available.
- docs/schemas/assessment-rubric.schema.json as the schema contract for rubric files.

Expected results:
- For each manifest task, create or update assessment/rubrics/<taskId>.yml.
- Each rubric should evaluate the task independently and use the exact task ID from manifest.tasks[*].id.
- Include criteria that distinguish correctness, completeness, code quality, process evidence, and relevant edge cases.
- Use weights that add up consistently according to the existing rubric format.
- Prefer observable criteria that a teacher can verify from submitted files, events, commits, and task metadata.

Constraints:
- Keep rubrics private under assessment/rubrics/.
- Do not reveal grading details in student-facing tasks or theory unless explicitly intended.
- Do not modify signatures/, teacher-private/, node_modules/, dist/, out/, or .git/.
- After editing, summarize the rubric files and any criteria that depend on evidence collection.`;
      case "reviewManifest":
        return `${context}

Task: review and improve manifest.json for this learning activity.

Use these sources:
- manifest.json as the canonical activity definition.
- tasks/ to verify task files, task titles, and task content.
- theory/ to understand student-facing instructional material.
- assessment/rubrics/ and assessment/solutions/ to check private assessment alignment.
- docs/activity-format.md for the portable activity format.

Expected results:
- Fix missing, inconsistent, or unclear manifest fields.
- Ensure id, title, description, version, type, and tasks are coherent.
- Ensure every manifest.tasks[*].id is stable and every task file path is safe and relative.
- Ensure dependencies reference existing task IDs and represent a sensible learning progression.
- Improve acceptanceCriteria and expectedEvidence where they are missing or too vague.

Constraints:
- Do not rename task IDs unless absolutely necessary; if you must, update all matching files and references.
- Do not introduce paths outside the activity package.
- Preserve compatibility with the student extension and repository importer.
- After editing, explain every manifest change and any compatibility risk.`;
      case "acceptanceCriteria":
        return `${context}

Task: create or improve acceptance criteria for every task in manifest.json.

Use these sources:
- manifest.json for the canonical task list.
- tasks/ for what students are asked to do.
- assessment/solutions/ for the intended outcome when available.
- assessment/rubrics/ for grading expectations when available.

Expected results:
- Update manifest.tasks[*].acceptanceCriteria with clear, assessable criteria.
- Criteria should describe observable outcomes, not vague effort.
- Criteria should be understandable to students and useful to teachers.
- Keep criteria specific enough to guide work, but avoid revealing private solution details.
- If a task has dependencies, criteria should reflect only what that task adds or verifies.

Constraints:
- Do not add complete solutions to manifest.json.
- Do not change task IDs or file paths unless needed to fix a real inconsistency.
- Preserve valid JSON formatting.
- After editing, summarize the criteria added per task.`;
      case "alignTasksWithTheory":
        return `${context}

Task: align the task sequence with the theory files.

Use these sources:
- theory/ for student-facing explanations and examples.
- tasks/ for task statements.
- manifest.json for task order, dependencies, acceptance criteria, and expected evidence.
- imports/ as background material if existing theory or tasks are incomplete.

Expected results:
- Identify gaps where tasks require concepts not explained in theory/.
- Update theory files or task wording so students receive the necessary context before each task.
- If useful, add references inside task Markdown files to relevant theory files.
- Keep task dependencies consistent with the theory progression.
- Improve wording where a task and theory file use inconsistent terminology.

Constraints:
- Do not include private solutions or rubric details in theory/ or tasks/.
- Do not modify signatures/, teacher-private/, node_modules/, dist/, out/, or .git/.
- Preserve task IDs and package paths unless a real broken reference must be fixed.
- After editing, report the alignment changes and any remaining gaps.`;
      case "migrateLegacyMaterial":
        return `${context}

Task: migrate legacy imported material into the VSCode4Education activity structure.

Use these sources:
- imports/practice/ for old exercises, assignments, tests, solutions, and examples.
- imports/theory/ for old theory, notes, slides, readings, and explanations.
- manifest.json to preserve or improve the current activity definition.
- tasks/, theory/, assessment/rubrics/, and assessment/solutions/ as the target structure.

Expected results:
- Convert relevant practice material into tasks/ and manifest.tasks entries.
- Convert relevant theory material into student-facing Markdown files under theory/.
- Move private solution or grading material into assessment/solutions/ and assessment/rubrics/.
- Keep imports/ as source material; do not delete it unless explicitly asked.
- Preserve a clean separation between student-facing content and teacher-private assessment content.

Constraints:
- Preserve the VSCode4Education portable activity format.
- Do not modify signatures/, teacher-private/, node_modules/, dist/, out/, or .git/.
- Avoid copying irrelevant legacy boilerplate into the canonical files.
- After editing, summarize what was migrated, what was skipped, and why.`;
      case "starterDirectoriesPerExercise":
        return `${context}

Task: create a starter/ directory structure with one directory per exercise or task.

Use these sources:
- manifest.json for the canonical list of tasks, task IDs, titles, dependencies, and intended order.
- tasks/ for each student-facing task statement and the files students are expected to create or edit.
- imports/practice/ for legacy exercise structures, sample project files, tests, fixtures, or starter code.
- imports/theory/ for concepts that may imply useful starter examples or scaffolding.
- assessment/solutions/ only as private reference material when deciding what minimal starter files are appropriate.

Expected results:
- Create or update subdirectories under starter/ so each exercise has a clear working area, preferably named with the task ID, for example starter/task-01/ and starter/task-02/.
- Include only files students should receive at the start of the activity: skeleton code, sample data, fixtures, TODO markers, empty modules, configuration, or tests that are intentionally part of the starter.
- If tasks refer to specific paths, align those paths with the starter structure and update task text only when needed for consistency.
- Keep the starter structure easy for students to navigate after the student extension copies starter/ into their workspace.
- Add lightweight README files inside starter subdirectories only when they help students understand where to work.

Constraints:
- Do not put complete solutions, teacher notes, rubric criteria, or private hints in starter/.
- Do not modify signatures/, teacher-private/, node_modules/, dist/, out/, or .git/.
- Preserve task IDs in manifest.json and avoid changing dependencies unless the starter structure reveals a real mismatch.
- Do not duplicate large imported files unless they are genuinely needed by students.
- After editing, summarize each starter/<taskId>/ directory created or updated and explain how it maps to the corresponding task.`;
      case "polishActivityLanguage":
        return `${context}

Task: polish the language of the learning activity without changing its pedagogical intent.

Use these sources:
- manifest.json for activity title, description, task titles, acceptance criteria, and expected evidence.
- tasks/ for student-facing instructions.
- theory/ for student-facing explanations.
- agent/instructions.md for guidance given to the student's agent.

Expected results:
- Improve clarity, consistency, grammar, and tone across student-facing files.
- Make instructions more actionable and less ambiguous.
- Standardize terminology between manifest.json, tasks/, theory/, and agent/instructions.md.
- Keep the difficulty level and intended learning outcomes unchanged.
- Preserve all task IDs, file paths, dependencies, and package structure.

Constraints:
- Do not add solutions or private grading details to student-facing content.
- Do not modify assessment files unless a wording mismatch needs a small clarification.
- Do not modify signatures/, teacher-private/, node_modules/, dist/, out/, or .git/.
- After editing, summarize the language changes and flag any ambiguity that requires teacher judgment.`;
    }
  }

  private utilityPromptContext(root: string): string {
    return `You are helping me author a VSCode4Education learning activity.

Activity workspace root:
${root}

Important package structure:
- manifest.json is the canonical activity definition.
- tasks/ contains student-facing task statements.
- theory/ contains student-facing theory material.
- imports/practice/ contains imported legacy practice or assignment material.
- imports/theory/ contains imported legacy theory material.
- starter/ contains the project files students receive as their starting point.
- agent/instructions.md contains guidance for the student's coding agent.
- assessment/rubrics/ contains teacher-private per-task rubrics.
- assessment/solutions/ contains teacher-private per-task reference solutions.
- signatures/ and teacher-private/ contain generated evidence material and must not be edited unless explicitly requested.

Compatibility rules:
- Preserve the VSCode4Education activity package contract.
- Use task IDs from manifest.tasks[*].id as canonical references.
- Keep all package references as safe relative paths inside the activity.
- Do not place private solutions, rubrics, or grading notes in student-facing files.
- Do not edit node_modules/, dist/, out/, .git/, signatures/, or teacher-private/.`;
  }

  private async addNextTask(): Promise<void> {
    const root = this.requireActivityRoot();
    const status = await this.statusService.inspect(root);
    if (!status.manifest) throw new Error("Fix manifest.json before adding a task");
    const number = status.nextTaskNumber;
    const id = `task-${number}`;
    const title =
      (await vscode.window.showInputBox({
        title: `Add ${id}`,
        prompt: "Task title",
        value: `Task ${number}`,
        validateInput: (value) =>
          value.trim() ? undefined : "Task title is required"
      }))?.trim();
    if (!title) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    const relativePath = `tasks/${id}.md`;
    const target = resolveInside(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `# ${title}\n`, "utf8");
    status.manifest.tasks.push({
      id,
      title,
      file: relativePath,
      dependencies: [],
      acceptanceCriteria: [],
      expectedEvidence: ["source_changes", "task_events", "git_commits"]
    });
    await this.projects.save(root, status.manifest);
    await this.projects.ensureAssessmentFiles(root, status.manifest);
    await this.openFile(relativePath);
    await this.refresh();
  }

  private async revealPath(relativePath: string): Promise<void> {
    await vscode.commands.executeCommand(
      "revealFileInOS",
      vscode.Uri.file(resolveInside(this.requireActivityRoot(), relativePath))
    );
    await this.panel.webview.postMessage({ type: "ready" });
  }

  private async exportStudent(): Promise<void> {
    const root = this.requireActivityRoot();
    const status = await this.statusService.inspect(root);
    if (!status.validation?.valid) throw new Error("Fix validation errors before exporting");
    const destination = await vscode.window.showSaveDialog({
      filters: { "ZIP archive": ["zip"] },
      defaultUri: vscode.Uri.file(
        path.join(path.dirname(root), `${status.manifest?.id ?? "activity"}.zip`)
      )
    });
    if (!destination) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    await this.packages.export(root, destination.fsPath, true);
    void vscode.window.showInformationMessage(`Student activity exported to ${destination.fsPath}`);
    await this.refresh();
  }

  private async generateSignatures(): Promise<void> {
    const root = this.requireActivityRoot();
    await this.evidence.ensureKeyPair(root);
    void vscode.window.showInformationMessage("Evidence signatures generated");
    await this.refresh();
  }

  private async exportTeacher(): Promise<void> {
    const root = this.requireActivityRoot();
    const status = await this.statusService.inspect(root);
    if (!status.validation?.valid) throw new Error("Fix validation errors before exporting");
    const destination = await vscode.window.showSaveDialog({
      filters: { "ZIP archive": ["zip"] },
      defaultUri: vscode.Uri.file(
        path.join(
          path.dirname(root),
          `${status.manifest?.id ?? "activity"}-teacher.zip`
        )
      )
    });
    if (!destination) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    await this.packages.exportTeacherPackage(root, destination.fsPath);
    void vscode.window.showInformationMessage(`Teacher package exported to ${destination.fsPath}`);
    await this.refresh();
  }

  private async saveEventServerConfiguration(
    payload: EventServerConfigurationPayload
  ): Promise<void> {
    const root = this.requireActivityRoot();
    const manifest = await this.projects.load(root);
    const eventServer: RepositoryEventServerConfiguration = {
      enabled: Boolean(payload.enabled),
      baseUrl: this.cleanString(payload.baseUrl)
    };
    if (eventServer.enabled && !eventServer.baseUrl) {
      throw new Error("Event server base URL is required when enabled");
    }
    const activityVersionId = Number(payload.activityVersionId);
    if (Number.isFinite(activityVersionId) && activityVersionId > 0) {
      eventServer.activityVersionId = activityVersionId;
    }
    const ingestionToken = this.cleanString(payload.ingestionToken);
    if (ingestionToken) eventServer.ingestionToken = ingestionToken;
    const publicSigningKeyUrl = this.cleanString(payload.publicSigningKeyUrl);
    if (publicSigningKeyUrl) eventServer.publicSigningKeyUrl = publicSigningKeyUrl;
    const expectedSigningKeyId = this.cleanString(payload.expectedSigningKeyId);
    if (expectedSigningKeyId) eventServer.expectedSigningKeyId = expectedSigningKeyId;
    const expectedPublicKeySha256 = this.cleanString(
      payload.expectedPublicKeySha256
    );
    if (expectedPublicKeySha256) {
      eventServer.expectedPublicKeySha256 = expectedPublicKeySha256;
    }
    if (payload.publicSigningKey && typeof payload.publicSigningKey === "object") {
      eventServer.publicSigningKey = payload.publicSigningKey;
    }
    if (payload.requireReceipts) {
      eventServer.requireReceipts = true;
    }
    manifest.repository = {
      ...(manifest.repository ?? {}),
      eventServer
    };
    await this.projects.save(root, manifest);
    void vscode.window.showInformationMessage("Event server configuration saved");
    await this.refresh();
  }

  private async pasteEventServerConfiguration(): Promise<void> {
    const raw = await vscode.env.clipboard.readText();
    let configuration: unknown;
    try {
      configuration = JSON.parse(raw);
    } catch {
      throw new Error("Clipboard does not contain valid Event Server JSON");
    }
    if (!configuration || typeof configuration !== "object") {
      throw new Error("Clipboard does not contain an Event Server configuration object");
    }
    await this.panel.webview.postMessage({
      type: "eventServerConfiguration",
      configuration
    });
    await this.panel.webview.postMessage({ type: "ready" });
  }

  private cleanString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private requireActivityRoot(): string {
    if (!this.activityRoot) throw new Error("Open or create a learning activity first");
    return this.activityRoot;
  }

  private addFolderToWorkspace(folderPath: string, name: string): void {
    const uri = vscode.Uri.file(folderPath);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const normalized = uri.fsPath.replace(/\\/g, "/").toLowerCase();
    if (
      folders.some(
        (folder) => folder.uri.fsPath.replace(/\\/g, "/").toLowerCase() === normalized
      )
    ) {
      return;
    }
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri, name });
  }

  private async hydrateRoot(): Promise<void> {
    const workspaceRoot = await this.findWorkspaceFolderWithFile("manifest.json");
    if (workspaceRoot) {
      this.activityRoot = workspaceRoot;
      return;
    }
    if (!vscode.workspace.workspaceFolders?.length) {
      this.activityRoot = undefined;
      return;
    }
    if (this.activityRoot && (await pathExists(path.join(this.activityRoot, "manifest.json")))) {
      return;
    }
    this.activityRoot = undefined;
  }

  private async findWorkspaceFolderWithFile(
    relativePath: string
  ): Promise<string | undefined> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (await pathExists(path.join(folder.uri.fsPath, relativePath))) {
        return folder.uri.fsPath;
      }
    }
    return undefined;
  }

  private async currentWorkspaceRoot(placeHolder: string): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      void vscode.window.showWarningMessage("No workspace folder is currently open");
      return undefined;
    }
    if (folders.length === 1) {
      return folders[0].uri.fsPath;
    }
    const selected = await vscode.window.showWorkspaceFolderPick({ placeHolder });
    return selected?.uri.fsPath;
  }

  private dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
