/** Maps the document's top-level nodes to rendered objects. */
import { rootOf, useCadStore } from '../document/store'
import { useOperationStore } from '../operation/operationStore'
import { NodeView } from './NodeView'

export function CadScene() {
  const rootIds = useCadStore((s) => s.doc.rootIds)
  // While a sketch-on-object extrude/revolve previews its union/subtract result,
  // hide the source object's root — OperationPreview renders the combined result
  // (e.g. the body with the cut) in its place.
  const previewSource = useOperationStore((s) =>
    s.pending && s.pending.sourceNodeId && s.pending.combine !== 'new'
      ? s.pending.sourceNodeId
      : null,
  )
  const hiddenRoot = useCadStore((s) => (previewSource ? rootOf(s.doc, previewSource) : null))
  return <>{rootIds.map((id) => (id === hiddenRoot ? null : <NodeView key={id} id={id} />))}</>
}
