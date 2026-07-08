import { promises as fs } from "fs";
import * as path from "path";
import { AgentInteraction } from "../types/AgentInteraction";
import { Contribution } from "../types/Contribution";
import { LearningEvent } from "../types/LearningEvent";
import { pathExists, readJson } from "../utils/fs";
import { parseJsonLines } from "../utils/json";

const PROVIDERS = new Set(["chatGPT", "claude", "copilot"]);

export class SubmissionReviewService {
  async readContributions(metadataPath: string): Promise<Contribution[]> {
    const root = path.join(metadataPath, "contributions");
    if (!(await pathExists(root))) {
      return [];
    }
    const output: Contribution[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const directory = path.join(root, entry.name);
      const events = await this.readJsonl<LearningEvent>(
        path.join(directory, "events.jsonl")
      );
      const interactions = await this.readInteractions(
        path.join(directory, "agent-interactions.jsonl")
      );
      output.push({
        studentId: entry.name,
        profile: await this.optionalJson(path.join(directory, "profile.json")),
        state: await this.optionalJson(path.join(directory, "state.json")),
        events: events.values,
        eventParseErrors: events.invalidLines,
        agentInteractions: interactions.values,
        interactionErrors: interactions.errors
      });
    }
    return output;
  }

  async readInteractions(
    target: string
  ): Promise<{ values: AgentInteraction[]; errors: string[] }> {
    const raw = await this.readJsonl<AgentInteraction>(target);
    const values: AgentInteraction[] = [];
    const errors = raw.invalidLines.map((line) => `Invalid JSON at line ${line}`);
    let previousTimestamp = Number.NEGATIVE_INFINITY;
    raw.values.forEach((interaction, index) => {
      const timestamp = Date.parse(interaction.timestamp);
      if (
        !Number.isFinite(timestamp) ||
        !["student", "agent"].includes(interaction.actor) ||
        typeof interaction.message !== "string" ||
        (interaction.actor === "agent" &&
          (!interaction.agent || !PROVIDERS.has(interaction.agent)))
      ) {
        errors.push(`Invalid interaction at line ${index + 1}`);
        return;
      }
      if (timestamp < previousTimestamp) {
        errors.push(`Interaction order is not chronological at line ${index + 1}`);
      }
      previousTimestamp = timestamp;
      values.push(interaction);
    });
    return { values, errors };
  }

  summarize(contribution: Contribution): Record<string, unknown> {
    const eventTypes = contribution.events.map((event) => this.eventType(event));
    const files = new Set<string>();
    const touchedLines = new Set<string>();
    const touchedLinesByFile = new Map<string, Set<number>>();
    let lineTouchCount = 0;
    let fileChangeEvents = 0;
    let editBursts = 0;
    let previousEditTimestamp = Number.NEGATIVE_INFINITY;
    const activityByHour = new Map<string, number>();

    for (const event of contribution.events) {
      const file = this.eventFile(event);
      const workFile = file && this.isWorkSourceFile(file);
      if (workFile) {
        files.add(file);
      }
      const timestamp = Date.parse(String(event.timestamp ?? ""));
      if (Number.isFinite(timestamp)) {
        const hour = new Date(timestamp).toISOString().slice(11, 13);
        activityByHour.set(hour, (activityByHour.get(hour) ?? 0) + 1);
      }
      if (this.eventType(event) === "file_changed" && workFile) {
        fileChangeEvents += 1;
        if (
          Number.isFinite(timestamp) &&
          timestamp - previousEditTimestamp > 2 * 60 * 1000
        ) {
          editBursts += 1;
        }
        previousEditTimestamp = timestamp;
      }
      const lineRanges = this.eventLineRanges(event);
      if (!workFile) {
        continue;
      }
      for (const range of lineRanges) {
        const start = Math.min(range.start, range.end);
        const end = Math.max(range.start, range.end);
        lineTouchCount += end - start + 1;
        if (file) {
          const fileLines = touchedLinesByFile.get(file) ?? new Set<number>();
          for (let line = start; line <= end; line += 1) {
            touchedLines.add(`${file}:${line}`);
            fileLines.add(line);
          }
          touchedLinesByFile.set(file, fileLines);
        }
      }
    }
    const timestamps = contribution.events
      .map((event) => Date.parse(String(event.timestamp ?? "")))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let heartbeatGaps = 0;
    let idleMilliseconds = 0;
    for (let index = 1; index < timestamps.length; index += 1) {
      const gap = timestamps[index] - timestamps[index - 1];
      if (gap > 15 * 60 * 1000) {
        heartbeatGaps += 1;
        idleMilliseconds += gap;
      }
    }
    const elapsedMilliseconds =
      timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;
    const activeMilliseconds = Math.max(0, elapsedMilliseconds - idleMilliseconds);
    const studentMessages = contribution.agentInteractions.filter(
      (interaction) => interaction.actor === "student"
    ).length;
    const agentMessages = contribution.agentInteractions.filter(
      (interaction) => interaction.actor === "agent"
    ).length;
    const sourceFiles = Array.from(files);
    const completedTasks = this.completedTaskCount(contribution.events);
    const agencySignals = this.agencySignals({
      tasksStarted: eventTypes.filter((type) => type === "task_started").length,
      tasksCompleted: completedTasks,
      fileChangeEvents,
      filesModified: sourceFiles.length || files.size,
      uniqueLinesTouched: touchedLines.size,
      activeMinutes: Math.round(activeMilliseconds / 60000),
      heartbeatGaps,
      studentMessages,
      agentMessages
    });
    return {
      studentId: contribution.studentId,
      tasksStarted: eventTypes.filter((type) => type === "task_started").length,
      tasksCompleted: completedTasks,
      saves: eventTypes.filter((type) => type === "file_saved").length,
      commits: eventTypes.filter((type) => type === "git_commit").length,
      filesModified: files.size,
      sourceFilesModified: sourceFiles.length,
      lineTouchCount,
      uniqueLinesTouched: touchedLines.size,
      fileChangeEvents,
      editBursts,
      activeMinutes: Math.round(activeMilliseconds / 60000),
      heartbeatGaps,
      agentInteractions: contribution.agentInteractions.length,
      studentAgentMessages: studentMessages,
      agentResponses: agentMessages,
      activityByHour: Array.from(activityByHour.entries()).map(([hour, count]) => ({
        hour,
        count
      })),
      linesByFile: Array.from(touchedLinesByFile.entries()).map(
        ([file, lines]) => ({
          file,
          lines: lines.size
        })
      ),
      agency: agencySignals
    };
  }

