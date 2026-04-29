import { randomUUID } from 'node:crypto';

import type {
  ProcessHandle,
  ProcessObserver,
  ProcessRegistration,
} from '@steipete/summarize-core/processes';

type ProcessStatus = 'running' | 'exited' | 'error';

interface OutputLine { stream: 'stdout' | 'stderr'; line: string }

interface ProcessRecord {
  id: string;
  command: string;
  args: string[];
  label: string | null;
  kind: string | null;
  runId: string | null;
  source: string | null;
  pid: number | null;
  status: ProcessStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  progressPercent: number | null;
  progressDetail: string | null;
  statusText: string | null;
  lastLine: string | null;
  stdout: string[];
  stderr: string[];
  merged: OutputLine[];
  truncated: boolean;
}

interface ProcessListItem {
  id: string;
  label: string | null;
  kind: string | null;
  command: string;
  args: string[];
  runId: string | null;
  source: string | null;
  pid: number | null;
  status: ProcessStatus;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  elapsedMs: number;
  progressPercent: number | null;
  progressDetail: string | null;
  statusText: string | null;
  lastLine: string | null;
}

interface ProcessLogResult { ok: true; id: string; lines: OutputLine[]; truncated: boolean }

interface ProcessListResult { ok: true; nowMs: number; processes: ProcessListItem[] }

interface RegistryOptions {
  maxRecords?: number;
  maxLines?: number;
  maxLineLength?: number;
  retentionMs?: number;
}

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_MAX_LINES = 400;
const DEFAULT_MAX_LINE_LENGTH = 2000;
const DEFAULT_RETENTION_MS = 30 * 60_000;

export class ProcessRegistry {
  private readonly maxRecords: number;
  private readonly maxLines: number;
  private readonly maxLineLength: number;
  private readonly retentionMs: number;
  private readonly records = new Map<string, ProcessRecord>();
  private readonly order: string[] = [];

  constructor(options: RegistryOptions = {}) {
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  }

  createObserver(): ProcessObserver {
    return { register: (info) => this.register(info) };
  }

  list(opts?: { includeCompleted?: boolean; limit?: number }): ProcessListResult {
    const includeCompleted = Boolean(opts?.includeCompleted);
    const limit = clampNumber(opts?.limit ?? this.maxRecords, 10, this.maxRecords);
    this.prune();
    const now = Date.now();
    const items: ProcessListItem[] = [];
    for (let i = this.order.length - 1; i >= 0; i -= 1) {
      const id = this.order[i];
      const record = this.records.get(id);
      if (!record) {continue;}
      if (!includeCompleted && record.status !== 'running') {continue;}
      items.push({
        args: record.args,
        command: record.command,
        elapsedMs: Math.max(0, (record.endedAt ?? now) - record.startedAt),
        endedAt: record.endedAt,
        error: record.error,
        exitCode: record.exitCode,
        id: record.id,
        kind: record.kind,
        label: record.label,
        lastLine: record.lastLine,
        pid: record.pid,
        progressDetail: record.progressDetail,
        progressPercent: record.progressPercent,
        runId: record.runId,
        signal: record.signal,
        source: record.source,
        startedAt: record.startedAt,
        status: record.status,
        statusText: record.statusText,
      });
      if (items.length >= limit) {break;}
    }
    return { nowMs: now, ok: true, processes: items };
  }

  getLogs(
    id: string,
    opts?: { tail?: number; stream?: 'stdout' | 'stderr' | 'merged' },
  ): ProcessLogResult | null {
    const record = this.records.get(id);
    if (!record) {return null;}
    const tail = clampNumber(opts?.tail ?? 200, 20, this.maxLines);
    const stream = opts?.stream ?? 'merged';
    const lines =
      stream === 'stdout'
        ? record.stdout.slice(-tail).map((line) => ({ line, stream: 'stdout' as const }))
        : (stream === 'stderr'
          ? record.stderr.slice(-tail).map((line) => ({ stream: 'stderr' as const, line }))
          : record.merged.slice(-tail));
    return { id: record.id, lines, ok: true, truncated: record.truncated };
  }

