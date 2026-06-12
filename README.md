# Ingot-CAD

An open-source, **web-based 3D CAD program for hobbyist 3D printing**. Model
right in the browser — no install, no account, no paywall — with primitive
shapes and boolean operations, then export a **watertight, print-ready** STL or
3MF. It runs entirely client-side.

> Status: MVP
> A desktop (offline) build is planned for later.
> Live demo: [https://dariusjlukas.github.io/IngotCAD/](https://dariusjlukas.github.io/IngotCAD/)

## Why

Most hobbyists who want to model functional parts for 3D printing either pay for
commercial tools or install heavy desktop software. Ingot-CAD aims for the
"good enough, zero-friction" middle: open it in a tab, build a part, print it.
Because every solid is evaluated by the [Manifold](https://github.com/elalish/manifold)
geometry kernel, **what you see is watertight by construction** — no
non-manifold surprises at slice time.

## Features (MVP)

- **Primitives** — box, cylinder, sphere, with editable dimensions (mm).
- **Direct manipulation** — move / rotate / scale gizmos (`W` / `E` / `R`),
  plus precise numeric entry in the property panel.
- **Booleans** — union, subtract, intersect; plus TinkerCAD-style **groups**
  where any child can be flagged as a **hole** (cut).
- **Patterns** — linear, circular, and mirror arrays (bolt circles, vent slots,
  repeated mounting holes). Parametric: the source stays editable and the array
  follows.
- **Mirror** — reflect a whole solid across a plane, or mirror geometry inside a
  sketch — symmetry without redrawing.
- **Shell / hollow** — turn a solid into a wall of a given thickness for
  enclosures, lids, and weight reduction, with an optional open top.
- **3D text** — extruded labels from a built-in font (knob/bin labels, name
  tags); counters in letters like A/O/e come out hollow.
- **Build volume** — optional printer-bed overlay with an out-of-bounds fit
  warning and a live model-size readout; the printer size is a setting.
- **Outliner** — object tree with selection, rename, color, visibility.
- **Undo / redo** — every edit, including a full gizmo drag, is one step.
- **Import** STL · **Export** watertight STL and 3MF.
- **Save / open** projects as JSON.
- **Installable PWA** — works offline once loaded.
- **Z-up, millimeters** everywhere — matches how slicers think.

## Tech stack

React 19 · TypeScript · Vite · three.js + React Three Fiber + drei ·
[Manifold](https://github.com/elalish/manifold) (WASM CSG kernel) · Zustand ·
Tailwind CSS.

## Architecture

The CAD document is **plain, serializable data** — the single source of truth.
Everything visible (Manifold solids, three.js geometry, the rendered scene) is
_derived_ from it.

```
src/
  document/   data model (CSG node tree), zustand store, undo, serialization
  engine/     the ONLY code that touches Manifold; evaluation + hashing
  geometry/   pure conversions (Manifold <-> three.js) and transforms
  viewport/   React Three Fiber scene, per-node rendering, transform gizmo
  text/       font -> 2D glyph-contour tessellation for the text tool
  ui/         toolbar, outliner, property editor, status bar
  io/         STL/3MF export, STL import, project save/open
```

Key design decisions:

- **Node tree, normalized flat map.** Each object is a `primitive`, `group`, or
  `boolean` node. Stored as `Record<id, node>` for O(1) edits and small undo diffs.
- **Manifold owns its memory in one place** (`engine/evaluate.ts`); the rest of
  the app only ever sees plain typed arrays, which keeps a future Web Worker move
  to a one-file change.
- **Recompute only what changed.** Geometry is keyed by a structural hash of the
  subtree; moving a root changes its transform but not its geometry, so it never
  rebuilds. Editing one object never rebuilds the others.
- **60fps gizmo.** Dragging mutates the three.js matrix imperatively — no store
  write, no Manifold call — and commits to the document once, on release.
- **Z-up + mm, degrees in the document.** The only coordinate/angle conversion
  (degrees <-> radians) lives in `geometry/transform.ts`.

## Develop

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the production build
npm test          # Vitest (includes a real Manifold pipeline test)
```

## Roadmap

- Sketch-on-plane -> extrude; fillet / chamfer (needs the OpenCASCADE path).
- Measurement tools, alignment/snapping helpers.
- Web Worker geometry evaluation for large models.
- Desktop build (Tauri) for native file access and offline-first.

## License

[Apache-2.0](./LICENSE).

Built with [Manifold](https://github.com/elalish/manifold) (Apache-2.0),
[three.js](https://threejs.org) (MIT), and the
[React Three Fiber](https://github.com/pmndrs/react-three-fiber) ecosystem.
