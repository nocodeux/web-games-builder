# TUIFY Docs MCP Server

An MCP (Model Context Protocol) server that exposes TUIFY platform documentation so AI tools can generate valid apps and games.

## What it exposes

| Resource | Description |
|----------|-------------|
| `tuify://components/*` | Props, defaults, and examples for each of the 22 UI components |
| `tuify://schemas/project.schema` | Full JSON schema for TUIFY project files |
| `tuify://tutorials/00-sizing-and-layout` | How sizing (hug/fill/fixed) and flexbox layout work |
| `tuify://tutorials/01-create-app` | Build a multi-screen app with DB + navigation |
| `tuify://tutorials/02-create-game` | Build a platformer/top-down game with levels and entities |
| `tuify://tutorials/03-api-render` | Deploy a complete app via a single curl call |

## Available tools

| Tool | Description |
|------|-------------|
| `list_components` | List all component types with categories |
| `get_component_spec` | Get full spec for one component (pass `type` argument) |
| `get_project_schema` | Get the full project JSON schema |
| `get_sizing_guide` | Get the sizing & layout tutorial |
| `create_project` | Save a generated project to a TUIFY instance (returns editor URL) |
| `render_app` | Save + publish a project in one call (returns live URL) |

---

## Setup

### 1. Install dependencies

```bash
cd docs-mcp
npm install
```

### 2. Configure in Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tuify": {
      "command": "node",
      "args": ["/absolute/path/to/TUI-builder/docs-mcp/server.js"]
    }
  }
}
```

### 3. Configure in Cursor

In Cursor settings → MCP → Add server:

```json
{
  "tuify": {
    "command": "node",
    "args": ["/absolute/path/to/TUI-builder/docs-mcp/server.js"]
  }
}
```

### 4. Configure in VS Code (with Copilot MCP extension)

Add to `.vscode/settings.json`:

```json
{
  "mcp.servers": {
    "tuify": {
      "command": "node",
      "args": ["${workspaceFolder}/docs-mcp/server.js"]
    }
  }
}
```

---

## Usage examples

Once configured, you can ask your AI tool:

> "Generate a TUIFY platformer game with 2 levels, a player, and coins — and deploy it to my TUIFY instance"

> "Create a TUIFY blog app with 3 screens and publish it live"

> "What props does the DataRepeater component accept?"

> "Build a login form screen using TUIFY components"

The AI will call `get_project_schema` + `list_components` to understand the format, generate valid project JSON, then call `render_app` to deploy it — returning a live URL in one conversation turn.

### Direct curl deploy

```bash
# Get your token: Settings → API tab → JWT TOKEN → Copy
curl -X POST https://tuify.app/api/publish/render \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "project": {...}, "slug": "my-game", "publishMode": "game" }'
```

See `tuify://tutorials/03-api-render` for the full reference.

---

## Adding documentation

- **New component spec:** Add a JSON file to `resources/components/YourComponent.json`
- **New tutorial:** Add a markdown file to `resources/tutorials/`
- **Schema updates:** Edit `resources/schemas/project.schema.json`

The server auto-discovers files in each directory — no code changes needed.
