import * as vscode from "vscode";
import { t } from "../i18n";
import { SubmissionImportService } from "../services/SubmissionImportService";
import { SubmissionReviewPanel } from "../webview/SubmissionReviewPanel";

function normalizeFsPath(uri: vscode.Uri): string {
  return uri.fsPath.replace(/\\/g, "/").toLowerCase();
}

function addProjectToWorkspace(projectPath: string): void {
  const projectUri = vscode.Uri.file(projectPath);
  const folders = vscode.workspace.workspaceFolders ?? [];
  const alreadyOpen = folders.some(
    (folder) => normalizeFsPath(folder.uri) === normalizeFsPath(projectUri)
  );
  if (alreadyOpen) {
    return;
  }
  vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
    uri: projectUri,
    name: t("Imported Submission")
  });
}

export function importSubmissionCommand(
  context: vscode.ExtensionContext,
  importer = new SubmissionImportService()
): () => Promise<void> {
  return async () => {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { [t("ZIP archive")]: ["zip"] },
      openLabel: t("Import submission")
    });
    if (!selected?.[0]) return;
    const destination = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: t("Extract submission here"),
      title: t("Select a folder for the imported submission")
    });
    if (!destination?.[0]) return;
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const submission = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("Importing student submission"),
        cancellable: false
      },
      () =>
        importer.importToDirectory(selected[0].fsPath, destination[0].fsPath)
    );
    await context.workspaceState.update("activeSubmission", submission);
    await SubmissionReviewPanel.show(
      submission,
      context.globalStorageUri.fsPath,
      context.extensionUri
    );
    addProjectToWorkspace(submission.projectPath);
    void vscode.window.showInformationMessage(
      t("Submission imported and added to the current workspace for inspection.")
    );
  };
}
