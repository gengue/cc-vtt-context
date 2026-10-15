import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import type { ClickUpStatus, ContextItem, ContextKind } from '../types'
import { applyPatch, branchTaskId, CUSTOM_ID_RE, detect, fromToolUse, goRecord, merge, pickName } from './detect'
import { VENTURA_LOGO_SVG } from './logo'

const PANE = 'vtt-context'
const TITLE = 'VTT context'
const IT_MRS_PROMPT = (url: string) =>
  `Use the send-mr-to-google-chat skill to announce ${url} in IT MR's. Show me the draft message and wait for my OK before sending it.`
const SCANNED_DOORS: readonly string[] = ['prompt', 'response', 'delivery', 'attachment']
const items = atom({ plugin: 'vtt-context', key: 'entries' } as const, [])
// The ticket whose status picker is open; '' when none.
const editing = atom({ plugin: 'vtt-context', key: 'editingStatus' } as const, '')
const SECTION_ORDER: readonly ContextKind[] = ['clickup', 'mr', 'chat', 'go']

const ICONS: Record<ContextKind, string> = {
  clickup:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF02F0"/><stop offset="1" stop-color="#FFC800"/></linearGradient><linearGradient id="b" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8930FD"/><stop offset="1" stop-color="#49CCF9"/></linearGradient></defs><path d="M12 7.6 6.6 12.2 4.1 9.3 12 2.5l7.9 6.8-2.5 2.9z" fill="url(#t)"/><path d="m3 17.5 3-2.3c1.6 2.1 3.6 3.1 6 3.1s4.4-1 6-3.1l3 2.3c-2.4 3.1-5.4 4.7-9 4.7s-6.6-1.6-9-4.7z" fill="url(#b)"/></svg>',
  chat:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#00AC47"/><rect x="6.5" y="7.5" width="11" height="2" rx="1" fill="#fff"/><rect x="6.5" y="11.5" width="7" height="2" rx="1" fill="#fff"/></svg>',
  go: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#1F2937"/><text x="12" y="16.3" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="10.5" fill="#fff">GO</text></svg>',
  mr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 24"><path d="m24.507 9.5-.034-.09L21.082.562a.896.896 0 0 0-1.694.091l-2.29 7.01H7.825L5.535.653a.898.898 0 0 0-1.694-.09L.451 9.411.416 9.5a6.297 6.297 0 0 0 2.09 7.278l.012.01.03.022 5.16 3.867 2.56 1.935 1.554 1.176a1.051 1.051 0 0 0 1.268 0l1.555-1.176 2.56-1.935 5.197-3.89.014-.01A6.297 6.297 0 0 0 24.507 9.5Z" fill="#E24329"/></svg>',
}
const GLYPH_COLOR: Record<ContextKind, string> = { clickup: '#7B68EE', chat: '#00AC47', go: '#9CA3AF', mr: '#E24329' }
const KIND_NAME: Record<ContextKind, string> = { clickup: 'ClickUp', chat: 'Google Chat', go: 'GO', mr: 'GitLab MR' }

// The desktop app's PATH may lack Homebrew or /usr/local, so retry there.
async function run($: EngineInterface, cmd: string, args: string[], cwd?: string): Promise<string | undefined> {
  for (const bin of [cmd, `/opt/homebrew/bin/${cmd}`, `/usr/local/bin/${cmd}`]) {
    try {
      const r = await $.process.run([bin, ...args], { timeoutMs: 15_000, cwd })
      return r.exitCode === 0 ? r.stdout : undefined
    } catch {
      // not found here, try the next location
    }
  }
}

