import type { ContextItem } from '../types'

const URL_RE = /https?:\/\/[^\s"'<>`\\|\]\[(){}]+/g
const TRAILING = /[.,;:!?*_~]+$/

// app.clickup.com/t/<id> or app.clickup.com/t/<team>/<CUSTOM-ID>
const CLICKUP_RE = /^https?:\/\/app\.clickup\.com\/t\/(?:(\d+)\/)?([A-Za-z0-9_-]+)/
export const CUSTOM_ID_RE = /^[A-Za-z]+-\d+$/
// chat.google.com/room/<space>/<thread>, mail.google.com/{mail,chat}/u/0/#chat/space/<space>/<thread>,
// chat.google.com/u/0/app/chat/<space>, .../dm/<space>
const CHAT_HOST_RE = /^https?:\/\/(?:chat\.google\.com\/|mail\.google\.com\/(?:chat\/|mail\/.*#chat\/))/
const CHAT_IDS_RE = /\/(room|space|chat|dm)\/([A-Za-z0-9_-]{6,})(?:\/([A-Za-z0-9_-]+))?/
const GO_RE = /^https?:\/\/go(-stg)?\.venturatravel\.org(\/[^?#]*)?/
// datastudio.google.com or lookerstudio.google.com /u/0/reporting/<uuid>[/page/<page>]
const REPORT_RE = /^https?:\/\/(?:datastudio|lookerstudio)\.google\.com\/(?:u\/\d+\/)?reporting\/([0-9a-f-]{36})/i
const MR_RE = /^https?:\/\/gitlab\.venturatravel\.org\/(.+?)\/-\/merge_requests\/(\d+)/

export function detect(text: string): ContextItem[] {
  const found: ContextItem[] = []
  for (const raw of text.match(URL_RE) ?? []) {
    const url = raw.replace(TRAILING, '')

    const cu = url.match(CLICKUP_RE)
    if (cu) {
      const [, team, id = ''] = cu
      // /t/<team>/<id> holds a plain id too; only PREFIX-123 needs the team to resolve.
      const isCustom = team && CUSTOM_ID_RE.test(id)
      found.push({
        kind: 'clickup',
        ref: isCustom ? `${team}/${id}` : id,
        url: `https://app.clickup.com/t/${team ? `${team}/` : ''}${id}`,
      })
      continue
    }

    if (CHAT_HOST_RE.test(url)) {
      const ids = url.match(CHAT_IDS_RE)
      if (!ids) continue
      const [, , space = '', thread] = ids
      found.push({ kind: 'chat', ref: thread ? `${space}/${thread}` : space, url })
      continue
    }

    const mr = url.match(MR_RE)
    if (mr) {
      const [, project = '', iid = ''] = mr
      found.push({ kind: 'mr', ref: `${project}!${iid}`, url: `https://gitlab.venturatravel.org/${project}/-/merge_requests/${iid}` })
      continue
    }

    const report = url.match(REPORT_RE)
    if (report) {
      const [, id = ''] = report
      // ponytail: no API reads a report's name with the user's logins, so the id names it
      found.push({ kind: 'report', ref: id.toLowerCase(), url, title: `Report ${id.slice(0, 8)}` })
      continue
    }

    const go = url.match(GO_RE)
    if (go) {
      const path = go[2] && go[2] !== '/' ? go[2].replace(/\/$/, '') : '/'
      const record = goRecord(path)
      found.push({
        kind: 'go',
        ref: `${go[1] ? 'stg' : 'prd'}:${path}`,
        url,
        title: record && `GO ${record.route.replace(/_/g, ' ')} #${record.id}${go[1] ? ' (stg)' : ''}`,
      })
    }
  }
  return found
}

// GO routes whose vcli resource is not the route with _ turned into -.
const GO_RESOURCE: Record<string, string> = {
  trip_version: 'trip',
  user: 'vmember',
  project: 'brand',
  project_locale: 'brand-market',
  project_configuration: 'feature-flag',
  claim_csat: 'csat-claim',
}

/** /<route>/<id>[/show] as a vcli resource and id; undefined for lists, builders and forms. */
export function goRecord(path: string): { route: string; resource: string; id: string } | undefined {
  const m = path.match(/^\/([a-z0-9_]+)\/([0-9a-f-]+)(?:\/show)?$/i)
  if (!m || m[1] === 'apps') return
  const [, route = '', id = ''] = m
  return { route, resource: GO_RESOURCE[route] ?? route.replace(/_/g, '-'), id }
}

/** The ClickUp custom id (TK-12345) a branch name carries, if any. */
export function branchTaskId(branch: string): string | undefined {
  return branch.match(/(?:^|[/_-])([A-Z]{2,}-\d+)(?=$|[/_-])/)?.[1]
}

/** A ClickUp MCP tool call that names a task, as a context item. */
export function fromToolUse(name: string, input: unknown): ContextItem | undefined {
  if (!/clickup/i.test(name) || typeof input !== 'object' || input === null) return
  const id = (input as Record<string, unknown>).task_id
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return
  return { kind: 'clickup', ref: id, url: `https://app.clickup.com/t/${id}` }
}

export function merge(list: ContextItem[], add: ContextItem[]): ContextItem[] {
  const out = [...list]
  for (const item of add) {
    if (!out.some(o => o.kind === item.kind && o.ref === item.ref)) out.push(item)
  }
  return out.slice(-100) // ponytail: cap, oldest dropped
}

/**
 * Applies what a lookup found to one item. A ClickUp task reached twice (by its
 * link and by its custom id in the branch) keeps the first row, branch flag merged.
 */
export function applyPatch(list: ContextItem[], target: ContextItem, patch: Partial<ContextItem>): ContextItem[] {
  const same = (o: ContextItem) => o.kind === target.kind && o.ref === target.ref
  const twin = patch.taskId && list.find(o => !same(o) && o.kind === 'clickup' && o.taskId === patch.taskId)
  if (twin) {
    const fromBranch = twin.fromBranch || list.find(same)?.fromBranch
    return list.filter(o => !same(o)).map(o => (o === twin ? { ...o, ...patch, ref: o.ref, fromBranch } : o))
  }
  return list.map(o => (same(o) ? { ...o, ...patch } : o))
}

/** The first name-like field of a vcli JSON record. */
export function pickName(record: unknown): string | undefined {
  if (typeof record !== 'object' || record === null) return
  const o = record as Record<string, unknown>
  for (const key of ['name', 'title', 'version_name', 'display_name', 'full_name', 'code', 'invoice_number', 'email']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  // { data: {...} } or { provider: {...} }: look one level down.
  const inner = Object.values(o).filter(v => typeof v === 'object' && v !== null && !Array.isArray(v))
  return inner.length === 1 ? pickName(inner[0]) : undefined
}
