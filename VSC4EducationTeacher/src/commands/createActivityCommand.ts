import * as vscode from "vscode";
import * as path from "path";
import { ActivityProjectService } from "../services/ActivityProjectService";
import { ActivityManifest } from "../types/ActivityManifest";
import { pathExists } from "../utils/fs";
import { VALID_ID } from "../utils/validation";
import { ActivityDesignerPanel } from "../webview/ActivityDesignerPanel";

interface InputOptions {
  title: string;
  prompt: string;
  value?: string;
  step: number;
  totalSteps: number;
  validate?: (value: string) => string | undefined;
}

async function input(
  options: InputOptions
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: `${options.title} (${options.step}/${options.totalSteps})`,
    prompt: options.prompt,
    value: options.value ?? "",
    ignoreFocusOut: true,
    validateInput: options.validate
  });
}

async function waitForWindowFocus(timeoutMs = 2000): Promise<void> {
  if (vscode.window.state.focused) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      listener.dispose();
      resolve();
    }, timeoutMs);
    const listener = vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        clearTimeout(timeout);
        listener.dispose();
        resolve();
      }
    });
  });
}

export function createActivityCommand(
  context: vscode.ExtensionContext,
  projects = new ActivityProjectService()
): () => Promise<void> {
  return async () => {
    const folder = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Select activity parent directory"
    });
    if (!folder?.[0]) {
      return;
    }
    await waitForWindowFocus();

    const wizardTitle = "Create Learning Activity";
    const totalSteps = 5;
    const id = await input({
      title: wizardTitle,
      prompt: `Activity identifier. Parent folder: ${folder[0].fsPath}`,
      step: 1,
      totalSteps,
      validate: (value) =>
        VALID_ID.test(value.trim())
          ? undefined
          : "Use only letters, numbers, dots, hyphens, and underscores"
    });
    if (!id) {
      void vscode.window.showInformationMessage("Activity creation cancelled");
      return;
    }

    const activityRoot = path.join(folder[0].fsPath, id.trim());
    if (await pathExists(activityRoot)) {
      const choice = await vscode.window.showWarningMessage(
        `The folder "${activityRoot}" already exists.`,
        { modal: true },
        "Use existing folder"
      );
      if (choice !== "Use existing folder") {
        return;
      }
    }

    const title = await input({
      title: wizardTitle,
      prompt: "Activity title",
      step: 2,
      totalSteps,
      validate: (value) => (value.trim() ? undefined : "Title is required")
    });
    if (!title) return;
    const description = await input({
      title: wizardTitle,
      prompt: "Activity description",
      step: 3,
      totalSteps
    });
    if (description === undefined) return;
    const version = await input({
      title: wizardTitle,
      prompt: "Activity version",
      value: "1.0.0",
      step: 4,
      totalSteps,
      validate: (value) => (value.trim() ? undefined : "Version is required")
    });
    if (!version) return;
    const type = await vscode.window.showQuickPick(
      [
        { label: "Exercise", value: "exercise" as const },
        { label: "Project", value: "project" as const }
      ],
      {
      title: `${wizardTitle} (5/${totalSteps})`,
      placeHolder: "Activity type",
      ignoreFocusOut: true
      }
    );
    if (!type) return;
    const firstTaskId = "task-01";
    const manifest: ActivityManifest = {
      id: id.trim(),
      title: title.trim(),
      description,
      version: version.trim(),
      type: type.value,
      tasks: [
        {
          id: firstTaskId,
          title: "First task",
          description: "",
          file: `tasks/${firstTaskId}.md`,
          dependencies: [],
          acceptanceCriteria: [],
          expectedEvidence: ["source_changes", "task_events", "git_commits"]
        }
      ]
    };
    const root = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating activity "${manifest.title}"`,
        cancellable: false
      },
      async () => {
        const createdRoot = await projects.create(folder[0].fsPath, manifest);
        await projects.save(createdRoot, manifest);
        await vscode.workspace.fs.writeFile(
          vscode.Uri.joinPath(
            vscode.Uri.file(createdRoot),
            "tasks",
            `${firstTaskId}.md`
          ),
          Buffer.from("# First task\n", "utf8")
        );
        return createdRoot;
      }
    );
    await context.workspaceState.update("activeActivityRoot", root);
    await ActivityDesignerPanel.show(root);
    void vscode.window.showInformationMessage(
      `Activity created at ${root}`
    );
  };
}
