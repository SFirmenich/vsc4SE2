import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { AgencyMetricsService } from "../services/AgencyMetricsService";
import { ActivityPackageService } from "../services/ActivityPackageService";
import { ActivityProjectService } from "../services/ActivityProjectService";
import { ActivityStatusService } from "../services/ActivityStatusService";
import { FeedbackService } from "../services/FeedbackService";
import { EvidenceCryptoService } from "../services/EvidenceCryptoService";
import { GitReviewService } from "../services/GitReviewService";
import { IntegrityService } from "../services/IntegrityService";
import { ReviewWorkspaceService } from "../services/ReviewWorkspaceService";
import { SubmissionReviewService } from "../services/SubmissionReviewService";
import { ActivityManifest } from "../types/ActivityManifest";
import { SubmissionFeedback } from "../types/Feedback";
import { Rubric } from "../types/Rubric";
import { pathExists, readJson } from "../utils/fs";
import { resolveInside } from "../utils/paths";
import { VALID_ID } from "../utils/validation";
import { SubmissionReviewModel } from "./submissionReviewHtml";
import { teacherPanelHtml, TeacherPanelModel } from "./teacherPanelHtml";

interface CreateActivityPayload {
  id: string;
  title: string;
  description?: string;
  version: string;
  type: "exercise" | "project";
  firstTaskTitle: string;
}

type LegacyImportKind = "practice" | "theory";
type PanelMode = "activity" | "review";

export class TeacherPanel {
  private static current: TeacherPanel | undefined;
  private static currentByMode: Partial<Record<PanelMode, TeacherPanel>> = {};
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private mode: PanelMode | undefined;
  private activityRoot: string | undefined;
  private reviewRoot: string | undefined;
  private selectedSubmissionRoot: string | undefined;

