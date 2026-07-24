import * as vscode from "vscode";
import { exportFeedbackCommand } from "./commands/exportFeedbackCommand";
import { importSubmissionCommand } from "./commands/importSubmissionCommand";
import { openTeacherPanelCommand } from "./commands/openTeacherPanelCommand";
import { CreationPanelV2 } from "./webview/CreationPanelV2";
import { RevisionPanelV2 } from "./webview/RevisionPanelV2";
import { TeacherPanel } from "./webview/TeacherPanel";

export function activate(context: vscode.ExtensionContext): void {
  const teacherPanel = openTeacherPanelCommand(context);
  const creationPanel = openTeacherPanelCommand(context, "activity");
  const creationPanelV2 = async () => CreationPanelV2.show(context);
  const revisionPanel = openTeacherPanelCommand(context, "review");
  const revisionPanelV2 = async () => RevisionPanelV2.show(context);
  const commands: Array<[string, () => Promise<void>]> = [
    ["teacherActivity.openPanel", teacherPanel],
    ["teacherActivity.openCreationMode", creationPanel],
    ["teacherActivity.openCreationModeV2", creationPanelV2],
    ["teacherActivity.openRevisionMode", revisionPanel],
    ["teacherActivity.openRevisionModeV2", revisionPanelV2],
    ["teacherActivity.create", creationPanel],
    ["teacherActivity.open", creationPanel],
    ["teacherActivity.validate", creationPanel],
    ["teacherActivity.export", creationPanel],
    ["teacherSubmission.import", importSubmissionCommand(context)],
    ["teacherSubmission.openReview", revisionPanel],
    ["teacherSubmission.exportFeedback", exportFeedbackCommand(context)]
  ];
  context.subscriptions.push(
    ...TeacherPanel.registerSerializers(context),
    CreationPanelV2.registerSerializer(context),
    RevisionPanelV2.registerSerializer(context),
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
