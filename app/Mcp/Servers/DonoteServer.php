<?php

namespace App\Mcp\Servers;

use App\Mcp\Tools\AppendToDailyNoteTool;
use App\Mcp\Tools\AppendToNoteTool;
use App\Mcp\Tools\CreateNoteTool;
use App\Mcp\Tools\DeleteNoteTool;
use App\Mcp\Tools\GetNoteTool;
use App\Mcp\Tools\ListNotesTool;
use App\Mcp\Tools\SearchNotesTool;
use App\Mcp\Tools\UpdateNoteTool;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;
use Laravel\Mcp\Server\Prompt;
use Laravel\Mcp\Server\Tool;

#[Name('Donote')]
#[Version('1.0.0')]
#[Instructions(<<<'MD'
Donote is the user's markdown-based note-taking and task management workspace
(similar to NotePlan). Notes are plain markdown; edits you make appear on all
of the user's devices within seconds.

Markdown dialect (use it when writing notes):
- Task: `- [ ] title` · done `- [x]` · cancelled `- [-]`
- Checklist item: `+ [ ] title` (lighter than a task; not counted in progress)
- Priority: `!` / `!!` / `!!!` right after the checkbox, e.g. `- [ ] !! Pay invoices`
- Schedule: `>2026-07-15` (day), `>2026-W30` (week), `>2026-09` (month), `>2026-Q4` (quarter), `>2026` (year)
- Deadline: `@due(2026-07-20)` · Repeat: `@repeat(3d)`, `@repeat(+3d)` (from completion), `@repeat(Tue,Thu)`, `@repeat(20th)`
- Reminder: `@9am` or `@14:30` · Tags: `#tag` or nested `#area/subarea` · Mentions: `@name`
- Wiki link to another note: `[[Note Title]]` or `[[Note Title|shown text]]`
- End-of-line comment: `... // comment` · Synced line: a trailing `^abc123` shares that line across notes
- Nesting: indent lines with 4 spaces under a task/bullet to attach subtasks and context.

Typed notes carry YAML-ish front matter at the top: `type: project|area|list`,
plus optional `start:`/`due:` dates (projects), and a `review: 2w|Sat|20th`
cadence with `reviewed: yyyy-mm-dd`.

Calendar notes exist per period (daily/weekly/monthly/quarterly/yearly) and are
addressed by date keys like 2026-07-15, 2026-W29, 2026-07, 2026-Q3, 2026.

Guidance:
- To capture something for the user's day, prefer append-to-daily-note.
- Prefer append-to-note over update-note; update-note replaces the whole
  content, so always get-note first and send the complete result back.
- Folders are implicit: creating a note with folder "Projects/Alpha" creates
  the folders. Empty folders cannot exist on their own.
- Only delete notes when the user explicitly asks.
MD)]
class DonoteServer extends Server
{
    /**
     * The tools registered with this MCP server.
     *
     * @var array<int, class-string<Tool>>
     */
    protected array $tools = [
        ListNotesTool::class,
        SearchNotesTool::class,
        GetNoteTool::class,
        CreateNoteTool::class,
        UpdateNoteTool::class,
        AppendToNoteTool::class,
        AppendToDailyNoteTool::class,
        DeleteNoteTool::class,
    ];

    /**
     * The resources registered with this MCP server.
     *
     * @var array<int, class-string<Server\Resource>>
     */
    protected array $resources = [];

    /**
     * The prompts registered with this MCP server.
     *
     * @var array<int, class-string<Prompt>>
     */
    protected array $prompts = [];
}
