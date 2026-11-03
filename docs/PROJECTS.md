# Fellowship Projects — feature inventory and contract

Source: the user's 57-second screen recording of a project-tracking dashboard (Jira-style),
studied frame by frame. Fellowship re-implements the **features and workflows** shown, in
Fellowship's own look and wording. No third-party logos, names or assets are copied.

## 1. What the recording shows → what Fellowship builds

| Recording | Fellowship |
|---|---|
| Left nav: For you, Recent, Starred, Apps (Explore more apps), Plans, Spaces (+, …), Starred / Recent / More spaces (search popover, view all), Recommended, Filters, Dashboards, Assets, Teams, Customize sidebar | Sidebar "Projects" section: For you, Recent, Starred, all spaces (search popover + create), Filters, Dashboards. Assets/Teams/Plans become: People directory link, Timeline across spaces. Sidebar items can be hidden ("Customize") |
| Top bar: search, **+ Create**, notifications, help, settings, avatar | "+ Create" work item button in the Projects header (global shortcut `c`) |
| Space header: icon, name, people button, "…" menu; share, automation (bolt), feedback, fullscreen | Same: rename/icon/delete in "…", members popover, copy link, "Automate" (opens Workflows), feedback, full-width toggle |
| Tabs: Summary, List, Board, Development, Forms, Timeline, Docs, **+** add tab; tab menu: Set as default, Rename, Move left/right | Same tabs; per-space tab config (order, default, renamed labels, hidden) persisted on the server |
| **Summary**: dismissable banner; filter + people avatars; 4 stat cards (completed/updated/created in last 7 days, due soon next 7 days); Status overview donut (To Do / In Progress / In Review / Done); Recent activity feed; Priority breakdown bars (Highest…Lowest, None); Types of work distribution (Task, Epic, Story, Subtask, Bug); Team workload by assignee; Epic progress bars (done / in progress / to do); "was this useful" feedback | All of it, computed live from the space's work items and activity log |
| **List**: Ask AI, search, people filter, Filter, Group; columns Work (expand children, key, summary), Assignee, Reporter, Priority, Status (inline dropdown), more; inline "+ Create"; "5 of 5" count, refresh; row hover open / add child | All of it. "Ask" is a local natural-language query parser (no external AI service) |
| **Board**: columns To Do / In Progress / In Review / Done with counts; cards with summary, due date, parent epic chip (changeable), type icon + key, assignee; "+" per column; search, people filter, Filter, Group; insights, view settings, "…"; column "…" | All of it, with drag-and-drop between and within columns |
| **Development**: Key metrics (work completed this week + sparkline, PR cycle time, lead time for changes, overdue, reopened, bugs open, PRs open, critical vulnerabilities); Connections / Pull requests / Repositories / Vulnerabilities / Deployments tabs; source-code connectors; resources | Metrics from Fellowship data; code-host metrics fed by an incoming webhook per space (`POST /api/hooks/dev/:secret` with pull_request / deployment / vulnerability events) shown in those tabs; connector cards explain the webhook setup |
| **Forms**: intro; create from Blank, Feature request, Bug report, Incident report, Technical review | Form builder + public-in-workspace form page; each submission creates a work item |
| **Timeline**: work list with status/progress bars and assignee; Gantt bars with today line; Today / Weeks / Months / Quarters | All of it; drag a bar to move dates, drag its edge to resize |
| **Docs**: link space knowledge | Lists Fellowship canvases linked to the space; create a space doc (canvas) |
| Second space with its own key (KAN-1, KAN-2) | Multiple spaces per workspace, each with its own key and numbering |

Chat integration: share a work item into a channel (card message), "@-mention" style item keys
(`SAM-12`) in messages link to the item, assignment notifies the assignee.

## 2. Server module `projects`

Tables: `projects`, `project_stars`, `project_visits`, `work_items`, `work_item_activity`,
`work_item_comments`, `project_forms`, `project_filters`, `project_dashboards`, `project_dev_events`.

Work item: `{ id, projectId, key ("SAM-12"), number, type: epic|story|task|bug|subtask, summary,
description, status: todo|in_progress|in_review|done, priority: highest|high|medium|low|lowest|none,
assigneeId, reporterId, parentId, startDate, dueDate (YYYY-MM-DD), rank (float), labels[],
createdAt, updatedAt, resolvedAt, reopenedCount, childCount, childDone }`.

REST (all JSON, workspace membership enforced):
- `GET/POST /api/w/:wid/projects`, `GET/PATCH/DELETE /api/projects/:pid`, `POST /api/projects/:pid/star`, `POST /api/projects/:pid/visit`
- `GET /api/projects/:pid/items?q&assignee&status&type&priority&parent&ask` · `POST /api/projects/:pid/items`
- `GET/PATCH/DELETE /api/items/:iid` · `POST /api/items/:iid/rank {beforeId|afterId, status?}`
- `GET /api/items/:iid/activity` · `GET/POST /api/items/:iid/comments` · `POST /api/items/:iid/share {conversationId}`
- `GET /api/projects/:pid/summary?days=7` · `GET /api/projects/:pid/development`
- `GET/POST /api/projects/:pid/forms` · `GET/PATCH/DELETE /api/forms/:fid` · `POST /api/forms/:fid/submit`
- `GET/POST /api/w/:wid/project-filters` · `DELETE /api/project-filters/:id`
- `GET/POST /api/w/:wid/dashboards` · `GET/PATCH/DELETE /api/dashboards/:id`
- `GET /api/w/:wid/for-you` (assigned to me, recent items, starred/recent spaces)
- `POST /api/hooks/dev/:secret` (code-host events)

Events (to workspace members): `project.created|updated|deleted`, `item.created|updated|deleted`
with `{ project }` / `{ item }`.
