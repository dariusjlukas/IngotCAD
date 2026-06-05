# CLAUDE.md

Guidance for AI agents working in this repo. See [README.md](README.md) for the
product overview and high-level architecture; this file focuses on how to work
here without breaking things.

**Ingot CAD** is a client-side, web-based CSG CAD tool for hobbyist 3D printing
(React 19 + TypeScript + Vite, three.js / React Three Fiber for the viewport,
and the Manifold WASM kernel for watertight geometry). There is no backend.

## Commands

```bash
npm run dev        # Vite dev server (http://localhost:5173)
npm run build      # tsc -b && vite build  (typecheck is part of the build)
npm run lint       # ESLint — MUST be clean (exit 0) before considering work done
npm run format     # Prettier — rewrite all files in place (no-semi, single-quote, width 100)
npm run format:check  # Prettier in check mode (no writes); use this in CI / to verify
npm test           # Vitest (run mode); colocated *.test.ts files
npm run preview    # serve the production build
```

Formatting config lives in [.prettierrc.json](.prettierrc.json). `eslint-config-prettier`
is the last entry in [eslint.config.js](eslint.config.js), so ESLint and Prettier don't
fight over style — Prettier owns formatting, ESLint owns code quality.

Always run **`npm run lint`** and **`npm test`** after changes, and `npm run
build` for anything touching types. The build's `tsc -b` is the typecheck gate.

## The linter (read this before "fixing" lint)

ESLint uses flat config ([eslint.config.js](eslint.config.js)) with
`eslint-plugin-react-hooks` **v7**, whose `flat.recommended` set includes the
strict react-compiler-aligned rules: `set-state-in-effect`, `immutability`,
`refs`, and `static-components`. These are aggressive and will flag some
legitimate, intentional patterns in this codebase (imperative three.js / R3F
control, refs holding the latest value, transient state reset on mode exit).

Rules of thumb:

- **Prefer fixing** over disabling. Most violations have a clean fix:
  - "Cannot create components during render" → hoist the component to module scope.
  - "Cannot access/update refs during render" → assign the ref in a
    `useEffect(() => { ref.current = x })`.
  - "Modifying a value returned from a hook" (R3F) → read state fresh inside the
    handler via `const get = useThree((s) => s.get)` then `get().controls`,
    instead of capturing the value at render time.
  - `set-state-in-effect` for "reset stale async data" → tag the async result
    with the id it describes and ignore mismatches at render time (see
    [src/ui/StatusBar.tsx](src/ui/StatusBar.tsx)) instead of clearing synchronously.
- A few genuinely-intentional spots use a justified
  `// eslint-disable-next-line <rule>` with a one-line reason (transient hover
  reset, preview-geometry cleanup, render-time DOM measurement for an overlay).
  Keep that bar high — disable only when a fix would harm working 3D/interaction
  code, and always include the reason.
- **New code must be lint-clean without disables.**

## Source layout

```
src/
  document/     CSG node tree (the data model), zustand store + undo, serialization, selectors
  engine/       the ONLY code that touches Manifold (WASM): evaluate + structural hashing/caching
  geometry/     pure conversions (Manifold <-> three.js) and transforms
  viewport/     React Three Fiber scene, per-node rendering, transform gizmo, viewport theming
  sketch/       2D constraint sketcher (solver) + the SVG sketch canvas and panels
  operation/    extrude/revolve live preview + confirm UI
  io/           STL/3MF export, STL import, project save/open, autosave, shared file commands
  preferences/  theme preference store (persisted) + theme resolution hooks
  ui/           menu bar, toolbar, outliner, property editor, status bar, timeline, dialogs, widgets
```

## Core invariants — don't break these

- **The document is the single source of truth.** It's plain serializable data;
  all geometry/rendering is _derived_. Don't store derived geometry in the doc.
- **All document edits go through `mutate`** in [src/document/store.ts](src/document/store.ts)
  (immer + `past`/`future` undo stacks). Selection and other transient state must
  NOT push undo history. `mutate`, `undo`, and `redo` set the `dirty` flag;
  `newDocument`/`loadDocument`/`markSaved` clear it.
- **Z-up, millimeters, degrees in the document.** The only coordinate/angle
  (deg↔rad) conversions live in [src/geometry/transform.ts](src/geometry/transform.ts).
- **Manifold memory is owned in one place** ([src/engine/](src/engine/)); the rest of
  the app sees only plain typed arrays.
- **60fps gizmo:** dragging mutates the three.js matrix imperatively and commits
  to the store once, on release (one undo step). Don't add per-frame store writes.
- **No React StrictMode** ([src/main.tsx](src/main.tsx)) — it's intentionally omitted because
  the viewport mixes imperative three.js/WASM with React. Don't re-enable it.

## Theming (light/dark)

- Semantic color tokens are defined in [src/index.css](src/index.css): light
  defaults in `@theme`, dark overrides in a `:root.dark` block. Tailwind emits
  the tokens to `:root` and utilities reference them via `var()`, so toggling the
  `.dark` class re-themes everything.
- **Components must use the semantic tokens** (`bg-panel`, `bg-surface`,
  `bg-elevated`, `text-fg` / `text-fg-muted` / `text-fg-faint` / `text-fg-strong`,
  `border-line` / `border-line-strong`, `bg-accent` / `hover:bg-accent-hover`,
  `bg-selection`, `text-danger`, `text-on-accent`, …) — **never** literal
  `neutral-*` / `blue-*` classes. Exception: identity/content colors stay literal
  (node `PALETTE`, gizmo axis colors, operation handle colors, the SVG sketch
  editor's own palette).
- The 3D viewport can't read CSS vars; its colors come from
  [src/viewport/viewportTheme.ts](src/viewport/viewportTheme.ts), keyed by the resolved theme.
- Preferences (theme, grid) persist via zustand `persist` under the localStorage
  key **`ingot-prefs`**. [index.html](index.html) has a tiny inline bootstrap
  script that reads that key and sets the theme class **before first paint** — if
  you change the persisted shape/key in
  [src/preferences/prefsStore.ts](src/preferences/prefsStore.ts), update that
  script too.

## Gotchas

- **CSS comments cannot contain `*/`** — e.g. writing `neutral-*/blue-*` inside a
  `/* … */` comment closes the comment early and silently corrupts the next rule
  (this previously dropped the light-theme tokens). Avoid `*/` sequences in CSS comments.
- Autosave (`io/autosave.ts`) mirrors the document to localStorage key
  `ingot-autosave`; an empty document clears it (so "New" wipes the slot).
- App-level file actions live in [src/io/commands.ts](src/io/commands.ts) so the
  menu bar and keyboard shortcuts share one path; export filenames derive from
  the document name via `projectFilename()`.

## Testing

Vitest with jsdom; tests are colocated (`*.test.ts`) and cover the data/geometry
layers (solver, serialization, transforms, evaluate, hashing, store actions).
There is a real Manifold pipeline test. UI is not unit-tested — verify UI changes
by running `npm run dev`.
