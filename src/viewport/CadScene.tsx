/** Maps the document's top-level nodes to rendered objects. */
import { useCadStore } from '../document/store'
import { NodeView } from './NodeView'

export function CadScene() {
  const rootIds = useCadStore((s) => s.doc.rootIds)
  return (
    <>
      {rootIds.map((id) => (
        <NodeView key={id} id={id} />
      ))}
    </>
  )
}
