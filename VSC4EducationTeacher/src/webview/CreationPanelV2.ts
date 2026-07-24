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
  requireReceipts?: boolean;
}

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