  private register(info: ProcessRegistration): ProcessHandle {
    const id = randomUUID();
    const record: ProcessRecord = {
      args: info.args ?? [],
      command: info.command,
      endedAt: null,
      error: null,
      exitCode: null,
      id,
      kind: info.kind ?? null,
      label: info.label ?? null,
      lastLine: null,
      merged: [],
      pid: null,
      progressDetail: null,
      progressPercent: null,
      runId: info.runId ?? null,
      signal: null,
      source: info.source ?? null,
      startedAt: Date.now(),
      status: 'running',
      statusText: null,
      stderr: [],
      stdout: [],
      truncated: false,
    };
    this.records.set(id, record);
    this.order.push(id);
    this.prune();

    const finishOnce = (result: {
      exitCode: number | null;
      signal: string | null;
      error?: string | null;
    }) => {
      if (record.status !== 'running') {return;}
      record.exitCode = result.exitCode ?? null;
      record.signal = result.signal ?? null;
      record.error = result.error ?? null;
      record.endedAt = Date.now();
      const hasFailure =
        Boolean(result.error) ||
        (typeof result.exitCode === 'number' && result.exitCode !== 0) ||
        result.signal != null;
      record.status = hasFailure ? 'error' : 'exited';
    };

    return {
      appendOutput: (stream, line) => {
        const cleaned = normalizeLine(line, this.maxLineLength);
        if (!cleaned) return;
        record.lastLine = cleaned;
        const entry: OutputLine = { stream, line: cleaned };
        record.merged.push(entry);
        if (record.merged.length > this.maxLines) {
          record.merged.shift();
          record.truncated = true;
        }
        const target = stream === 'stdout' ? record.stdout : record.stderr;
        target.push(cleaned);
        if (target.length > this.maxLines) {
          target.shift();
          record.truncated = true;
        }
        const pct = parsePercent(cleaned);
        if (pct != null) {
          record.progressPercent = pct;
        }
      },
      finish: (result) => {
        finishOnce(result);
      },
      id,
      setPid: (pid) => {
        record.pid = pid ?? null;
      },
      setProgress: (progress, detail) => {
        record.progressPercent =
          typeof progress === 'number' && Number.isFinite(progress)
            ? Math.max(0, Math.min(100, Math.round(progress)))
            : null;
        record.progressDetail = detail ?? null;
      },
      setStatus: (text) => {
        record.statusText = text?.trim() ? text.trim() : null;
      },
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const id of this.order) {
      const record = this.records.get(id);
      if (!record) {continue;}
      if (record.status === 'running') {continue;}
      if (record.endedAt && now - record.endedAt > this.retentionMs) {
        this.records.delete(id);
      }
    }
    while (this.order.length > this.maxRecords) {
      const id = this.order.shift();
      if (id) {this.records.delete(id);}
    }
  }
}

export function buildProcessListResult(
  registry: ProcessRegistry,
  opts?: { includeCompleted?: boolean; limit?: number },
): ProcessListResult {
  return registry.list(opts);
}

export function buildProcessLogsResult(
  registry: ProcessRegistry,
  id: string,
  opts?: { tail?: number; stream?: 'stdout' | 'stderr' | 'merged' },
): ProcessLogResult | null {
  return registry.getLogs(id, opts);
}

function normalizeLine(line: string, maxLength: number): string {
  const trimmed = line.trim();
  if (!trimmed) {return '';}
  if (trimmed.length <= maxLength) {return trimmed;}
  return `${trimmed.slice(0, maxLength)}…`;
}

function parsePercent(line: string): number | null {
  const match = /(\d{1,3})(?:\.\d+)?%/.exec(line);
  if (!match) {return null;}
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {return null;}
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {return min;}
  return Math.max(min, Math.min(max, Math.round(value)));
}
