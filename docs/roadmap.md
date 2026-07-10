# Architecture roadmap

Status: written 2026-07-07, at the "MVP complete" mark (schema v2). Companion
documents: [design-associativity.md](design-associativity.md) (the headline
feature design) and [audit-2026-07-07.md](audit-2026-07-07.md) (33 verified
findings; the deferred ones are this file's nearest-term known issues).
This is a load-bearing-analysis document: where the current architecture will
strain first as the product grows, and the recommended order of attack. Items
are ranked by (user value × how much the fix hurts if deferred).

## 0. What to protect (the parts that are right)

The four invariants in [CLAUDE.md](../CLAUDE.md) — doc-as-plain-data, engine
as sole Manifold owner, structural-hash caching, one-undo-step-per-action —
are the reason this codebase is easy to work in. Every item below is designed
_around_ them; any proposal that weakens one should be presumed wrong until
proven otherwise. The same goes for the deliberate product stance: direct
modeling on a CSG tree, **not** a Fusion-style feature-history tree. The
timeline (`featureOrder`) is creation-order metadata, not a regeneration
program, and it should stay that way — a history tree is the single biggest
complexity cliff in CAD architecture and hobbyist printing doesn't need it.

## 1. Face associativity — the headline feature gap

Sketches and datum planes attached to faces are snapshots with stale
_detection_ only (manual rebind). The full design for making them follow
automatically — resolver pass, cache-key soundness, Manifold `originalID`
face identity, cycle handling — is in
[design-associativity.md](design-associativity.md). It's staged so each part
ships alone. **Do this before the features below that touch placement**
(anything new that stores a world snapshot of derived geometry adds migration
burden to the associativity work later).

## 2. Asset storage will fall over before anything else

`MeshAsset` typed arrays serialize as **plain JSON number arrays**
([serialization.ts](../src/document/serialization.ts)) and autosave mirrors
the whole document to **localStorage** (`ingot-autosave`, ~5 MB quota in most
browsers). A single imported 5 MB binary STL is ~100k triangles ≈ 300k floats
≈ 3–6 MB _of JSON_ — one medium import and autosave starts throwing
`QuotaExceededError` (or silently failing, depending on the browser), taking
crash recovery with it. Project save/open (a user-invoked file download) is
merely bloated; autosave is _broken_ at that size.

Recommended fix, in order:

1. Move autosave to **IndexedDB** (structured-clone stores typed arrays
   natively — no serialization at all, and the quota is effectively unlimited
   for this use). Keep localStorage only as a tiny "an autosave exists"
   pointer if the bootstrap needs synchronous access.
2. For `.ingot` project files, keep JSON for the tree but store asset buffers
   as base64 (≈33% overhead) or, better, adopt a zip container (JSON manifest
   - raw binary asset entries). The container also gives project thumbnails a
     home later. Migration is one version bump in `serialization.ts`, which
     already has the version plumbing.

This is unglamorous and should be done _soon_: it's user-data loss, the class
of bug that costs trust permanently, and it gets more likely as STL import
sees real use.

## 3. Sketch solver: keep the soul, add diagnostics

The relaxation solver ([solver.ts](../src/sketch/solver.ts)) is intentionally
forgiving: over-constrained sketches settle into a compromise instead of
erroring. For hobbyist CAD that's the right _interaction_ model — don't
replace it with a hard Newton solver that fails loudly mid-drag.

What it actually lacks, in the order users will notice:

1. **No constraint-state feedback.** Real CAD colors geometry by
   degrees-of-freedom (under-constrained / fully-constrained /
   over-constrained). This does _not_ require changing the solver: build the
   constraint Jacobian (each `Constraint` kind contributes rows; the
   projection functions already encode the gradients implicitly) and use its
   rank vs. the free-point DOF count, computed once per edit — not per frame.
   This is the highest-value solver investment and it's purely additive.
2. **Slow convergence on long chains.** Gauss-Seidel needs O(n²)-ish sweeps
   for a chain of n links; 160 iterations visibly lags for large sketches. If
   this bites, the fix is a **Newton/Levenberg-Marquardt "polish" pass on
   pointer-release only** (drag keeps relaxation for stability, release snaps
   to machine-precision satisfaction). Additive again — same constraint
   definitions, second consumer.
3. Known relaxation quirks to keep on the radar (candidates for targeted
   tests rather than redesign): constraint pairs that fight (`tangent` vs
   `radius` on the same arc), oscillation under `ROT_RELAX` with contradictory
   angle constraints, and NaN sources in degenerate configurations
   (zero-length segments — `distance()` already guards, others should match).

## 4. Engine scaling: cancellation before parallelism

The worker pipeline ([requestQueue.ts](../src/engine/requestQueue.ts),
[workerClient.ts](../src/engine/workerClient.ts)) serializes evaluations. The
strain shows as: drag a dimension slider on a heavy model and evaluations
queue up behind a stale one you no longer want.

- First: **generation-tagged cancellation** — when a newer evaluation for the
  same root arrives, drop the queued older one (cheap, protocol-level) and
  let in-flight results for superseded generations be discarded on arrival.
  Much of the perceived slowness on heavy models is _stale work_, not slow
  work.
- Then: **quality tiers** — Manifold cost is dominated by segment counts
  (`cylinder.segments`, `SHELL_BALL_SEGMENTS` in
  [evaluate.ts](../src/engine/evaluate.ts)). An interactive-drag tier with
  halved segments, swapped for the full-quality result on release, keeps 60fps
  honesty without touching the cache model (tier is part of the request, so
  hash separation is free).
- Only after both: consider a worker pool. Parallelism is the least valuable
  of the three because per-root evaluation is already cached and most edits
  touch one root.

## 5. Interoperability: STEP import is feasible, STEP export is not

- **STEP import** (the #1 hobbyist ask after STL): viable fully client-side
  via an OCCT-based WASM tessellator (e.g. `occt-import-js`, ~10 MB WASM,
  lazy-load on first use). It yields a _mesh_, which drops into the existing
  `mesh` primitive + `MeshAsset` path untouched. Requires item 2 (asset
  storage) first — STEP-derived meshes are exactly the large assets that
  break autosave today.
- **STEP export** means reconstructing B-rep from a CSG tree — a
  kernel-scale project. Don't. The honest print-shop answer is watertight STL
  /3MF (already done) plus, someday, the original `.ingot` file as the
  editable artifact.
- Nearer-term export wins: per-object color in 3MF (slicers read it; the
  document already stores `node.color`), and multi-body export (one mesh per
  root instead of one union) for multi-material printing.

## 6. Print-plate niceties (cheap, high hobbyist value)

The build-volume overlay already knows the printer bed. Small additions that
compound: lay-flat (rotate selected so a picked face sits on Z=0 — the face
math exists in [faceRef.ts](../src/document/faceRef.ts)/
[edges.ts](../src/geometry/edges.ts)), auto-arrange roots on the plate
(2D bin-packing of bounding boxes), and a printability heads-up (minimum wall
< nozzle width, unsupported overhang angle) computed from the evaluated mesh
in the worker. None of these touch the document model.

## 7. Testing posture

The unit layer is genuinely good (solver, transforms, evaluate, hashing,
store). The two gaps that will bite, in order:

1. **Property-based tests for the cache spine**: `hash.ts` equality must
   track geometry equality through randomized edit sequences (see the
   associativity doc §5 for why this becomes existential once placement is
   derived).
2. **A headless smoke test of the full pipeline** (jsdom + real Manifold WASM
   already works in vitest — `evaluate.test.ts` proves it): document in →
   mesh out → STL bytes parse back watertight. One test, catches the class of
   "every layer fine, wiring broken" regressions the unit layer can't.

UI stays manually verified; that's the right trade for a solo project until
interaction bugs start recurring, at which point a thin Playwright pass over
the toolbar flows (sketch → extrude → export) pays for itself.

## Suggested order

| #   | Item                                     | Why this position                                              |
| --- | ---------------------------------------- | -------------------------------------------------------------- |
| 1   | Asset storage / autosave (§2)            | data-loss class; blocks STEP import; small                     |
| 2   | Engine cancellation + quality tiers (§4) | perceived performance; small, self-contained                   |
| 3   | Associativity Stage A (§1)               | headline capability; everything placement-related builds on it |
| 4   | Solver DOF feedback (§3.1)               | biggest sketching-trust win; additive                          |
| 5   | Associativity Stage B (§1)               | makes #3 trustworthy at scale                                  |
| 6   | STEP import (§5)                         | big draw; unblocked by #1                                      |
| 7   | Print-plate niceties (§6)                | steady small wins, any time                                    |
