---
name: serena
description: Use Serena MCP tools for codebase navigation, symbol-level understanding, and semantic code retrieval. Apply this skill whenever working with an unfamiliar codebase, performing cross-file navigation, looking up symbol definitions or references, or onboarding to a new project via Serena. Triggers include "explore the codebase", "find where X is defined", "understand the project structure", "navigate to", "find references to", or any task requiring deep code understanding beyond what file reading alone provides.
---

Serena provides LSP-backed, IDE-grade tools for semantic code navigation. The goal is to let you find and understand code at the symbol level — without reading entire files or using grep-style search.

## Pre-flight: Activation Ritual

**Always run this sequence at the start of any session before using any other Serena tools:**

1. Call `get_current_config` — verify which project (if any) is currently active.
2. If the correct project is not active, call `activate_project` with an absolute path or the registered project name (default: directory name).
3. Call `check_onboarding_performed` — check whether onboarding memory files exist under `.serena/memories/`.
4. If onboarding has NOT been performed, call `initial_instructions` (or `onboarding`) to let Serena analyze the project structure and generate memory files.
5. If onboarding HAS been performed, read relevant memory files selectively — do not re-run onboarding unnecessarily.

**Only one project can be active at a time.** Switching projects requires explicit re-activation.

## Core Navigation Tools

Use these in preference to reading full files or running grep:

| Tool | When to use |
|---|---|
| `find_symbol` | Look up a class, function, method, or variable by name |
| `find_referencing_symbols` | Find all symbols that reference a given symbol (callers, importers) |
| `find_referencing_code_snippets` | Find raw code snippets referencing a symbol at a given location |
| `get_symbols_in_file` | List all top-level symbols in a file — use before reading it |
| `get_symbol_body` | Retrieve the full body of a specific symbol |
| `search_for_pattern` | Fallback text/regex search when symbol-level tools are insufficient |

**Preferred navigation flow:**
1. `get_symbols_in_file` → understand the file's surface area
2. `find_symbol` → locate the specific symbol
3. `get_symbol_body` → read its implementation
4. `find_referencing_symbols` → understand its callers/dependents

## Memory System

Serena persists project knowledge in `.serena/memories/` as Markdown files. Use the memory tools actively:

- `write_memory` — save insights discovered during a session (architecture decisions, non-obvious patterns, gotchas)
- `delete_memory` — remove stale or incorrect memory entries
- Memory files are read selectively at the start of future sessions, so write high-signal entries: key architectural patterns, domain concepts, important conventions

**What to write to memory:**
- Module responsibilities and boundaries
- Non-obvious dependencies or coupling
- Business logic that isn't clear from code alone
- Known technical debt or workarounds

## Session Handoff

For long tasks approaching context limits:

1. Call `prepare_for_new_conversation` — this saves a structured summary of current progress as a memory file.
2. In the new session, run the activation ritual and read the handoff memory before continuing.

## Dynamic Modes

Serena supports `switch_modes` to change the active toolset mid-session:

- `planning` — for architecture exploration and understanding (restricts editing tools)
- `editing` — for making changes
- `one-shot` — for single-action tasks

Switch to `planning` mode when exploring an unfamiliar codebase. Switch to `editing` only when ready to make changes.

## Thinking Tools

Use these before acting — they prompt structured reflection and reduce mistakes:

- `think_about_collected_information` — have you gathered enough context to proceed?
- `think_about_task_adherence` — are you still on track with the original task?
- `think_about_whether_you_are_done` — is the task truly complete?

Call `think_about_collected_information` before making any edit. Call `think_about_whether_you_are_done` before declaring the task finished.

## Editing Tools (use with care)

Only use these after thorough exploration:

| Tool | Use for |
|---|---|
| `replace_symbol_body` | Replace the full body of a function/class |
| `insert_after_symbol` | Add new code after a symbol |
| `delete_lines` | Remove specific lines |
| `create_text_file` | Create or overwrite a file |
| `summarize_changes` | Document what was changed at the end of a session |

**Always call `summarize_changes` at the end of an editing session.**

If edits were made outside Serena (e.g., in the VS Code editor directly), call `restart_language_server` to re-sync the LSP index.

## Shell Execution

`execute_shell_command` is **disabled by default** in `ide-assistant` context (the IDE client already provides this). If you need it (e.g., for running tests), enable it explicitly in `.serena/project.yml`:

```yaml
excluded_tools: []  # remove execute_shell_command from this list if present
```

## Performance Tips

- For large codebases, pre-index before starting: `uvx --from git+https://github.com/oraios/serena serena project index`
- Add build artifacts, `node_modules`, `bin/obj` etc. to `ignored_paths` in `.serena/project.yml` to speed up indexing and reduce noise
- Dashboard available at `http://localhost:24282/dashboard/index.html` when the server is running — useful for inspecting logs and tool execution status

## Tool Naming Caveat

Some MCP clients do not resolve the server name, so referring to "use Serena's tools" may not work. **Always reference tools by their exact name** (e.g., `find_symbol`, `get_symbol_body`). In multi-server setups, watch for tool name collisions — if Serena's tools seem to misbehave, check whether another MCP server exposes identically-named tools.

## Supported Languages

Direct LSP support: **C#, TypeScript, JavaScript, Python, Java**
Indirect/community support: Ruby, Go, Swift, Bash (check current release notes for additions)

For Svelte/TypeScript projects: Serena uses the TypeScript LSP, which covers `.ts`, `.js`, and `.svelte` files. Symbol navigation works across component boundaries — `find_referencing_symbols` is particularly useful for tracking prop usage and store subscriptions across components. Type annotations significantly improve symbol resolution quality, so prefer explicit types over `any` in files you want Serena to navigate well.