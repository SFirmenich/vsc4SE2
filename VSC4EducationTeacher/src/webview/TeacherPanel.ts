import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ActivityPackageService } from "../services/ActivityPackageService";
import { ActivityProjectService } from "../services/ActivityProjectService";
import { ActivityStatusService } from "../services/ActivityStatusService";
import { ActivityManifest } from "../types/ActivityManifest";
import { Rubric } from "../types/Rubric";
import { pathExists, writeJson } from "../utils/fs";
import { resolveInside } from "../utils/paths";
import { VALID_ID } from "../utils/validation";
import { teacherPanelHtml } from "./teacherPanelHtml";

interface CreateActivityPayload {
  id: string;
  title: string;
  description?: string;
  version: string;
  type: "exercise" | "project";
  firstTaskTitle: string;
}

type LegacyImportKind = "practice" | "theory";

export class TeacherPanel {
  private static current: TeacherPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static async show(root: string): Promise<void> {
    if (this.current) {
      this.current.root = root;
      this.current.panel.reveal(vscode.ViewColumn.One);
      await this.current.refresh(true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "learningActivityTeacherPanel",
      "Learning Activity Teacher",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.current = new TeacherPanel(panel, root);
    panel.onDidDispose(() => {
      this.current?.dispose();
      this.current = undefined;
    });
    await this.current.refresh(true);
  }

  private refreshTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private root: string,
    private readonly projects = new ActivityProjectService(),
    private readonly statusService = new ActivityStatusService(),
    private readonly packages = new ActivityPackageService()
  ) {
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message) => this.handle(message)),
      vscode.workspace
        .createFileSystemWatcher(
          new vscode.RelativePattern(root, "tasks/task-*.md")
        ),
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
    const taskWatcher = this.disposables[1] as vscode.FileSystemWatcher;
    this.disposables.push(
      taskWatcher.onDidCreate(() => this.scheduleRefresh()),
      taskWatcher.onDidChange(() => this.scheduleRefresh()),
      taskWatcher.onDidDelete(() => this.scheduleRefresh())
    );
  }

  private contains(target: string): boolean {
    const relative = path.relative(this.root, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 150);
  }

  private async refresh(replaceHtml = false): Promise<void> {
    const status = await this.statusService.inspect(this.root);
    if (replaceHtml || !this.panel.webview.html) {
      this.panel.webview.html = teacherPanelHtml(this.panel.webview, status);
    } else {
      await this.panel.webview.postMessage({ type: "status", status });
    }
  }

  private async handle(message: {
    type: string;
    path?: string;
    kind?: "task" | "theory" | "rubric";
    importKind?: LegacyImportKind;
    taskFile?: string;
    activity?: CreateActivityPayload;
  }): Promise<void> {
    try {
      switch (message.type) {
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
        case "addTask":
          await this.addNextTask();
          break;
        case "registerTask":
          if (message.taskFile) await this.registerTask(message.taskFile);
          break;
        case "revealPath":
          if (message.path) {
            await vscode.commands.executeCommand(
              "revealFileInOS",
              vscode.Uri.file(resolveInside(this.root, message.path))
            );
          }
          break;
        case "refresh":
          await this.refresh();
          break;
        case "export":
          await this.export();
          break;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async createActivity(
    activity: CreateActivityPayload | undefined
  ): Promise<void> {
    if (!activity) throw new Error("Activity data is missing");
    if (!VALID_ID.test(activity.id)) {
      throw new Error(
        "The activity ID may contain only letters, numbers, dots, hyphens, and underscores"
      );
    }
    if (!activity.title || !activity.version || !activity.firstTaskTitle) {
      throw new Error("Title, version, and first task title are required");
    }
    if (await pathExists(path.join(this.root, "manifest.json"))) {
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
    await this.projects.initialize(this.root, manifest);
    await fs.writeFile(
      path.join(this.root, "tasks", `${taskId}.md`),
      `# ${activity.firstTaskTitle}\n`,
      "utf8"
    );
    await this.refresh();
    void vscode.window.showInformationMessage(
      "Activity initialized in the current project"
    );
  }

  private async openFile(relativePath: string): Promise<void> {
    const target = resolveInside(this.root, relativePath);
    if (!(await pathExists(target))) {
      throw new Error(`File does not exist: ${relativePath}`);
    }
    await vscode.window.showTextDocument(vscode.Uri.file(target), {
      preview: false
    });
  }

  private async createFile(kind: "task" | "theory" | "rubric"): Promise<void> {
    if (kind === "rubric") {
      const rubric: Rubric = {
        id: "main-rubric",
        title: "Main rubric",
        criteria: []
      };
      const target = path.join(this.root, "rubrics", "main.json");
      await writeJson(target, rubric);
      await this.openFile("rubrics/main.json");
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
    const target = resolveInside(this.root, relativePath);
    if (await pathExists(target)) {
      throw new Error(`${relativePath} already exists`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `# ${name}\n`, "utf8");
    await this.openFile(relativePath);
    await this.refresh();
  }

  private async importLegacyMaterial(kind: LegacyImportKind): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: kind === "practice" ? "Import legacy practice" : "Import theory material"
    });
    const source = selection?.[0]?.fsPath;
    if (!source) return;

    const importsRoot = resolveInside(this.root, path.join("imports", kind));
    await fs.mkdir(importsRoot, { recursive: true });
    const destination = await this.nextAvailableImportPath(
      importsRoot,
      path.basename(source)
    );
    await fs.copyFile(source, destination);
    const relativeDestination = path.relative(this.root, destination);
    void vscode.window.showInformationMessage(
      `Imported ${path.basename(source)} to ${relativeDestination}`
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

  private async addNextTask(): Promise<void> {
    const status = await this.statusService.inspect(this.root);
    if (!status.manifest) {
      throw new Error("Fix manifest.json before adding a task");
    }
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
    const target = resolveInside(this.root, relativePath);
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
    await this.projects.save(this.root, status.manifest);
    await this.openFile(relativePath);
    await this.refresh();
  }

  private async registerTask(relativePath: string): Promise<void> {
    const status = await this.statusService.inspect(this.root);
    if (!status.manifest) {
      throw new Error("Fix manifest.json before registering a task");
    }
    const discovered = status.discoveredTasks.find(
      (task) => task.file === relativePath
    );
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
    await this.projects.save(this.root, status.manifest);
    await this.refresh();
  }

  private async export(): Promise<void> {
    const status = await this.statusService.inspect(this.root);
    if (!status.validation?.valid) {
      throw new Error("Fix validation errors before exporting");
    }
    const destination = await vscode.window.showSaveDialog({
      filters: { "ZIP archive": ["zip"] },
      defaultUri: vscode.Uri.file(
        path.join(path.dirname(this.root), `${status.manifest?.id ?? "activity"}.zip`)
      )
    });
    if (!destination) return;
    await this.packages.export(this.root, destination.fsPath, true);
    void vscode.window.showInformationMessage(
      `Activity exported to ${destination.fsPath}`
    );
    await this.refresh();
  }

  private dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
