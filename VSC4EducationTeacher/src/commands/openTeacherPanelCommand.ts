import * as vscode from "vscode";
import { TeacherPanel } from "../webview/TeacherPanel";

async function selectWorkspaceRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }
  if (folders.length > 1) {
    const selected = await vscode.window.showWorkspaceFolderPick({
      placeHolder: "Select the project that contains the learning activity"
    });
    return selected?.uri.fsPath;
  }
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Open project"
  });
  if (!selected?.[0]) return undefined;
  const choice = await vscode.window.showInformationMessage(
    "Open this folder as the VS Code project before using the Teacher Panel.",
    "Open Folder"
  );
  if (choice === "Open Folder") {
    await vscode.commands.executeCommand("vscode.openFolder", selected[0]);
  }
  return undefined;
}

export function openTeacherPanelCommand(): () => Promise<void> {
  return async () => {
    const root = await selectWorkspaceRoot();
    if (root) await TeacherPanel.show(root);
  };
}
