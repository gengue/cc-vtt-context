# vtt-context

A Claude Code mod for Ventura Travel. It adds a **VTT context** side pane that lists the work links of the session, grouped by app:

- **ClickUp**: task name, assignee and a colored status pill. Click the pill to change the status. The ticket of the current git branch (`fix/TK-12345-...`) is added by itself.
- **GitLab MR**: title, state, pipeline and target branch. MRs to `main` get a **Send to IT MR's** button: Claude drafts the message and waits for your OK.
- **Google Chat**: space name, for spaces and threads.
- **Looker Studio** (Data Studio): report links, named by their id.
- **GO** (`go.venturatravel.org`): record type and id, plus its name when `vcli` is logged in.

The pane opens when a link shows up in the chat. `/vtt-context` opens it again, ↻ refreshes, ✕ removes a row.

## Install

In a Claude Code terminal session:

```
/plugin install vtt-context --marketplace gengue/vtt-context
```

Answer `y` to add the marketplace, then pick the user scope. The desktop app's Code tab loads it too.

## Requirements

The mod calls these CLIs with your own logins. Each one is optional: without it, that app shows the plain link.

| App | CLI | Install | Login |
| --- | --- | --- | --- |
| ClickUp | [`clickup-cli`](https://github.com/nicholasbester/clickup-cli) | `brew install nicholasbester/clickup-cli/clickup-cli` | `clickup-cli setup` |
| GitLab | [`glab`](https://gitlab.com/gitlab-org/cli) | `brew install glab` | `glab auth login --hostname gitlab.venturatravel.org` |
| Google Chat | `gws` (Google Workspace CLI) | `brew install googleworkspace-cli` | `gws auth login` |
| GO | `vcli` | see the `vcli-go` skill | `vcli login --env prd` |

**Send to IT MR's** needs the `send-mr-to-google-chat` skill.

## Develop

```bash
claude plugin validate .
claude plugin test .
```
