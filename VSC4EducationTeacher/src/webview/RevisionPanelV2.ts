import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { AgencyMetricsService } from "../services/AgencyMetricsService";
import { AgencyMetricsServiceV2 } from "../services/AgencyMetricsServiceV2";
import { ActivityStatusService } from "../services/ActivityStatusService";
import { EvidenceCryptoService } from "../services/EvidenceCryptoService";
import { ExternalIntegrityService } from "../services/ExternalIntegrityService";
import { FeedbackService } from "../services/FeedbackService";
import { GitReviewService } from "../services/GitReviewService";
import { IntegrityService } from "../services/IntegrityService";
import { ReviewWorkspaceService } from "../services/ReviewWorkspaceService";
import { SubmissionReviewService } from "../services/SubmissionReviewService";
import { SubmissionFeedback } from "../types/Feedback";
import { Rubric } from "../types/Rubric";
import { pathExists, readJson } from "../utils/fs";
import {
  RevisionPanelV2Model,
  revisionPanelV2Html
} from "./revisionPanelV2Html";
import { SubmissionReviewModel } from "./submissionReviewHtml";

type UtilityPromptId =
  | "reviewAgainstRubrics"
  | "draftFeedback"
  | "analyzeProcessEvidence"
  | "inspectAgentUse"
  | "integrityAndReceipts"
  | "compareWithReferenceSolution"
  | "followUpQuestions";

export class RevisionPanelV2 {
  private static current: RevisionPanelV2 | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private reviewRoot: string | undefined;
  private selectedSubmissionRoot: string | undefined;

