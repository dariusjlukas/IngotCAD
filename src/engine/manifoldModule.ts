/**
 * Loads the Manifold WASM module exactly once, behind a shared promise.
 *
 * The `?url` import hands Vite the hashed asset URL for the .wasm file so it is
 * emitted and served correctly in both dev and production builds; we feed it to
 * Emscripten via `locateFile`.
 */
import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import type { ManifoldToplevel } from 'manifold-3d'

let modulePromise: Promise<ManifoldToplevel> | null = null

export function loadManifold(): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    modulePromise = Module({ locateFile: () => wasmUrl }).then((wasm) => {
      wasm.setup()
      return wasm
    })
  }
  return modulePromise
}
