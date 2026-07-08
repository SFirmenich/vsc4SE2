import * as vscode from "vscode";
import { exportFeedbackCommand } from "./commands/exportFeedbackCommand";
import { importSubmissionCommand } from "./commands/importSubmissionCommand";
import { openTeacherPanelCommand } from "./commands/openTeacherPanelCommand";

export function activate(context: vscode.ExtensionContext): void {
  const teacherPanel = openTeacherPanelCommand(context);
  const creationPanel = openTeacherPanelCommand(context, "activity");
  const revisionPanel = openTeacherPanelCommand(context, "review");
  const commands: Array<[string, () => Promise<void>]> = [
    ["teacherActivity.openPanel", teacherPanel],
    ["teacherActivity.openCreationMode", creationPanel],
    ["teacherActivity.openRevisionMode", revisionPanel],
    ["teacherActivity.create", creationPanel],
    ["teacherActivity.open", creationPanel],
    ["teacherActivity.validate", creationPanel],
    ["teacherActivity.export", creationPanel],
    ["teacherSubmission.import", importSubmissionCommand(context)],
    ["teacherSubmission.openReview", revisionPanel],
    ["teacherSubmission.exportFeedback", exportFeedbackCommand(context)]
  ];
  context.subscriptions.push(
    ...commands.map(([id, handler]) =>
      vscode.commands.registerCommand(id, async () => {
        try {
          await handler();
        } catch (error) {
          void vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error)
          );
        }
      })
    )
  );
}

export function deactivate(): void {}
