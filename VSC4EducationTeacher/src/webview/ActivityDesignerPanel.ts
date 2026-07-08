import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ActivityManifest } from "../types/ActivityManifest";
import { Rubric } from "../types/Rubric";
import { ActivityPackageService } from "../services/ActivityPackageService";
import { ActivityProjectService } from "../services/ActivityProjectService";
import { ActivityValidationService } from "../services/ActivityValidationService";
import { pathExists, readJson, writeJson } from "../utils/fs";
import {
  ActivityDesignerModel,
  activityDesignerHtml
} from "./activityDesignerHtml";

export class ActivityDesignerPanel {
  private static current: ActivityDesignerPanel | undefined;

  static async show(root: string): Promise<void> {
    if (this.current) {
      this.current.root = root;
      this.current.panel.reveal(vscode.ViewColumn.One);
      await this.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "learningActivityTeacherDesigner",
      "Learning Activity Designer",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.current = new ActivityDesignerPanel(panel, root);
    panel.onDidDispose(() => {
      this.current = undefined;
    });
    await this.current.refresh();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private root: string,
    private readonly projects = new ActivityProjectService(),
    private readonly validation = new ActivityValidationService(),
    private readonly packages = new ActivityPackageService()
  ) {
    panel.webview.onDidReceiveMessage((message) => this.handle(message));
  }

  private async model(): Promise<ActivityDesignerModel> {
    const rubricPath = path.join(this.root, "rubrics", "main.json");
    return {
      root: this.root,
      manifest: await this.projects.load(this.root),
      rubric: (await pathExists(rubricPath))
        ? await readJson<Rubric>(rubricPath)
        : undefined,
      instructions: await fs.readFile(
        path.join(this.root, "agent", "instructions.md"),
        "utf8"
      )
    };
  }

  private async refresh(validation?: unknown): Promise<void> {
    const model = { ...(await this.model()), validation };
    this.panel.webview.html = activityDesignerHtml(this.panel.webview, model);
  }

  private async sendModel(validation?: unknown): Promise<void> {
    await this.panel.webview.postMessage({
      type: "model",
      model: { ...(await this.model()), validation }
    });
  }

  private async handle(message: {
    type: string;
    manifest?: ActivityManifest;
    content?: string;
    rubric?: Rubric;
    path?: string;
    message?: string;
  }): Promise<void> {
    try {
      switch (message.type) {
        case "saveManifest":
          if (!message.manifest) {
            throw new Error("Manifest payload is missing");
          }
          await this.projects.save(this.root, message.manifest);
          await this.ensureTaskFiles(message.manifest);
          await this.projects.ensureAssessmentFiles(this.root, message.manifest);
          await this.sendModel();
          break;
        case "saveInstructions":
          await fs.writeFile(
            path.join(this.root, "agent", "instructions.md"),
            message.content ?? "",
            "utf8"
          );
          void vscode.window.showInformationMessage("Agent instructions saved");
          break;
        case "saveRubric":
          await writeJson(
            path.join(this.root, "rubrics", "main.json"),
            message.rubric
          );
          await this.sendModel();
          break;
        case "validate": {
          const result = await this.validation.validate(this.root);
          await this.sendModel(result);
          break;
        }
        case "export":
          await this.export();
          break;
        case "revealPath":
          if (message.path) {
            await vscode.commands.executeCommand(
              "revealFileInOS",
              vscode.Uri.file(path.join(this.root, message.path))
            );
          }
          break;
        case "showError":
          void vscode.window.showErrorMessage(message.message ?? "Invalid input");
          break;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async ensureTaskFiles(manifest: ActivityManifest): Promise<void> {
    for (const task of manifest.tasks) {
      if (!task.file || !task.file.replace(/\\/g, "/").startsWith("tasks/")) {
        continue;
      }
      const target = path.join(this.root, task.file);
      if (!(await pathExists(target))) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `# ${task.title}\n\n${task.description ?? ""}\n`);
      }
    }
  }

  private async export(): Promise<void> {
    const destination = await vscode.window.showSaveDialog({
      filters: { "ZIP archive": ["zip"] },
      defaultUri: vscode.Uri.file(
        path.join(path.dirname(this.root), `${path.basename(this.root)}.zip`)
      )
    });
    if (!destination) {
      return;
    }
    await this.packages.export(this.root, destination.fsPath, true);
    void vscode.window.showInformationMessage(
      `Activity package exported to ${destination.fsPath}`
    );
  }
}
