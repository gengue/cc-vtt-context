import { expect, test } from 'claude-code/testing'

import { applyPatch, branchTaskId, detect, fromToolUse, goRecord, merge, pickName } from '../hooks/detect'

test('finds ClickUp, Chat and GO links in text', () => {
  const text = [
    'Working on https://app.clickup.com/t/86c1abcde.',
    'custom id (https://app.clickup.com/t/9015123/VTT-42)',
    'thread https://chat.google.com/room/AAAAspace01/xYz123_abc?cls=10',
    'mail https://mail.google.com/chat/u/0/#chat/space/AAAAbbbbCCC',
    'see https://go.venturatravel.org/bookings/123, thanks',
    'noise https://example.com/t/1',
  ].join('\n')
  expect(detect(text)).toEqual([
    { kind: 'clickup', ref: '86c1abcde', url: 'https://app.clickup.com/t/86c1abcde' },
    { kind: 'clickup', ref: '9015123/VTT-42', url: 'https://app.clickup.com/t/9015123/VTT-42' },
    { kind: 'chat', ref: 'AAAAspace01/xYz123_abc', url: 'https://chat.google.com/room/AAAAspace01/xYz123_abc?cls=10' },
    { kind: 'chat', ref: 'AAAAbbbbCCC', url: 'https://mail.google.com/chat/u/0/#chat/space/AAAAbbbbCCC' },
    { kind: 'go', ref: 'prd:/bookings/123', url: 'https://go.venturatravel.org/bookings/123', title: 'GO bookings #123' },
  ])
})

test('real VTT links', () => {
  const text = [
    'https://app.clickup.com/t/529/86xyz9876',
    'https://mail.google.com/mail/u/0/#chat/space/AAQAexample',
    'https://chat.google.com/room/AAQAexample/Thread12345/Thread12345?cls=10',
    'https://mail.google.com/mail/u/0/#inbox',
  ].join(' ')
  expect(detect(text).map(i => `${i.kind}:${i.ref}`)).toEqual([
    'clickup:86xyz9876',
    'chat:AAQAexample',
    'chat:AAQAexample/Thread12345',
  ])
})

test('URLs inside JSON-stringified content are found', () => {
  const blob = JSON.stringify([{ type: 'text', text: 'open https://app.clickup.com/t/abc123\nnext' }])
  expect(detect(blob).map(i => i.ref)).toEqual(['abc123'])
})

test('ClickUp MCP tool calls with task_id count as context', () => {
  expect(fromToolUse('mcp__x__clickup_get_task', { task_id: 'abc123' })?.ref).toBe('abc123')
  expect(fromToolUse('Bash', { task_id: 'abc123' })).toBe(undefined)
})

test('merge dedups by kind and ref', () => {
  const a = { kind: 'go' as const, ref: '/', url: 'https://go.venturatravel.org/' }
  expect(merge([a], [a, { ...a, kind: 'clickup' as const }]).length).toBe(2)
})

test('GitLab MRs and GO records', () => {
  const text = 'https://gitlab.venturatravel.org/team/project/-/merge_requests/1234/diffs ' +
    'https://go.venturatravel.org/trip_version/77/show https://go-stg.venturatravel.org/provider/42 https://go.venturatravel.org/apps/reservation-builder/9'
  expect(detect(text).map(i => [i.kind, i.ref, i.title])).toEqual([
    ['mr', 'team/project!1234', undefined],
    ['go', 'prd:/trip_version/77/show', 'GO trip version #77'],
    ['go', 'stg:/provider/42', 'GO provider #42 (stg)'],
    ['go', 'prd:/apps/reservation-builder/9', undefined],
  ])
  expect(goRecord('/trip_version/77/show')).toEqual({ route: 'trip_version', resource: 'trip', id: '77' })
  expect(goRecord('/airline_takeoff/7')?.resource).toBe('airline-takeoff')
})

test('ClickUp custom id from branch names', () => {
  expect(branchTaskId('fix/TK-12345-fix-booking-form')).toBe('TK-12345')
  expect(branchTaskId('feat/vai-context-repo')).toBe(undefined)
  expect(branchTaskId('main')).toBe(undefined)
})

test('applyPatch folds a task reached by link and by branch into one row', () => {
  const link = { kind: 'clickup' as const, ref: '86abc1234', url: 'u', taskId: '86abc1234' }
  const branch = { kind: 'clickup' as const, ref: 'TK-12345', url: 'u', fromBranch: true }
  const out = applyPatch([link, branch], branch, { taskId: '86abc1234', title: 'T' })
  expect(out).toEqual([{ ...link, title: 'T', fromBranch: true }])
})

test('pickName reads flat and wrapped vcli records', () => {
  expect(pickName({ id: 1, name: 'Hotel X' })).toBe('Hotel X')
  expect(pickName({ trip: { id: 2, version_name: 'v2' } })).toBe('v2')
  expect(pickName({ id: 3 })).toBe(undefined)
})
