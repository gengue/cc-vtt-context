import { expect, test } from 'claude-code/testing'

import type { ContextItem } from '../types'

const ITEMS: ContextItem[] = [
  {
    kind: 'clickup', ref: 'TK-12345', url: 'https://app.clickup.com/t/86abc1234', taskId: '86abc1234',
    title: 'TK-12345 · Fix the booking form', fromBranch: true, meta: 'Jane Doe',
    status: { name: 'rejected', color: '#d33d44' },
    statuses: [{ name: 'Open', color: '#87909e' }, { name: 'rejected', color: '#d33d44' }],
  },
  {
    kind: 'mr', ref: 'team/project!1234',
    url: 'https://gitlab.venturatravel.org/team/project/-/merge_requests/1234',
    title: '!1234 · docs: example', meta: 'opened · pipeline success · → main', targetBranch: 'main',
  },
  { kind: 'go', ref: 'prd:/provider/42', url: 'https://go.venturatravel.org/provider/42', title: 'GO provider #42' },
]
const PROPS = { title: 'VTT context', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pane draws status select, branch tag and IT MR's button on ${surface}`, async ($, on) => {
    on('state.get', ($, e, next) => (e.key === 'entries' ? { value: { value: ITEMS, version: 1 } } : next(e)))
    const ui = await $.ui.mount({ plugin: 'vtt-context', surface, component: 'Pane', requestId: 'vtt-context', props: PROPS })
    expect(await ui.find({ key: 'pill:TK-12345' })).toBeDefined()
    expect(await ui.find({ key: 'status:TK-12345' })).toBeUndefined()
    expect(await ui.find({ key: 'itmrs:team/project!1234' })).toBeDefined()
    expect(await ui.find({ text: 'branch' })).toBeDefined()
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    expect((await ui.findAll({ key: 'section:clickup' })).length).toBe(1)
    expect(await ui.find({ key: 'section:chat' })).toBeUndefined()
  })
}

test('status select runs clickup-cli; IT MR\'s button asks Claude for a draft first', async ($, on) => {
  const argvs: string[][] = []
  const prompts: string[] = []
  on('state.get', ($, e, next) => (e.key === 'entries' ? { value: { value: ITEMS, version: 1 } } : next(e)))
  on('state.set', ($, e, next) => (e.key === 'entries' ? { value: { isSet: true, version: 2 } } : next(e)))
  on('process.run', ($, e) => {
    argvs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  const ui = await $.ui.mount({ plugin: 'vtt-context', surface: 'desktop', component: 'Pane', requestId: 'vtt-context', props: PROPS })

  await ui.press({ key: 'pill:TK-12345' })
  expect(await ui.find({ key: 'status:TK-12345' })).toBeDefined()
  await ui.select({ key: 'status:TK-12345', value: 'Open' })
  expect(argvs[0]).toEqual(['clickup-cli', 'task', 'update', '86abc1234', '--status', 'Open'])

  await ui.press({ key: 'itmrs:team/project!1234' })
  expect(prompts[0]).toContain('send-mr-to-google-chat')
  expect(prompts[0]).toContain('wait for my OK before sending')
})
