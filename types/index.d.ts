export type ContextKind = 'clickup' | 'chat' | 'go' | 'mr' | 'report'

export type ClickUpStatus = { name: string; color: string }

export type ContextItem = {
  kind: ContextKind
  /** Dedup key within its kind: task id, space/thread, env:GO path, project!iid, or report id. */
  ref: string
  url: string
  /** Resolved name; absent until looked up (or when the lookup failed). */
  title?: string
  /** A second, dim line: assignees, MR state and pipeline. */
  meta?: string
  /** ClickUp: the task's real id (a custom id like TK-123 resolves to it). */
  taskId?: string
  /** ClickUp: current status and the statuses its list allows. */
  status?: ClickUpStatus
  statuses?: ClickUpStatus[]
  /** ClickUp: found in the current git branch name. */
  fromBranch?: boolean
  /** MR: target branch; only MRs to main are announced in IT MR's. */
  targetBranch?: string
}

declare module 'claude-code' {
  interface PluginState {
    'vtt-context': { entries: ContextItem[]; editingStatus: string }
  }
}