  static async show(context: vscode.ExtensionContext): Promise<void> {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One);
      await this.current.refresh(true);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "learningActivityTeacherRevisionV2",
      "Revision Mode V2",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
      }
    );
    const instance = new RevisionPanelV2(
      panel,
      context.extensionUri,
      context.globalStorageUri.fsPath
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
      "learningActivityTeacherRevisionV2",
      {
        deserializeWebviewPanel: async (panel) => {
          panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [context.extensionUri]
          };
          const instance = new RevisionPanelV2(
            panel,
            context.extensionUri,
            context.globalStorageUri.fsPath
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
    private readonly storageRoot: string,
    private readonly statusService = new ActivityStatusService(),
    private readonly reviewWorkspaces = new ReviewWorkspaceService(),
    private readonly review = new SubmissionReviewService(),
    private readonly integrity = new IntegrityService(),
    private readonly externalIntegrity = new ExternalIntegrityService(),
    private readonly agencyMetrics = new AgencyMetricsService(),
    private readonly agencyMetricsV2 = new AgencyMetricsServiceV2(),
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
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.hydrateRoot().then(() => this.scheduleRefresh());
      })
    );
  }

  private contains(target: string): boolean {
    if (!this.reviewRoot) return false;
    const relative = path.relative(this.reviewRoot, target);
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
      this.panel.webview.html = revisionPanelV2Html(
        this.panel.webview,
        this.extensionUri,
        model
      );
    } else {
      await this.panel.webview.postMessage({ type: "model", model });
      await this.panel.webview.postMessage({ type: "ready" });
    }
  }

  private async model(): Promise<RevisionPanelV2Model> {
    if (!this.reviewRoot) return {};
    const status = await this.reviewWorkspaces.status(this.reviewRoot);
    const activity = status.activityImported
      ? await this.statusService.inspect(status.activityRoot)
      : undefined;
    const selected =
      this.selectedSubmissionRoot &&
      status.submissions.some((item) => item.rootPath === this.selectedSubmissionRoot)
        ? this.selectedSubmissionRoot
        : status.submissions[0]?.rootPath;
    this.selectedSubmissionRoot = selected;
    return {
      reviewRoot: this.reviewRoot,
      status,
      activity,
      selectedSubmissionRoot: selected,
      reviewModel: selected ? await this.submissionModel(selected) : undefined
    };
  }

  private async submissionModel(
    submissionRoot: string
  ): Promise<SubmissionReviewModel | undefined> {
    const submission = await this.reviewWorkspaces.readSubmission(submissionRoot);
    const integrity: Record<string, unknown> = {};
    const externalIntegrity: Record<string, unknown> = {};
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
      externalIntegrity[contribution.studentId] = this.externalIntegrity.verify(
        contribution.events,
        submission.manifest
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
      agencyMetricsV2: submission.contributions.map((item) =>
        this.agencyMetricsV2.calculate(item, submission.manifest)
      ),
      integrity,
      externalIntegrity,
      commits
    };
  }

  private async handle(message: {
    type: string;
    submissionRoot?: string;
    commit?: string;
    feedback?: SubmissionFeedback;
    promptId?: UtilityPromptId;
    message?: string;
  }): Promise<void> {
    try {
      switch (message.type) {
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
            await this.panel.webview.postMessage({ type: "ready" });
          }
          break;
        case "exportFeedback":
          await this.exportFeedback();
          break;
        case "copyUtilityPrompt":
          if (message.promptId) await this.copyUtilityPrompt(message.promptId);
          break;
        case "refresh":
          await this.refresh();
          break;
        case "error":
          void vscode.window.showInformationMessage(message.message ?? "Message");
          await this.panel.webview.postMessage({ type: "ready" });
          break;
      }
    } catch (error) {
      await this.panel.webview.postMessage({ type: "ready" });
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async createReviewWorkspace(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Create review workspace",
      title: "Select a folder for the review workspace"
    });
    if (!selected?.[0]) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
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
    if (!selected?.[0]) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    this.reviewRoot = selected[0].fsPath;
    this.selectedSubmissionRoot = undefined;
    this.addFolderToWorkspace(this.reviewRoot, "Submission Review");
    await this.refresh();
  }

  private async useCurrentReviewWorkspace(): Promise<void> {
    const root = await this.currentWorkspaceRoot(
      "Select the current workspace folder to use as the review workspace"
    );
    if (!root) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    this.reviewRoot = root;
    this.selectedSubmissionRoot = undefined;
    await this.reviewWorkspaces.initialize(root);
    await this.refresh();
  }

  private async importReviewActivity(): Promise<void> {
    const root = this.requireReviewRoot();
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "ZIP archive": ["zip"] },
      openLabel: "Import teacher activity package"
    });
    if (!selected?.[0]) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    await this.reviewWorkspaces.importActivityPackage(selected[0].fsPath, root);
    await this.refresh();
  }

  private async importReviewSubmission(): Promise<void> {
    const root = this.requireReviewRoot();
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "ZIP archive": ["zip"] },
      openLabel: "Import student submission"
    });
    if (!selected?.[0]) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
    const submission = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Importing student submission",
        cancellable: false
      },
      () => this.reviewWorkspaces.importSubmissionPackage(selected[0].fsPath, root)
    );
    this.selectedSubmissionRoot = submission.rootPath;
    this.addFolderToWorkspace(submission.projectPath, "Imported Submission");
    await this.refresh();
  }

  private async exportFeedback(): Promise<void> {
    if (!this.selectedSubmissionRoot) {
      await this.panel.webview.postMessage({ type: "ready" });
      return;
    }
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
    await this.panel.webview.postMessage({ type: "ready" });
  }

  private async copyUtilityPrompt(promptId: UtilityPromptId): Promise<void> {
    await vscode.env.clipboard.writeText(await this.utilityPrompt(promptId));
    void vscode.window.showInformationMessage("Review prompt copied to clipboard");
    await this.panel.webview.postMessage({ type: "ready" });
  }

  private async utilityPrompt(promptId: UtilityPromptId): Promise<string> {
    const root = this.requireReviewRoot();
    const model = await this.model();
    const submission = model.reviewModel?.submission;
    const studentIds = submission?.contributions.map((item) => item.studentId).join(", ") || "no selected submission";
    const baseContext = `You are helping me review a VSCode4Education student submission.

Review workspace root: ${root}
Imported activity definition: ${path.join(root, "learning-activity-definition")}
Imported submissions folder: ${path.join(root, "submissions")}
Selected submission root: ${submission?.rootPath ?? "no selected submission"}
Selected submission project files: ${submission?.projectPath ?? "no selected submission"}
Selected submission metadata: ${submission?.metadataPath ?? "no selected submission"}
Students/contributions in the selected submission: ${studentIds}

Important files and folders to inspect:
- learning-activity-definition/manifest.json contains the canonical activity id, version, tasks, expected evidence, and repository event-server settings when present.
- learning-activity-definition/tasks/ contains student-facing task statements.
- learning-activity-definition/assessment/rubrics/ contains private assessment rubrics.
- learning-activity-definition/assessment/solutions/ contains private reference solutions when available.
- submissions/<submission>/project/ contains the submitted project files.
- submissions/<submission>/submission.json describes the imported submission.
- submissions/<submission>/.vsc4education/contributions/<studentId>/ contains state.json, events.jsonl, agent-interactions.jsonl, current-task.json, and task metadata.

Ground rules:
- Treat rubrics and solutions as private teacher material.
- Use evidence as support for teacher judgement, not as an automatic grade.
- Missing optional evidence such as Git or agent logs should be reported as missing data, not as proof of misconduct.
- Do not execute student code or install dependencies unless I explicitly ask for a separate safe execution plan.
- Produce concise, actionable review output and cite the local files you used.`;

    switch (promptId) {
      case "reviewAgainstRubrics":
        return `${baseContext}

Task: review the selected submission against the activity rubrics.

Expected result:
- For each task in manifest.json, identify the relevant submitted files and evidence.
- Compare the work with the corresponding rubric and reference solution when available.
- Draft criterion-level observations with strengths, gaps, and concrete evidence.
- Do not invent scores if the rubric format does not provide enough information; explain what would need teacher judgement.`;
      case "draftFeedback":
        return `${baseContext}

Task: draft formative feedback for the selected student submission.

Expected result:
- Write feedback in a tone suitable to give to the student.
- Separate what is correct, what needs improvement, and the next practical steps.
- Tie comments to task requirements, submitted files, and process evidence where relevant.
- Avoid revealing private reference solutions, but give enough guidance for learning.`;
      case "analyzeProcessEvidence":
        return `${baseContext}

Task: analyze the student's process evidence.

Expected result:
- Summarize the work timeline from events.jsonl, task state, and Git commits when present.
- Identify task starts/completions, meaningful file changes, validation attempts, and long gaps.
- Note evidence limitations clearly.
- Highlight signals that deserve teacher attention, without treating them as proof by themselves.`;
      case "inspectAgentUse":
        return `${baseContext}

Task: inspect recorded agent interactions for pedagogical review.

Expected result:
- Summarize how the student used the agent: planning, debugging, explanation, direct answer requests, or implementation help.
- Compare agent interactions with subsequent code or task changes when evidence is available.
- Identify cases where the agent appears to support learning and cases that need follow-up questions.
- Do not make authorship accusations; frame conclusions as review signals.`;
      case "integrityAndReceipts":
        return `${baseContext}

Task: interpret local event integrity and Repository event-server receipts.

Expected result:
- Inspect contribution events, local hash-chain status, and any receipt-related event data.
- Explain whether the available evidence is internally consistent.
- Distinguish local consistency from external server receipt coverage.
- List missing, malformed, or suspicious evidence as review questions rather than final conclusions.`;
      case "compareWithReferenceSolution":
        return `${baseContext}

Task: compare the submitted implementation with private reference solutions.

Expected result:
- For each task, summarize the intended approach from assessment/solutions/ and the actual submitted approach.
- Identify functional differences, missing edge cases, design issues, and acceptable alternatives.
- Keep the comparison teacher-facing and avoid writing student-visible full solutions unless explicitly requested.`;
      case "followUpQuestions":
        return `${baseContext}

Task: prepare follow-up questions for the student.

Expected result:
- Generate short questions that test understanding of the submitted solution and the process used to create it.
- Include questions tied to specific files, commits, events, or agent interactions when possible.
- Separate conceptual questions, implementation questions, and process/evidence questions.
- Keep questions neutral and useful for learning-oriented review.`;
    }
  }

  private requireReviewRoot(): string {
    if (!this.reviewRoot) throw new Error("Open or create a review workspace first");
    return this.reviewRoot;
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
    if (this.reviewRoot) {
      const status = await this.reviewWorkspaces.status(this.reviewRoot);
      if (status.initialized) return;
      this.reviewRoot = undefined;
      this.selectedSubmissionRoot = undefined;
    }
    this.reviewRoot = await this.findReviewWorkspaceFolder();
  }

  private async findReviewWorkspaceFolder(): Promise<string | undefined> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (
        (await pathExists(this.reviewWorkspaces.activityRoot(folder.uri.fsPath))) &&
        (await pathExists(this.reviewWorkspaces.submissionsRoot(folder.uri.fsPath)))
      ) {
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