function json(text: string | undefined): any {
  const start = text?.search(/[[{]/) ?? -1
  if (start < 0) return undefined
  try {
    return JSON.parse(text!.slice(start))
  } catch {
    return undefined
  }
}

// ponytail: per-load cache, a reload fetches list statuses again
const listStatuses = new Map<string, ClickUpStatus[]>()

async function lookup($: EngineInterface, item: ContextItem): Promise<Partial<ContextItem> | undefined> {
  if (item.kind === 'clickup') {
    const [team, id = ''] = item.ref.includes('/') ? item.ref.split('/') : [undefined, item.ref]
    const args = ['task', 'get', item.taskId ?? id, '--output', 'json']
    if (!item.taskId && CUSTOM_ID_RE.test(id)) args.push('--custom-task-id', ...(team ? ['--workspace', team] : []))
    const raw = json(await run($, 'clickup-cli', args))
    const task = Array.isArray(raw) ? raw[0] : raw
    if (!task?.name) return
    const listId: string | undefined = task.list?.id
    if (listId && !listStatuses.has(listId)) {
      const list = json(await run($, 'clickup-cli', ['list', 'get', listId, '--output', 'json']))
      const statuses = (Array.isArray(list) ? list[0] : list)?.statuses
      if (Array.isArray(statuses)) listStatuses.set(listId, statuses.map(s => ({ name: s.status, color: s.color })))
    }
    const who = (task.assignees ?? []).map((a: { username?: string }) => a.username).filter(Boolean)
    return {
      title: task.custom_id ? `${task.custom_id} · ${task.name}` : task.name,
      url: task.url ?? item.url,
      taskId: task.id,
      status: task.status ? { name: task.status.status, color: task.status.color } : undefined,
      statuses: listId ? listStatuses.get(listId) : undefined,
      meta: who.length ? who.join(', ') : 'Unassigned',
    }
  }

  if (item.kind === 'chat') {
    const [space, thread] = item.ref.split('/')
    const out = json(await run($, 'gws', ['chat', 'spaces', 'get', '--params', JSON.stringify({ name: `spaces/${space}` })]))
    const name = out?.displayName || (out?.spaceType === 'DIRECT_MESSAGE' ? 'Direct message' : undefined)
    return name ? { title: thread ? `${name} · thread` : name } : undefined
  }

  if (item.kind === 'mr') {
    const [project = '', iid = ''] = item.ref.split('!')
    const mr = json(await run($, 'glab', ['api', '--hostname', 'gitlab.venturatravel.org',
      `projects/${encodeURIComponent(project)}/merge_requests/${iid}`]))
    if (!mr?.title) return
    const pipeline = mr.head_pipeline?.status
    return {
      title: `!${iid} · ${mr.title}`,
      meta: [mr.state, pipeline && `pipeline ${pipeline}`, `→ ${mr.target_branch}`].filter(Boolean).join(' · '),
      targetBranch: mr.target_branch,
    }
  }

  // GO: the URL already named the record; vcli adds its name when logged in.
  const [env = 'prd', path = '/'] = item.ref.split(/:(.*)/s)
  const record = goRecord(path)
  if (!record) return
  const name = pickName(json(await run($, 'vcli', ['go', '--env', env, '--json', record.resource, 'get', record.id])))
  return name ? { title: `${item.title} · ${name}` } : undefined
}

async function enrich($: EngineInterface, item: ContextItem) {
  const patch = await lookup($, item).catch(() => undefined)
  if (patch) await update($, items, list => applyPatch(list ?? [], item, patch))
}

async function collect($: EngineInterface, add: ContextItem[]) {
  const before = await read($, items)
  const fresh = add.filter(a => !before.some(b => b.kind === a.kind && b.ref === a.ref))
  if (fresh.length === 0) return
  await update($, items, list => merge(list ?? [], fresh))
  void $.ui.open({ id: PANE, title: TITLE })
  for (const item of fresh) await enrich($, item)
}

async function checkBranch($: EngineInterface) {
  const cwd = await $.session.cwd()
  const branch = (await run($, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd))?.trim()
  const id = branch && branchTaskId(branch)
  const list = await read($, items)
  const current = !id ? undefined : list.find(o => o.kind === 'clickup' && (o.ref === id || o.title?.startsWith(`${id} ·`)))
  // Only the ticket of the branch checked out now carries the flag.
  if (list.some(o => o.fromBranch && o !== current) || (current && !current.fromBranch)) {
    await update($, items, l => (l ?? []).map(o => ({ ...o, fromBranch: o.kind === current?.kind && o.ref === current.ref })))
  }
  if (id && !current) await collect($, [{ kind: 'clickup', ref: id, url: `https://app.clickup.com/t/${id}`, fromBranch: true }])
}

async function setStatus($: EngineInterface, item: ContextItem, status: string) {
  if (!item.taskId || status === item.status?.name) return
  const ok = await run($, 'clickup-cli', ['task', 'update', item.taskId, '--status', status])
  if (ok === undefined) void $.ui.toast(`Could not set ${item.title ?? item.taskId} to "${status}".`)
  await enrich($, item)
}

async function refreshAll($: EngineInterface) {
  await checkBranch($)
  for (const item of await read($, items)) await enrich($, item)
}

function scanContent(content: unknown): ContextItem[] {
  if (typeof content === 'string') return detect(content)
  if (!Array.isArray(content)) return []
  // Text blocks only: tool inputs carry file contents, code and fixtures, not context.
  const found: ContextItem[] = []
  for (const block of content as Array<{ type?: string; text?: unknown; name?: string; input?: unknown }>) {
    if (block.type === 'text' && typeof block.text === 'string') found.push(...detect(block.text))
    if (block.type === 'tool_use' && block.name) {
      const item = fromToolUse(block.name, block.input)
      if (item) found.push(item)
    }
  }
  return found
}

async function remove($: EngineInterface, item: ContextItem) {
  await update($, items, list => (list ?? []).filter(o => !(o.kind === item.kind && o.ref === item.ref)))
}

type Table = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Link' | 'Button'> &
  Partial<Pick<ElementTable<'terminal'>, 'Select'>>

function drawSections(
  $: EngineInterface,
  t: Table,
  list: ContextItem[],
  open: string,
  icon: (kind: ContextKind) => JSX.Element,
) {
  const { Box, Text, Link, Button, Select } = t
  const row = (item: ContextItem) => (
    <Box key={`${item.kind}:${item.ref}`} flexDirection="column" paddingLeft={2}>
      <Box flexDirection="row" gap={1} alignItems="center">
        {item.status && <Text color={item.status.color}>■</Text>}
        <Link href={item.url} label={item.title ?? item.url.replace(/^https?:\/\//, '')} />
        {item.fromBranch && <Text color="#7B68EE">branch</Text>}
        <Button key={`remove:${item.kind}:${item.ref}`} plain dimColor onPress={() => void remove($, item)}>✕</Button>
      </Box>
      {(item.meta || item.status || (item.kind === 'mr' && item.targetBranch === 'main')) && (
        <Box flexDirection="row" gap={1} alignItems="center">
          {item.status && Select && item.statuses?.length && open === item.ref ? (
            <Select
              key={`status:${item.ref}`}
              autoFocus
              value={item.status.name}
              options={item.statuses.map(s => ({ value: s.name, label: s.name.toUpperCase() }))}
              onSelect={value => {
                void update($, editing, () => '')
                void setStatus($, item, value)
              }}
            />
          ) : (
            item.status && (
              // ClickUp's status pill: white caps on the status color; a press opens the picker.
              <Button
                key={`pill:${item.ref}`}
                plain
                onPress={() => void update($, editing, cur => (cur === item.ref ? '' : item.ref))}
              >
                <Text backgroundColor={item.status.color} color="#FFFFFF" bold>
                  {` ${item.status.name.toUpperCase()} `}
                </Text>
              </Button>
            )
          )}
          {item.meta && <Text dimColor>{item.meta}</Text>}
          {item.kind === 'mr' && item.targetBranch === 'main' && (
            <Button key={`itmrs:${item.ref}`} onPress={() => void $.prompt.submit({ text: IT_MRS_PROMPT(item.url), asUser: true })}>
              Send to IT MR's
            </Button>
          )}
        </Box>
      )}
    </Box>
  )
  return SECTION_ORDER.map(kind => {
    // The branch's ticket leads its section.
    const rows = list.filter(o => o.kind === kind).sort((a, b) => Number(!!b.fromBranch) - Number(!!a.fromBranch))
    if (rows.length === 0) return null
    return (
      <Box key={`section:${kind}`} flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {icon(kind)}
          <Text bold>{KIND_NAME[kind]}</Text>
          <Text dimColor>{rows.length}</Text>
        </Box>
        {rows.map(row)}
      </Box>
    )
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'vtt-context',
      description: 'Show the VTT context pane (ClickUp, Google Chat, GitLab, GO links of this session)',
    })
    // A resumed session's rows are loaded, not appended: scan them once.
    const found = (await $.session.messages()).flatMap(m => detect(m.text))
    if (found.length) void collect($, found)
    void checkBranch($)
    return next(e)
  })

  // The branch may change during a turn (git checkout, a new worktree).
  on('turn.complete', async ($, e, next) => {
    void checkBranch($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'vtt-context' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'VTT context pane opened.' }
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    // What the person says (typed, or sent mid-turn) and what the main model says;
    // tool output and subagents are noise.
    if (e.agentId || !SCANNED_DOORS.includes(e.door)) return stored
    const found = scanContent(e.message.content)
    if (found.length) void collect($, found).catch(() => undefined)
    return stored
  }).catch(($, e, next) => next(e)) // never hold up a row over the pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, items)
    const open = await read($, editing)
    const empty = 'No ClickUp, Chat, GitLab or GO links yet.'

    if (e.surface === 'terminal') {
      const t = $.ui.resolve(e)
      const { Box, Text, Button } = t
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold>{TITLE}</Text>
            <Button key="refresh" plain onPress={() => void refreshAll($)}>↻</Button>
          </Box>
          {list.length === 0 && <Text dimColor>{empty}</Text>}
          {drawSections($, t, list, open, kind => <Text color={GLYPH_COLOR[kind]}>●</Text>)}
        </Box>
      )
    }

    const t = $.ui.resolve(e)
    const { Box, Text, Button, Svg } = t
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Svg source={VENTURA_LOGO_SVG} alt="Ventura Travel" width={20} height={20} />
          <Text bold>{TITLE}</Text>
          <Button key="refresh" plain onPress={() => void refreshAll($)}>↻</Button>
        </Box>
        {list.length === 0 && <Text dimColor>{empty}</Text>}
        {drawSections($, t, list, open, kind => (
          <Svg source={ICONS[kind]} alt={KIND_NAME[kind]} width={16} height={16} />
        ))}
      </Box>
    )
  })
}