  private eventType(event: LearningEvent): string | undefined {
    return typeof event.type === "string"
      ? event.type
      : typeof event.event === "string"
        ? event.event
        : undefined;
  }

  private completedTaskCount(events: LearningEvent[]): number {
    const completedTaskIds = new Set<string>();
    let eventsWithoutTaskId = 0;
    for (const event of events) {
      const type = this.eventType(event);
      if (type !== "task_finished" && type !== "task_completed") {
        continue;
      }
      if (typeof event.taskId === "string" && event.taskId) {
        completedTaskIds.add(event.taskId);
      } else {
        eventsWithoutTaskId += 1;
      }
    }
    return completedTaskIds.size + eventsWithoutTaskId;
  }

  private eventFile(event: LearningEvent): string | undefined {
    if (typeof event.file === "string") {
      return this.normalizePath(event.file);
    }
    return typeof event.data?.file === "string"
      ? this.normalizePath(event.data.file)
      : undefined;
  }

  private isWorkSourceFile(file: string): boolean {
    return this.normalizePath(file).startsWith("src/");
  }

  private normalizePath(file: string): string {
    return file.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  private eventLineRanges(event: LearningEvent): { start: number; end: number }[] {
    const lines = event.data?.lines;
    if (!Array.isArray(lines)) {
      return [];
    }
    return lines.filter(
      (line): line is { start: number; end: number } =>
        typeof line === "object" &&
        line !== null &&
        typeof (line as { start?: unknown }).start === "number" &&
        typeof (line as { end?: unknown }).end === "number"
    );
  }

  private agencySignals(input: {
    tasksStarted: number;
    tasksCompleted: number;
    fileChangeEvents: number;
    filesModified: number;
    uniqueLinesTouched: number;
    activeMinutes: number;
    heartbeatGaps: number;
    studentMessages: number;
    agentMessages: number;
  }): Record<string, unknown> {
    const positives: string[] = [];
    const concerns: string[] = [];
    let score = 0;

    if (input.tasksStarted > 0) {
      score += 1;
      positives.push("Inicio de tarea registrado");
    }
    if (input.fileChangeEvents >= 3 || input.uniqueLinesTouched >= 5) {
      score += 2;
      positives.push("Hay ediciones sostenidas en archivos de trabajo");
    } else if (input.fileChangeEvents > 0) {
      score += 1;
      positives.push("Hay cambios propios registrados");
    } else {
      concerns.push("No se registran cambios de archivo suficientes");
    }
    if (input.filesModified > 1) {
      score += 1;
      positives.push("Trabajo distribuido en mas de un archivo");
    }
    if (input.activeMinutes >= 10) {
      score += 1;
      positives.push("Sesion de trabajo con duracion observable");
    }
    if (input.tasksCompleted > 0) {
      score += 1;
      positives.push("Cierre de tarea registrado");
    }
    if (input.studentMessages > 0 && input.agentMessages > 0) {
      score += 1;
      positives.push("Uso dialogado del agente");
    }
    if (input.agentMessages > input.studentMessages * 3 && input.fileChangeEvents < 3) {
      concerns.push("Mucha respuesta del agente con poca edicion posterior");
      score -= 1;
    }
    if (input.heartbeatGaps > 0) {
      concerns.push("Hay pausas largas entre eventos; revisar continuidad");
    }

    return {
      score: Math.max(0, Math.min(6, score)),
      level: score >= 5 ? "alta" : score >= 3 ? "media" : "baja",
      positives,
      concerns
    };
  }

  private async readJsonl<T>(
    target: string
  ): Promise<{ values: T[]; invalidLines: number[] }> {
    if (!(await pathExists(target))) {
      return { values: [], invalidLines: [] };
    }
    return parseJsonLines<T>(await fs.readFile(target, "utf8"));
  }

  private async optionalJson(
    target: string
  ): Promise<Record<string, unknown> | undefined> {
    return (await pathExists(target))
      ? readJson<Record<string, unknown>>(target)
      : undefined;
  }
}
