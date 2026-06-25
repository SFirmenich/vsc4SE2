import * as vscode from "vscode";
import { SubmissionImportService } from "../services/SubmissionImportService";
import { SubmissionReviewPanel } from "../webview/SubmissionReviewPanel";

export function importSubmissionCommand(
  context: vscode.ExtensionContext,
  importer = new SubmissionImportService()
): () => Promise<void> {
  return async () => {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "ZIP archive": ["zip"] },
      openLabel: "Import submission"
    });
    if (!selected?.[0]) return;
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const submission = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Importing student submission",
        cancellable: false
      },
      () =>
        importer.import(selected[0].fsPath, context.globalStorageUri.fsPath)
    );
    await context.workspaceState.update("activeSubmission", submission);
    await SubmissionReviewPanel.show(
      submission,
      context.globalStorageUri.fsPath,
      context.extensionUri
    );
  };
}
