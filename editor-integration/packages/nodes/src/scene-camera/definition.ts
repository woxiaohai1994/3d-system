import { type NodeDefinition, SceneCameraNode } from '@pascal-app/core'

export const sceneCameraDefinition: NodeDefinition<typeof SceneCameraNode> = {
  kind: 'scene-camera',
  schema: SceneCameraNode,
  schemaVersion: 6,
  extensions: {
    'pascal:node-reference-paths': [
      ['rig', 'target', 'nodeId'],
      ['rig', 'focus', 'target', 'nodeId'],
      ['motion', 'objects', '*', 'nodeId'],
      ['motion', 'objects', '*', 'parentId'],
      ['motion', 'segments', '*', 'target', 'nodeId'],
      ['motion', 'segments', '*', 'center', 'nodeId'],
      ['motion', 'points', '*', 'rig', 'target', 'nodeId'],
      ['motion', 'points', '*', 'rig', 'focus', 'target', 'nodeId'],
    ],
  },
  bake: 'strip',
  category: 'structure',
  dirtyTracking: false,
  defaults: () => SceneCameraNode.parse({}),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    presettable: false,
    surfaces: { hosting: false },
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  rendersChildren: false,
  parametrics: { groups: [], customPanel: () => import('./panel') },
  floorplan: (node) => ({
    kind: 'group',
    transform: { translate: [node.position[0], node.position[2]], rotate: -node.rotation[1] },
    children: [
      {
        kind: 'path',
        d: 'M -0.25 0.2 L 0.25 0.2 L 0.25 -0.2 L -0.25 -0.2 Z M 0 0 L -0.7 -1.1 L 0.7 -1.1 Z',
        stroke: '#38bdf8',
        fill: '#0c4a6e',
        strokeWidth: 2,
        vectorEffect: 'non-scaling-stroke',
      },
    ],
  }),
  presentation: {
    label: 'Camera',
    description: 'Independent camera with live view, lens controls and a video timeline.',
    icon: { kind: 'iconify', name: 'lucide:camera' },
    hidden: true,
  },
}