  static async show(
    context: vscode.ExtensionContext,
    initialMode?: PanelMode
  ): Promise<void> {
    const existing = initialMode ? this.currentByMode[initialMode] : this.current;
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      await existing.refresh(true);
      return;
    }
    const panelMode = initialMode;
    const panel = vscode.window.createWebviewPanel(
      panelMode ? `learningActivityTeacher${this.modeTitle(panelMode)}` : "learningActivityTeachPanel",
      panelMode ? this.panelTitle(panelMode) : "Teach Panel",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
      }
    );
    const instance = new TeacherPanel(
      panel,
      context.extensionUri,
      context.globalStorageUri.fsPath,
      panelMode
    );
    instance.mode = panelMode;
    if (panelMode) {
      this.currentByMode[panelMode] = instance;
    } else {
      this.current = instance;
    }
    panel.onDidDispose(() => {
      instance.dispose();
      if (panelMode) {
        if (this.currentByMode[panelMode] === instance) {
          this.currentByMode[panelMode] = undefined;
        }
      } else if (this.current === instance) {
        this.current = undefined;
      }
    });
    await instance.refresh(true);
  }

  private static modeTitle(mode: PanelMode): string {
    return mode === "activity" ? "Creation" : "Revision";
  }

  private static panelTitle(mode: PanelMode): string {
    return mode === "activity" ? "Activity Creation" : "Submission Review";
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly storageRoot: string,
    private readonly fixedMode?: PanelMode,
    private readonly projects = new ActivityProjectService(),
    private readonly statusService = new ActivityStatusService(),
    private readonly packages = new ActivityPackageService(),
    private readonly reviewWorkspaces = new ReviewWorkspaceService(),
    private readonly review = new SubmissionReviewService(),
    private readonly integrity = new IntegrityService(),
    private readonly agencyMetrics = new AgencyMetricsService(),
    private readonly git = new GitReviewService(),
    private readonly feedback = new FeedbackService(),
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
      })
    );
  }

  private contains(target: string): boolean {
    return [this.activityRoot, this.reviewRoot].some((root) => {
      if (!root) return false;
      const relative = path.relative(root, target);
      return (
        relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
      );
    });
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 150);
  }

  private async refresh(replaceHtml = false): Promise<void> {
    const model = await this.model();
    if (replaceHtml || !this.panel.webview.html) {
      this.panel.webview.html = teacherPanelHtml(this.panel.webview, model, this.extensionUri);
    } else {
      await this.panel.webview.postMessage({ type: "model", model });
    }
  }

  private async model(): Promise<TeacherPanelModel> {
    const model: TeacherPanelModel = { mode: this.mode, fixedMode: this.fixedMode };
    if (this.mode === "activity" && this.activityRoot) {
      model.activity = await this.statusService.inspect(this.activityRoot);
      model.activityRoot = this.activityRoot;
    }
    if (this.mode === "review" && this.reviewRoot) {
      const status = await this.reviewWorkspaces.status(this.reviewRoot);
      const activity = status.activityImported
        ? await this.statusService.inspect(status.activityRoot)
        : undefined;
      const selected =
        this.selectedSubmissionRoot ??
        status.submissions[0]?.rootPath;
      this.selectedSubmissionRoot = selected;
      model.review = {
        status,
        activity,
        selectedSubmissionRoot: selected,
        reviewModel: selected ? await this.submissionModel(selected) : undefined
      };
    }
    return model;
  }

  private async submissionModel(
    submissionRoot: string
  ): Promise<SubmissionReviewModel | undefined> {
    const submission = await this.reviewWorkspaces.readSubmission(submissionRoot);
    const integrity: Record<string, unknown> = {};
    const privateKey = this.reviewRoot
      ? await this.evidence.findPrivateKey(this.reviewWorkspaces.activityRoot(this.reviewRoot))
      : undefined;
    for (const contribution of submission.contributions) {
      const target = path.join(
        submission.metadataPath,
        "contributions",
        contribution.studentId,
        "events.jsonl"
      );
      integrity[contribution.studentId] = this.integrity.verify(
        (await pathExists(target)) ? await fs.readFile(target, "utf8") : "",
        privateKey
      );
    }
    const rubricPath = path.join(submission.metadataPath, "rubrics", "main.json");
    const rubric = (await pathExists(rubricPath))
      ? await readJson<Rubric>(rubricPath)
      : undefined;
    const commits = submission.hasGit
      ? await this.git.commits(submission.projectPath).catch(() => [])
      : [];
    return {
      submission,
      rubric,
      summaries: submission.contributions.map((item) => this.review.summarize(item)),
      agencyMetrics: submission.contributions.map((item) =>
        this.agencyMetrics.calculate(item, submission.manifest)
      ),
      integrity,
      commits
    };
  }

  private async handle(message: {
    type: string;
    mode?: PanelMode;
    path?: string;
    kind?: "task" | "theory" | "rubric";
    importKind?: LegacyImportKind;
    taskFile?: string;
    activity?: CreateActivityPayload;
    submissionRoot?: string;
    commit?: string;
    feedback?: SubmissionFeedback;
    message?: string;
  }): Promise<void> {
    try {
      switch (message.type) {
        case "selectMode":
          if (this.fixedMode) break;
          this.mode = message.mode;
          await this.refresh();
          break;
        case "startActivity":
          await this.selectActivityRoot("Start new learning activity");
          break;
        case "openActivity":
          await this.selectActivityRoot("Work on existing learning activity");
          break;
        case "useCurrentActivityWorkspace":
          await this.useCurrentActivityWorkspace();
          break;
        case "createReviewWorkspace":
          await this.createReviewWorkspace();
          break;
        case "openReviewWorkspace":
          await this.openReviewWorkspace();
          break;
        case "useCurrentReviewWorkspace":
          await this.useCurrentReviewWorkspace();
          break;
        case "importReviewActivity":
          await this.importReviewActivity();
          break;
        case "importReviewSubmission":
          await this.importReviewSubmission();
          break;
        case "selectSubmission":
          this.selectedSubmissionRoot = message.submissionRoot;
          await this.refresh();
          break;
        case "createActivity":
          await this.createActivity(message.activity);
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
        case "addTask":
          await this.addNextTask();
          break;
        case "registerTask":
          if (message.taskFile) await this.registerTask(message.taskFile);
          break;
        case "revealPath":
          if (message.path) await this.revealPath(message.path);
          break;
        case "refresh":
          await this.refresh();
          break;
        case "exportStudent":
          await this.exportStudent();
          break;
        case "generateSignatures":
          await this.generateSignatures();
          break;
        case "exportTeacher":
          await this.exportTeacher();
          break;
        case "commitFiles":
          if (message.commit && this.selectedSubmissionRoot) {
            const submission = await this.reviewWorkspaces.readSubmission(
              this.selectedSubmissionRoot
            );
            const files = await this.git.filesForCommit(
              submission.projectPath,
              message.commit
            );
            await this.panel.webview.postMessage({ type: "commitFiles", files });
          }
          break;
        case "saveFeedback":
          if (message.feedback) {
            await this.feedback.save(this.storageRoot, message.feedback);
            void vscode.window.showInformationMessage("Feedback saved");
          }
          break;
        case "exportFeedback":
          await this.exportFeedback();
          break;
        case "error":
          void vscode.window.showErrorMessage(message.message ?? "Invalid input");
          break;
      }
    } catch (error) {
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
    if (!selected?.[0]) return;
    this.mode = "activity";
    this.activityRoot = selected[0].fsPath;
    this.addFolderToWorkspace(this.activityRoot, "Learning Activity");
    await this.refresh();
  }

  private async useCurrentActivityWorkspace(): Promise<void> {
    const root = await this.currentWorkspaceRoot(
      "Select the current workspace folder to use as the learning activity"
    );
    if (!root) return;
    this.mode = "activity";
    this.activityRoot = root;
    await this.refresh();
  }

  private async createReviewWorkspace(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Create review workspace",
      title: "Select a folder for the review workspace"
    });
    if (!selected?.[0]) return;
    this.mode = "review";
    this.reviewRoot = selected[0].fsPath;
    this.selectedSubmissionRoot = undefined;
    await this.reviewWorkspaces.initialize(this.reviewRoot);
    this.addFolderToWorkspace(this.reviewRoot, "Submission Review");
    await this.refresh();
  }

  private async openReviewWorkspace(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Open review workspace",
      title: "Select a review workspace"
    });
    if (!selected?.[0]) return;
    this.mode = "review";
    this.reviewRoot = selected[0].fsPath;
    this.selectedSubmissionRoot = undefined;
    this.addFolderToWorkspace(this.reviewRoot, "Submission Review");
    await this.refresh();
  }

  private async useCurrentReviewWorkspace(): Promise<void> {
    const root = await this.currentWorkspaceRoot(
      "Select the current workspace folder to use as the review workspace"
    );
    if (!root) return;
    this.mode = "review";
    this.reviewRoot = root;
    this.selectedSubmissionRoot = undefined;
    await this.reviewWorkspaces.initialize(this.reviewRoot);
    await this.refresh();
  }

  private async importReviewActivity(): Promise<void> {
    if (!this.reviewRoot) throw new Error("Open a review workspace first");
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "ZIP archive": ["zip"] },
      openLabel: "Import teacher activity package"
    });
    if (!selected?.[0]) return;
    await this.reviewWorkspaces.importActivityPackage(
      selected[0].fsPath,
      this.reviewRoot
    );
    await this.refresh();
  }

  private async importReviewSubmission(): Promise<void> {
    if (!this.reviewRoot) throw new Error("Open a review workspace first");
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "ZIP archive": ["zip"] },
      openLabel: "Import student submission"
    });
    if (!selected?.[0]) return;
    const submission = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Importing student submission",
        cancellable: false
      },
      () =>
        this.reviewWorkspaces.importSubmissionPackage(
          selected[0].fsPath,
          this.reviewRoot!
        )
    );
    this.selectedSubmissionRoot = submission.rootPath;
    this.addFolderToWorkspace(submission.projectPath, "Imported Submission");
    await this.refresh();
  }

  private async createActivity(
    activity: CreateActivityPayload | undefined
  ): Promise<void> {
    const root = this.requireActivityRoot();
    if (!activity) throw new Error("Activity data is missing");
    if (!VALID_ID.test(activity.id)) {
      throw new Error(
        "The activity ID may contain only letters, numbers, dots, hyphens, and underscores"
      );
    }
    if (!activity.title || !activity.version || !activity.firstTaskTitle) {
      throw new Error("Title, version, and first task title are required");
    }
    if (await pathExists(path.join(root, "manifest.json"))) {
      throw new Error("This project already contains manifest.json");
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
    await this.refresh();
    void vscode.window.showInformationMessage("Activity initialized");
  }

  private async openFile(relativePath: string): Promise<void> {
    const target = resolveInside(this.requireActivityRoot(), relativePath);
    if (!(await pathExists(target))) {
      throw new Error(`File does not exist: ${relativePath}`);
    }
    await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: false });
  }

  private async createFile(kind: "task" | "theory" | "rubric"): Promise<void> {
    const root = this.requireActivityRoot();
    if (kind === "rubric") {
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
    const name = await vscode.window.showInputBox({
      title: "Create theory file",
      prompt: "Markdown filename without extension",
      validateInput: (value) =>
        VALID_ID.test(value.trim())
          ? undefined
          : "Use only letters, numbers, dots, hyphens, and underscores"
    });
    if (!name) return;
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
    if (!source) return;
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
  }

  private migrationPrompt(): string {
    return `You are helping me migrate legacy teaching material into a VSCode4Education teacher activity project.

Workspace root: ${this.requireActivityRoot()}

Use the files under imports/ as source material only:
- imports/theory/ contains legacy theory material, slides, notes, PDFs, DOCX files, or references.
- imports/practice/ contains legacy practice statements, exercises, examples, tests, solutions, or assignment material.

Create or update the canonical activity files from that material while preserving the VSCode4Education compatibility contract.`;
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
    if (!title) return;
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

  private async registerTask(relativePath: string): Promise<void> {
    const root = this.requireActivityRoot();
    const status = await this.statusService.inspect(root);
    if (!status.manifest) throw new Error("Fix manifest.json before registering a task");
    const discovered = status.discoveredTasks.find((task) => task.file === relativePath);
    if (!discovered) {
      throw new Error(`Task file is not available for registration: ${relativePath}`);
    }
    if (status.manifest.tasks.some((task) => task.id === discovered.id)) {
      throw new Error(`Task ID already exists: ${discovered.id}`);
    }
    status.manifest.tasks.push({
      id: discovered.id,
      title: discovered.title,
      file: discovered.file,
      dependencies: [],
      acceptanceCriteria: [],
      expectedEvidence: ["source_changes", "task_events", "git_commits"]
    });
    await this.projects.save(root, status.manifest);
    await this.projects.ensureAssessmentFiles(root, status.manifest);
    await this.refresh();
  }

  private async revealPath(relativePath: string): Promise<void> {
    await vscode.commands.executeCommand(
      "revealFileInOS",
      vscode.Uri.file(resolveInside(this.requireActivityRoot(), relativePath))
    );
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
    if (!destination) return;
    await this.packages.export(root, destination.fsPath, true);
    void vscode.window.showInformationMessage(`Student activity exported to ${destination.fsPath}`);
    await this.refresh();
  }

  private async generateSignatures(): Promise<void> {
    const root = this.requireActivityRoot();
    const status = await this.statusService.inspect(root);
    if (!status.validation?.valid) {
      throw new Error("Fix validation errors before generating signatures");
    }
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
    if (!destination) return;
    await this.packages.exportTeacherPackage(root, destination.fsPath);
    void vscode.window.showInformationMessage(`Teacher package exported to ${destination.fsPath}`);
    await this.refresh();
  }

  private async exportFeedback(): Promise<void> {
    if (!this.selectedSubmissionRoot) return;
    const submission = await this.reviewWorkspaces.readSubmission(
      this.selectedSubmissionRoot
    );
    const destination = await vscode.window.showSaveDialog({
      filters: { "ZIP archive": ["zip"] },
      defaultUri: vscode.Uri.file(`${submission.id}-feedback.zip`)
    });
    if (destination) {
      await this.feedback.export(this.storageRoot, submission.id, destination.fsPath);
    }
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
