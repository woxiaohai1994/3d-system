import {
  type AnyNode,
  type AnyNodeId,
  BoxVentNode,
  BuildingNode,
  CeilingNode,
  ChimneyNode,
  CupolaNode,
  cloneLevelSubtree,
  DoorNode,
  DormerNode,
  DownspoutNode,
  DuctFittingNode,
  DuctSegmentNode,
  DuctTerminalNode,
  ElevatorNode,
  EyebrowVentNode,
  FenceNode,
  GuideNode,
  GutterNode,
  generateId,
  HvacEquipmentNode,
  ItemNode,
  LevelNode,
  LinesetNode,
  LiquidLineNode,
  PipeFittingNode,
  PipeSegmentNode,
  PipeTrapNode,
  RidgeVentNode,
  RoofNode,
  RoofSegmentNode,
  ScanNode,
  SkylightNode,
  SlabNode,
  SolarPanelNode,
  StairNode,
  StairSegmentNode,
  TurbineVentNode,
  WallNode as WallSchema,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import { resolveCurrentBuildingId, resolveElevatorSupportY } from '../../../lib/elevator-support'
import type {
  ValidatedAddBuilding,
  ValidatedAddCeiling,
  ValidatedAddCutOut,
  ValidatedAddDuctFitting,
  ValidatedAddDuctSegment,
  ValidatedAddDuctTerminal,
  ValidatedAddElevator,
  ValidatedAddFence,
  ValidatedAddGuide,
  ValidatedAddHvacEquipment,
  ValidatedAddLevel,
  ValidatedAddLineset,
  ValidatedAddLiquidLine,
  ValidatedAddPipeFitting,
  ValidatedAddPipeSegment,
  ValidatedAddPipeTrap,
  ValidatedAddRoof,
  ValidatedAddScan,
  ValidatedAddSlab,
  ValidatedAddStair,
  ValidatedAddZone,
  ValidatedAlignOpeningToNearest,
  ValidatedCloneLevel,
  ValidatedMoveBuilding,
  ValidatedOperation,
  ValidatedUpdateCeiling,
  ValidatedUpdateFence,
  ValidatedUpdateItem,
  ValidatedUpdateRoof,
  ValidatedUpdateRoofMaterial,
  ValidatedUpdateSite,
  ValidatedUpdateSlab,
  ValidatedUpdateStair,
  ValidatedUpdateStairMaterial,
  ValidatedUpdateWallMaterial,
  ValidatedUpdateZone,
} from '../types'
import { stripTransientMetadata } from './ghost-node-helpers'
import { createMutationDraft } from './mutation-draft'

/**
 * Build a partial scene node update that sets either a material catalog preset
 * or an inline color material on the requested fields. Returns null when no
 * source value is provided.
 *
 * Catalog preset takes precedence over inline color when both are present.
 *
 * NOTE: MaterialSchema is { id?, preset?, properties?, texture? } — `color`
 * lives under `properties.color`, NOT at the top level. resolveMaterial() reads
 * material.properties, so writing `{ color }` directly is silently dropped.
 */
/** Whitelist of node fields that surface material writes are allowed to touch. */
type SurfaceMaterialField =
  | 'material'
  | 'materialPreset'
  | 'interiorMaterial'
  | 'interiorMaterialPreset'
  | 'exteriorMaterial'
  | 'exteriorMaterialPreset'
  | 'topMaterial'
  | 'topMaterialPreset'
  | 'edgeMaterial'
  | 'edgeMaterialPreset'
  | 'wallMaterial'
  | 'wallMaterialPreset'
  | 'railingMaterial'
  | 'railingMaterialPreset'
  | 'treadMaterial'
  | 'treadMaterialPreset'
  | 'sideMaterial'
  | 'sideMaterialPreset'

function applySurfaceMaterialUpdate(input: {
  preset?: string
  color?: string
  presetField: SurfaceMaterialField
  materialField: SurfaceMaterialField
}): Record<string, unknown> | null {
  const { preset, color, presetField, materialField } = input
  if (preset) {
    return {
      [presetField]: preset,
      [materialField]: undefined,
    }
  }
  if (color) {
    return {
      [presetField]: undefined,
      [materialField]: { properties: { color } },
    }
  }
  return null
}

export function buildMutationCommands(
  operations: ValidatedOperation[],
  source: Record<AnyNodeId, AnyNode>,
  levelId: `level_${string}` | null,
) {
  const draft = createMutationDraft(source)
  const nodes = draft.nodes
  const affectedNodeIds: AnyNodeId[] = []
  const createdNodeIds: AnyNodeId[] = []
  let selectedLevelId = levelId
  const getCachedTypeCount = (type: string) =>
    Object.values(nodes).filter((node) => node.type === type).length
  const batchCreates: { node: AnyNode; parentId: AnyNodeId }[] = []
  for (const op of operations) {
    if (op.status === 'invalid') continue

    switch (op.type) {
      case 'plugin_action': {
        for (const command of op.commands) {
          if (command.op === 'create') {
            draft.createNode(command.node, command.parentId)
            createdNodeIds.push(command.node.id)
            affectedNodeIds.push(command.node.id)
          } else {
            draft.updateNode(command.id, command.data)
            affectedNodeIds.push(command.id)
          }
        }
        break
      }
      case 'add_item': {
        if (!op.asset) break
        const finalNode = ItemNode.parse({
          name: op.asset.name,
          asset: op.asset,
          position: op.position,
          rotation: op.rotation,
        })
        batchCreates.push({ node: finalNode, parentId: (op.levelId ?? levelId) as AnyNodeId })
        affectedNodeIds.push(finalNode.id as AnyNodeId)
        createdNodeIds.push(finalNode.id as AnyNodeId)
        break
      }
      case 'add_wall': {
        const wallCount = getCachedTypeCount('wall')
        const wall = WallSchema.parse({
          name: `Wall ${wallCount + 1}`,
          start: op.start,
          end: op.end,
          ...(op.thickness !== 0.2 ? { thickness: op.thickness } : {}),
          ...(op.height ? { height: op.height } : {}),
          ...(op.curveOffset !== undefined ? { curveOffset: op.curveOffset } : {}),
        })
        batchCreates.push({ node: wall, parentId: (op.levelId ?? levelId) as AnyNodeId })
        affectedNodeIds.push(wall.id as AnyNodeId)
        createdNodeIds.push(wall.id as AnyNodeId)
        break
      }
      case 'add_door': {
        const door = DoorNode.parse({
          position: [op.localX, op.localY, 0],
          rotation: [0, 0, 0],
          side: op.side,
          wallId: op.wallId,
          parentId: op.wallId,
          width: op.width,
          height: op.height,
          hingesSide: op.hingesSide,
          swingDirection: op.swingDirection,
        })
        batchCreates.push({ node: door, parentId: op.wallId })
        affectedNodeIds.push(door.id as AnyNodeId)
        createdNodeIds.push(door.id as AnyNodeId)
        break
      }
      case 'add_window': {
        const window = WindowNode.parse({
          position: [op.localX, op.localY, 0],
          rotation: [0, 0, 0],
          side: op.side,
          wallId: op.wallId,
          parentId: op.wallId,
          width: op.width,
          height: op.height,
        })
        batchCreates.push({ node: window, parentId: op.wallId })
        affectedNodeIds.push(window.id as AnyNodeId)
        createdNodeIds.push(window.id as AnyNodeId)
        break
      }
      case 'remove_item':
      case 'remove_node': {
        // Skip silently if an earlier op in this batch already cascade-removed
        // the target. The AI often enumerates parents (walls) AND their
        // children (windows, doors) explicitly in a "clear" intent; with
        // cascade=true the parent delete sweeps the children out, and the
        // child-delete iterations below would otherwise throw "node not
        // found" and abort the whole batch. The user's intent is satisfied
        // either way, so no-op is correct.
        const liveNodes = draft.nodes
        if (!liveNodes[op.nodeId]) {
          break
        }
        // Restore the node first (it was hidden during preview), then delete it.
        // cascade=true because the AI's remove ops typically target a parent
        // (wall, level, building) that owns children (windows, slabs); without
        // cascade the scene bridge guard throws "node has N descendant(s);
        // pass cascade: true to delete recursively" and the whole confirm
        // batch fails. The AI flow is a considered batch — recursive removal
        // is the intended semantics, unlike the panel-level single-delete UX
        // where the user gets warned about children first.
        draft.deleteNode(op.nodeId, true)
        affectedNodeIds.push(op.nodeId)
        break
      }
      case 'move_item': {
        draft.moveItem(op.nodeId, op.position, op.rotation, op.levelId)
        affectedNodeIds.push(op.nodeId)
        break
      }
      case 'paint_slot': {
        const node = nodes[op.nodeId]
        if (!node) throw new Error('MISSING_NODE')
        const slots = { ...('slots' in node ? node.slots : {}) }
        if (op.materialRef) slots[op.slotId] = op.materialRef
        else delete slots[op.slotId]
        draft.updateNode(op.nodeId, { slots })
        break
      }
      case 'update_material': {
        // Restore original, then apply material to the node's `material` field.
        // The `material` field is the legacy single-face slot present on every
        // structural/furniture node. For per-side/per-role materials use the
        // dedicated update_wall_material/update_roof_material/update_stair_material
        // tools instead.
        // Decide preset vs inline color: catalog ids never start with '#' and are
        // resolvable by getCatalogMaterialById, hex colors always start with '#'.
        // Accept only canonical hex lengths (3/4/6/8) — bare 5/7-char hex isn't valid CSS.
        const isHexColor =
          typeof op.material === 'string' &&
          /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(op.material)
        const materialUpdate: Record<string, unknown> = isHexColor
          ? { materialPreset: undefined, material: { properties: { color: op.material } } }
          : { material: undefined, materialPreset: op.material }
        draft.updateNode(op.nodeId, {
          metadata: stripTransientMetadata(nodes[op.nodeId]?.metadata) as Record<string, never>,
          ...materialUpdate,
        })
        affectedNodeIds.push(op.nodeId)
        break
      }
      case 'update_wall': {
        const updates: Record<string, unknown> = {
          metadata: stripTransientMetadata(nodes[op.nodeId]?.metadata) as Record<string, never>,
        }
        if (op.height !== undefined) updates.height = op.height
        if (op.thickness !== undefined) updates.thickness = op.thickness
        if (op.start) updates.start = op.start
        if (op.end) updates.end = op.end
        if (op.curveOffset !== undefined) updates.curveOffset = op.curveOffset
        draft.updateNode(op.nodeId, updates)
        affectedNodeIds.push(op.nodeId)

        // Symmetric to validateAddCeiling's R3 rule ("ceiling height matches wall height"):
        // when a wall's height changes, propagate to every ceiling on the same level so
        // the room volume stays consistent. Caught by QA-AI 2026-05-01 v3 Issue-C.
        if (op.height !== undefined) {
          const wallNode = nodes[op.nodeId] as { parentId?: string } | undefined
          const levelId = wallNode?.parentId
          if (levelId) {
            for (const [id, n] of Object.entries(nodes)) {
              if (
                n &&
                (n as { type?: string }).type === 'ceiling' &&
                (n as { parentId?: string }).parentId === levelId
              ) {
                const currentHeight = (n as { height?: number }).height
                if (currentHeight !== op.height) {
                  draft.updateNode(id as AnyNodeId, { height: op.height })
                  affectedNodeIds.push(id as AnyNodeId)
                }
              }
            }
          }
        }
        break
      }
      case 'update_door':
      case 'update_window': {
        const dwUpdates: Record<string, unknown> = {
          metadata: stripTransientMetadata(nodes[op.nodeId]?.metadata) as Record<string, never>,
        }
        if (op.width !== undefined) dwUpdates.width = op.width
        if (op.height !== undefined) dwUpdates.height = op.height
        if ('localX' in op && op.localX !== undefined) {
          const pos = (nodes[op.nodeId] as { position?: number[] })?.position ?? [0, 0, 0]
          dwUpdates.position = [op.localX, pos[1], 0]
        }
        if ('localY' in op && op.localY !== undefined) {
          const pos = (nodes[op.nodeId] as { position?: number[] })?.position ?? [0, 0, 0]
          dwUpdates.position = [pos[0], op.localY, 0]
        }
        if ('side' in op && op.side !== undefined) dwUpdates.side = op.side
        if ('hingesSide' in op && op.hingesSide !== undefined) dwUpdates.hingesSide = op.hingesSide
        if ('swingDirection' in op && op.swingDirection !== undefined)
          dwUpdates.swingDirection = op.swingDirection
        draft.updateNode(op.nodeId, dwUpdates)
        affectedNodeIds.push(op.nodeId)
        break
      }
      case 'add_level': {
        const levelOp = op as ValidatedAddLevel
        // Validate buildingId. AI tools occasionally pass a stale or
        // missing buildingId, which previously created a level with
        // parentId=null (an orphan) — invisible in the level selector
        // and a source of stacking bugs. Fall back to the first building.
        let targetBuildingId = levelOp.buildingId
        const target = nodes[targetBuildingId]
        if (!target || target.type !== 'building') {
          const fallback = Object.values(nodes).find((n) => n.type === 'building') as
            | BuildingNode
            | undefined
          if (!fallback) {
            console.warn('[add_level] No building exists in scene; skipping operation')
            break
          }
          console.warn(
            `[add_level] buildingId ${levelOp.buildingId} not found, falling back to ${fallback.id}`,
          )
          targetBuildingId = fallback.id
        }
        const levelNode = LevelNode.parse({
          name: levelOp.name ?? `Level ${levelOp.level}`,
          level: levelOp.level,
        })
        draft.createNode(levelNode, targetBuildingId)
        affectedNodeIds.push(levelNode.id as AnyNodeId)
        createdNodeIds.push(levelNode.id as AnyNodeId)
        // Auto-switch to the new level
        selectedLevelId = levelNode.id
        break
      }
      case 'add_slab': {
        const slabOp = op as ValidatedAddSlab
        const slabNode = SlabNode.parse({
          name: `Slab ${getCachedTypeCount('slab') + 1}`,
          polygon: slabOp.polygon,
          elevation: slabOp.elevation,
          holes: slabOp.holes,
        })
        draft.createNode(slabNode, (slabOp.levelId ?? levelId) as AnyNodeId)
        affectedNodeIds.push(slabNode.id as AnyNodeId)
        createdNodeIds.push(slabNode.id as AnyNodeId)
        break
      }
      case 'update_slab': {
        const uSlabOp = op as ValidatedUpdateSlab
        const updates: Record<string, unknown> = {}
        if (uSlabOp.elevation !== undefined) updates.elevation = uSlabOp.elevation
        if (uSlabOp.polygon) updates.polygon = uSlabOp.polygon
        draft.updateNode(uSlabOp.nodeId, updates)
        affectedNodeIds.push(uSlabOp.nodeId)
        break
      }
      case 'add_ceiling': {
        const ceilOp = op as ValidatedAddCeiling
        const ceilNode = CeilingNode.parse({
          name: `Ceiling ${getCachedTypeCount('ceiling') + 1}`,
          polygon: ceilOp.polygon,
          height: ceilOp.height,
          ...(ceilOp.material ? { material: ceilOp.material } : {}),
        })
        draft.createNode(ceilNode, (ceilOp.levelId ?? levelId) as AnyNodeId)
        affectedNodeIds.push(ceilNode.id as AnyNodeId)
        createdNodeIds.push(ceilNode.id as AnyNodeId)
        break
      }
      case 'update_ceiling': {
        const uCeilOp = op as ValidatedUpdateCeiling
        const updates: Record<string, unknown> = {}
        if (uCeilOp.height !== undefined) updates.height = uCeilOp.height
        if (uCeilOp.material) updates.material = uCeilOp.material
        draft.updateNode(uCeilOp.nodeId, updates)
        affectedNodeIds.push(uCeilOp.nodeId)
        break
      }
      case 'add_roof': {
        const roofOp = op as ValidatedAddRoof
        const roofCount = getCachedTypeCount('roof')
        const segment = RoofSegmentNode.parse({
          width: roofOp.width,
          depth: roofOp.depth,
          roofType: roofOp.roofType,
          roofHeight: roofOp.roofHeight,
          wallHeight: roofOp.wallHeight,
          overhang: roofOp.overhang,
          position: [0, 0, 0],
        })
        const roof = RoofNode.parse({
          name: `Roof ${roofCount + 1}`,
          position: roofOp.position,
          children: [segment.id],
        })
        const { createNodes } = draft
        createNodes([
          { node: roof, parentId: (roofOp.levelId ?? levelId) as AnyNodeId },
          { node: segment, parentId: roof.id as AnyNodeId },
        ])
        affectedNodeIds.push(roof.id as AnyNodeId, segment.id as AnyNodeId)
        createdNodeIds.push(roof.id as AnyNodeId, segment.id as AnyNodeId)
        break
      }
      case 'add_roof_accessory': {
        // biome-ignore lint/suspicious/noExplicitAny: type imported lazily
        const accOp = op as any
        const kindCount = getCachedTypeCount(accOp.kind)
        const name = `${accOp.kind.charAt(0).toUpperCase()}${accOp.kind.slice(1)} ${kindCount + 1}`
        let node: AnyNode
        switch (accOp.kind) {
          case 'chimney':
            node = ChimneyNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              width: accOp.width,
              depth: accOp.depth,
              heightAboveRidge: accOp.heightAboveRidge ?? 1.0,
            })
            break
          case 'dormer':
            node = DormerNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              width: accOp.width,
              depth: accOp.depth,
            })
            break
          case 'skylight':
            node = SkylightNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              width: accOp.width,
              depth: accOp.depth,
            })
            break
          case 'solar-panel':
            node = SolarPanelNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              width: accOp.width,
              depth: accOp.depth,
            })
            break
          case 'ridge-vent':
            node = RidgeVentNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              width: accOp.width,
              depth: accOp.depth,
            })
            break
          case 'box-vent':
            node = BoxVentNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              width: accOp.width,
              depth: accOp.depth,
            })
            break
          case 'turbine-vent':
            // Schema has no width/depth — the unified tool's `width` carries
            // the spinning head diameter (radially symmetric, depth ignored).
            node = TurbineVentNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              diameter: accOp.width,
            })
            break
          case 'eyebrow-vent':
            node = EyebrowVentNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              width: accOp.width,
              depth: accOp.depth,
            })
            break
          case 'cupola':
            node = CupolaNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              width: accOp.width,
              depth: accOp.depth,
            })
            break
          case 'gutter':
            // position/rotation arrive eave-snapped from the validator (same
            // pose the manual tool in packages/nodes/src/gutter/tool.tsx stores).
            node = GutterNode.parse({
              name,
              roofSegmentId: accOp.roofSegmentId,
              position: accOp.position,
              rotation: accOp.rotation,
              length: accOp.length ?? 2.0,
            })
            break
          case 'downspout': {
            // Mirror packages/nodes/src/downspout/tool.tsx: drill a new outlet
            // into the host gutter at the requested offset, then drop a
            // downspout linked to it. Read the gutter LIVE (not the snapshot)
            // so several downspouts on one gutter in a single batch accumulate
            // outlets instead of overwriting each other.
            const state = draft
            const gutter = state.nodes[accOp.gutterId as AnyNodeId]
            if (!gutter || gutter.type !== 'gutter') continue
            const outletId = generateId('outlet')
            const outlets = [
              ...(gutter.outlets ?? []),
              { id: outletId, offset: accOp.outletOffset ?? 0, diameter: 0.07 },
            ]
            state.updateNode(gutter.id as AnyNodeId, { outlets })

            affectedNodeIds.push(gutter.id as AnyNodeId)
            node = DownspoutNode.parse({
              name,
              gutterId: gutter.id,
              outletId,
              length: accOp.length ?? 2.5,
              diameter: 0.07,
            })
            break
          }
          default:
            // 防御性：validator 已挡住 unknown kind，理论不会到这
            continue
        }
        batchCreates.push({ node, parentId: accOp.roofSegmentId as AnyNodeId })
        affectedNodeIds.push(node.id as AnyNodeId)
        createdNodeIds.push(node.id as AnyNodeId)
        break
      }
      case 'add_elevator': {
        const elOp = op as ValidatedAddElevator
        // Resolve the target building from explicit op.buildingId, otherwise
        // from the active level. ElevatorNode lives under building (not level)
        // because the shaft crosses multiple levels.
        const targetBuildingId = resolveCurrentBuildingId({
          buildingId: (elOp.buildingId as BuildingNode['id'] | null | undefined) ?? null,
          levelId: (levelId ?? null) as LevelNode['id'] | null,
          nodes,
        })
        if (!targetBuildingId) {
          // No building to attach to — skip silently rather than crash. The
          // operation card will show this as a no-op; the LLM will see no
          // elevator appear in the next scene context and can retry.
          break
        }

        // Resolve service range. fromLevelId defaults to the currently selected
        // level; toLevelId defaults to the level above (sorted by level number).
        const building = nodes[targetBuildingId]
        const levels = (building && building.type === 'building' ? building.children : [])
          .map((id) => nodes[id as AnyNodeId])
          .filter((n): n is LevelNode => n?.type === 'level')
          .sort((a, b) => a.level - b.level)
        const explicitFrom = elOp.fromLevelId ?? null
        const fromIdx = explicitFrom
          ? levels.findIndex((l) => l.id === explicitFrom)
          : levels.findIndex((l) => l.id === levelId)
        const fromLevel = levels[fromIdx >= 0 ? fromIdx : 0]
        const toIdx = elOp.toLevelId
          ? levels.findIndex((l) => l.id === elOp.toLevelId)
          : Math.min((fromIdx >= 0 ? fromIdx : 0) + 1, levels.length - 1)
        const toLevel = levels[toIdx >= 0 ? toIdx : levels.length - 1] ?? fromLevel

        const supportY = resolveElevatorSupportY({
          buildingId: targetBuildingId,
          preferredLevelId: fromLevel?.id ?? null,
          x: elOp.position[0],
          z: elOp.position[2],
        })

        const elevatorCount = Object.values(nodes).filter((n) => n.type === 'elevator').length
        const elevator = ElevatorNode.parse({
          name: `Elevator ${elevatorCount + 1}`,
          parentId: targetBuildingId,
          position: [elOp.position[0], supportY, elOp.position[2]],
          rotation: elOp.rotation,
          width: elOp.width,
          depth: elOp.depth,
          cabHeight: elOp.cabHeight,
          fromLevelId: fromLevel?.id ?? null,
          toLevelId: toLevel?.id ?? fromLevel?.id ?? null,
          defaultLevelId: fromLevel?.id ?? null,
          ...(elOp.servedLevelIds ? { servedLevelIds: elOp.servedLevelIds } : {}),
          ...(elOp.shaftStyle ? { shaftStyle: elOp.shaftStyle } : {}),
          ...(elOp.doorStyle ? { doorStyle: elOp.doorStyle } : {}),
          ...(elOp.doorPanelStyle ? { doorPanelStyle: elOp.doorPanelStyle } : {}),
        })
        const { createNodes } = draft
        createNodes([{ node: elevator, parentId: targetBuildingId }])
        affectedNodeIds.push(elevator.id as AnyNodeId)
        createdNodeIds.push(elevator.id as AnyNodeId)
        break
      }
      case 'add_stair': {
        const stairOp = op as ValidatedAddStair
        const stairCount = getCachedTypeCount('stair')
        // Curved/spiral stairs use container-level geometry only and ignore segments —
        // creating one would be dead state. Only straight stairs need a segment child.
        const isStraight = !stairOp.stairType || stairOp.stairType === 'straight'
        const segment = isStraight
          ? StairSegmentNode.parse({
              segmentType: 'stair',
              width: stairOp.width,
              length: stairOp.length,
              height: stairOp.height,
              stepCount: stairOp.stepCount,
              attachmentSide: 'front',
              fillToFloor: stairOp.fillToFloor ?? true,
              position: [0, 0, 0],
            })
          : null
        const stair = StairNode.parse({
          name: `Staircase ${stairCount + 1}`,
          position: stairOp.position,
          rotation: stairOp.rotation,
          width: stairOp.width,
          totalRise: stairOp.height,
          stepCount: stairOp.stepCount,
          children: segment ? [segment.id] : [],
          ...(stairOp.stairType ? { stairType: stairOp.stairType } : {}),
          ...(stairOp.slabOpeningMode ? { slabOpeningMode: stairOp.slabOpeningMode } : {}),
          ...(stairOp.openingOffset !== undefined ? { openingOffset: stairOp.openingOffset } : {}),
          ...(stairOp.fillToFloor !== undefined ? { fillToFloor: stairOp.fillToFloor } : {}),
          ...(stairOp.innerRadius !== undefined ? { innerRadius: stairOp.innerRadius } : {}),
          ...(stairOp.sweepAngle !== undefined ? { sweepAngle: stairOp.sweepAngle } : {}),
          ...(stairOp.topLandingMode ? { topLandingMode: stairOp.topLandingMode } : {}),
          ...(stairOp.topLandingDepth !== undefined
            ? { topLandingDepth: stairOp.topLandingDepth }
            : {}),
          ...(stairOp.showCenterColumn !== undefined
            ? { showCenterColumn: stairOp.showCenterColumn }
            : {}),
          ...(stairOp.showStepSupports !== undefined
            ? { showStepSupports: stairOp.showStepSupports }
            : {}),
          ...(stairOp.railingMode ? { railingMode: stairOp.railingMode } : {}),
          ...(stairOp.railingHeight !== undefined ? { railingHeight: stairOp.railingHeight } : {}),
          ...(stairOp.fromLevelId !== undefined ? { fromLevelId: stairOp.fromLevelId } : {}),
          ...(stairOp.toLevelId !== undefined ? { toLevelId: stairOp.toLevelId } : {}),
        })
        const { createNodes } = draft
        if (segment) {
          createNodes([
            { node: stair, parentId: (stairOp.levelId ?? levelId) as AnyNodeId },
            { node: segment, parentId: stair.id as AnyNodeId },
          ])
          affectedNodeIds.push(stair.id as AnyNodeId, segment.id as AnyNodeId)
          createdNodeIds.push(stair.id as AnyNodeId, segment.id as AnyNodeId)
        } else {
          createNodes([{ node: stair, parentId: (stairOp.levelId ?? levelId) as AnyNodeId }])
          affectedNodeIds.push(stair.id as AnyNodeId)
          createdNodeIds.push(stair.id as AnyNodeId)
        }
        break
      }
      case 'update_stair': {
        const uStairOp = op as ValidatedUpdateStair
        // Update stair container (position, rotation, geometry-level fields)
        const stairUpdates: Record<string, unknown> = {}
        if (uStairOp.position) stairUpdates.position = uStairOp.position
        if (uStairOp.rotation !== undefined) stairUpdates.rotation = uStairOp.rotation
        if (uStairOp.width !== undefined) stairUpdates.width = uStairOp.width
        if (uStairOp.height !== undefined) stairUpdates.totalRise = uStairOp.height
        if (uStairOp.stepCount !== undefined) stairUpdates.stepCount = uStairOp.stepCount
        if (uStairOp.stairType) stairUpdates.stairType = uStairOp.stairType
        if (uStairOp.slabOpeningMode) stairUpdates.slabOpeningMode = uStairOp.slabOpeningMode
        if (uStairOp.openingOffset !== undefined)
          stairUpdates.openingOffset = uStairOp.openingOffset
        if (uStairOp.fillToFloor !== undefined) stairUpdates.fillToFloor = uStairOp.fillToFloor
        if (uStairOp.innerRadius !== undefined) stairUpdates.innerRadius = uStairOp.innerRadius
        if (uStairOp.sweepAngle !== undefined) stairUpdates.sweepAngle = uStairOp.sweepAngle
        if (uStairOp.topLandingMode) stairUpdates.topLandingMode = uStairOp.topLandingMode
        if (uStairOp.topLandingDepth !== undefined)
          stairUpdates.topLandingDepth = uStairOp.topLandingDepth
        if (uStairOp.showCenterColumn !== undefined)
          stairUpdates.showCenterColumn = uStairOp.showCenterColumn
        if (uStairOp.showStepSupports !== undefined)
          stairUpdates.showStepSupports = uStairOp.showStepSupports
        if (uStairOp.railingMode) stairUpdates.railingMode = uStairOp.railingMode
        if (uStairOp.railingHeight !== undefined)
          stairUpdates.railingHeight = uStairOp.railingHeight
        if (uStairOp.fromLevelId !== undefined) stairUpdates.fromLevelId = uStairOp.fromLevelId
        if (uStairOp.toLevelId !== undefined) stairUpdates.toLevelId = uStairOp.toLevelId
        if (Object.keys(stairUpdates).length > 0) {
          draft.updateNode(uStairOp.nodeId, stairUpdates)
        }
        // Mirror straight-stair segment fields when present
        const stairNode = nodes[uStairOp.nodeId]
        if (
          stairNode &&
          'children' in stairNode &&
          Array.isArray(stairNode.children) &&
          stairNode.children.length > 0
        ) {
          const firstSegId = stairNode.children[0] as AnyNodeId
          const segUpdates: Record<string, unknown> = {}
          if (uStairOp.width !== undefined) segUpdates.width = uStairOp.width
          if (uStairOp.length !== undefined) segUpdates.length = uStairOp.length
          if (uStairOp.height !== undefined) segUpdates.height = uStairOp.height
          if (uStairOp.stepCount !== undefined) segUpdates.stepCount = uStairOp.stepCount
          if (uStairOp.fillToFloor !== undefined) segUpdates.fillToFloor = uStairOp.fillToFloor
          if (Object.keys(segUpdates).length > 0) {
            draft.updateNode(firstSegId, segUpdates)
            affectedNodeIds.push(firstSegId)
          }
        }
        affectedNodeIds.push(uStairOp.nodeId)
        break
      }
      case 'update_roof': {
        const uRoofOp = op as ValidatedUpdateRoof
        const updates: Record<string, unknown> = {}
        if (uRoofOp.roofType) updates.roofType = uRoofOp.roofType
        if (uRoofOp.roofHeight !== undefined) updates.roofHeight = uRoofOp.roofHeight
        if (uRoofOp.wallHeight !== undefined) updates.wallHeight = uRoofOp.wallHeight
        if (uRoofOp.width !== undefined) updates.width = uRoofOp.width
        if (uRoofOp.depth !== undefined) updates.depth = uRoofOp.depth
        draft.updateNode(uRoofOp.nodeId, updates)
        affectedNodeIds.push(uRoofOp.nodeId)
        break
      }
      case 'add_zone': {
        const zoneOp = op as ValidatedAddZone
        const zoneNode = ZoneNode.parse({
          name: zoneOp.name ?? `Zone ${getCachedTypeCount('zone') + 1}`,
          polygon: zoneOp.polygon,
        })
        draft.createNode(zoneNode, (zoneOp.levelId ?? levelId) as AnyNodeId)
        affectedNodeIds.push(zoneNode.id as AnyNodeId)
        createdNodeIds.push(zoneNode.id as AnyNodeId)
        break
      }
      case 'update_zone': {
        const uZoneOp = op as ValidatedUpdateZone
        const updates: Record<string, unknown> = {}
        if (uZoneOp.polygon) updates.polygon = uZoneOp.polygon
        if (uZoneOp.name) updates.name = uZoneOp.name
        draft.updateNode(uZoneOp.nodeId, updates)
        affectedNodeIds.push(uZoneOp.nodeId)
        break
      }
      case 'add_building': {
        const bldOp = op as ValidatedAddBuilding
        // Reuse the first existing building when one is already present.
        // AI tools sometimes call add_building redundantly (e.g. when
        // applying a template on top of an existing scene), which produced
        // multi-building scenes whose levels stacked incorrectly. Treat
        // add_building as upsert: update name/position on the existing
        // building instead of creating a sibling.
        const existing = Object.values(nodes).find((n) => n.type === 'building') as
          | BuildingNode
          | undefined
        if (existing) {
          const updates: Record<string, unknown> = {}
          if (bldOp.name) updates.name = bldOp.name
          if (bldOp.position) updates.position = bldOp.position
          if (Object.keys(updates).length > 0) {
            draft.updateNode(existing.id as AnyNodeId, updates)
          }
          affectedNodeIds.push(existing.id as AnyNodeId)
          // Switch selection to the building's first level if available
          const firstChildId = existing.children[0]
          if (firstChildId && firstChildId.startsWith('level_')) {
            selectedLevelId = firstChildId as `level_${string}`
          }
          break
        }

        // Find site node
        const site = Object.values(nodes).find((n) => n.type === 'site')
        const bldCount = getCachedTypeCount('building')
        // Create building with initial Level 0
        const initialLevel = LevelNode.parse({ level: 0, name: 'Level 0' })
        const building = BuildingNode.parse({
          name: bldOp.name ?? `Building ${bldCount + 1}`,
          position: bldOp.position,
          children: [initialLevel.id],
        })
        const parentId = site ? (site.id as AnyNodeId) : (levelId as AnyNodeId)
        const { createNodes } = draft
        createNodes([
          { node: building, parentId },
          { node: initialLevel, parentId: building.id as AnyNodeId },
        ])
        affectedNodeIds.push(building.id as AnyNodeId, initialLevel.id as AnyNodeId)
        createdNodeIds.push(building.id as AnyNodeId, initialLevel.id as AnyNodeId)
        // Switch to the new building's Level 0
        selectedLevelId = initialLevel.id
        break
      }
      case 'update_site': {
        const uSiteOp = op as ValidatedUpdateSite
        if (uSiteOp.polygon) {
          draft.updateNode(uSiteOp.nodeId, {
            polygon: { type: 'polygon', points: uSiteOp.polygon },
          })
          affectedNodeIds.push(uSiteOp.nodeId)
        }
        break
      }
      case 'add_scan': {
        const scanOp = op as ValidatedAddScan
        const scanNode = ScanNode.parse({
          name: `Scan ${getCachedTypeCount('scan') + 1}`,
          url: scanOp.url,
          position: scanOp.position,
          scale: [scanOp.scale, scanOp.scale, scanOp.scale],
          opacity: scanOp.opacity,
        })
        draft.createNode(scanNode, levelId as AnyNodeId)
        affectedNodeIds.push(scanNode.id as AnyNodeId)
        createdNodeIds.push(scanNode.id as AnyNodeId)
        break
      }
      case 'add_guide': {
        const guideOp = op as ValidatedAddGuide
        const guideNode = GuideNode.parse({
          name: `Guide ${getCachedTypeCount('guide') + 1}`,
          url: guideOp.url,
          position: guideOp.position,
          scale: [guideOp.scale, guideOp.scale, guideOp.scale],
          opacity: guideOp.opacity,
        })
        draft.createNode(guideNode, levelId as AnyNodeId)
        affectedNodeIds.push(guideNode.id as AnyNodeId)
        createdNodeIds.push(guideNode.id as AnyNodeId)
        break
      }
      case 'update_item': {
        const uItemOp = op as ValidatedUpdateItem
        const updates: Record<string, unknown> = {}
        if (uItemOp.scale) updates.scale = uItemOp.scale
        draft.updateNode(uItemOp.nodeId, updates)
        affectedNodeIds.push(uItemOp.nodeId)
        break
      }
      case 'move_building': {
        const mbOp = op as ValidatedMoveBuilding
        const updates: Record<string, unknown> = {}
        if (mbOp.position) updates.position = mbOp.position
        if (mbOp.rotationY !== undefined) {
          // Preserve existing X/Z rotation, only update Y
          const existing = nodes[mbOp.nodeId]
          const currentRotation =
            existing && 'rotation' in existing
              ? (existing as { rotation: [number, number, number] }).rotation
              : [0, 0, 0]
          updates.rotation = [currentRotation[0], mbOp.rotationY, currentRotation[2]]
        }
        draft.updateNode(mbOp.nodeId, updates)
        affectedNodeIds.push(mbOp.nodeId)
        break
      }
      case 'clone_level': {
        const clOp = op as ValidatedCloneLevel
        const { clonedNodes, newLevelId } = cloneLevelSubtree(nodes, clOp.levelId)
        // Find the parent building of the source level
        const sourceLevel = nodes[clOp.levelId]
        const parentBuildingId = sourceLevel?.parentId as AnyNodeId | undefined
        if (parentBuildingId) {
          const { createNodes } = draft
          // Set name and level number on the cloned level
          const existingLevels = Object.values(nodes).filter(
            (n) => n.type === 'level' && n.parentId === parentBuildingId,
          )
          const newLevelNum =
            existingLevels.length > 0
              ? Math.max(
                  ...existingLevels.map((n) => ('level' in n ? (n as { level: number }).level : 0)),
                ) + 1
              : 0
          const clonedLevelNode = clonedNodes.find((n) => n.id === newLevelId)
          if (clonedLevelNode && 'level' in clonedLevelNode) {
            ;(clonedLevelNode as any).level = newLevelNum
            if (clOp.name) (clonedLevelNode as any).name = clOp.name
          }
          // Create all cloned nodes, first the level under the building, then children
          const levelNode = clonedNodes.find((n) => n.id === newLevelId)!
          const childNodes = clonedNodes.filter((n) => n.id !== newLevelId)
          createNodes([
            { node: levelNode, parentId: parentBuildingId },
            ...childNodes.map((n) => ({
              node: n,
              parentId: (n.parentId ?? newLevelId) as AnyNodeId,
            })),
          ])
          affectedNodeIds.push(newLevelId as AnyNodeId)
          createdNodeIds.push(...clonedNodes.map((n) => n.id as AnyNodeId))
          // Switch to the new level
          selectedLevelId = newLevelId as `level_${string}`
        }
        break
      }
      case 'add_fence': {
        const fenceOp = op as ValidatedAddFence
        const fenceCount = getCachedTypeCount('fence')
        const fenceNode = FenceNode.parse({
          name: `Fence ${fenceCount + 1}`,
          start: fenceOp.start,
          end: fenceOp.end,
          height: fenceOp.height,
          thickness: fenceOp.thickness,
          style: fenceOp.style,
          baseStyle: fenceOp.baseStyle,
          color: fenceOp.color,
          postSpacing: fenceOp.postSpacing,
          ...(fenceOp.curveOffset !== undefined ? { curveOffset: fenceOp.curveOffset } : {}),
        })
        batchCreates.push({ node: fenceNode, parentId: (fenceOp.levelId ?? levelId) as AnyNodeId })
        affectedNodeIds.push(fenceNode.id as AnyNodeId)
        createdNodeIds.push(fenceNode.id as AnyNodeId)
        break
      }
      case 'update_fence': {
        const uFenceOp = op as ValidatedUpdateFence
        const updates: Record<string, unknown> = {}
        if (uFenceOp.start) updates.start = uFenceOp.start
        if (uFenceOp.end) updates.end = uFenceOp.end
        if (uFenceOp.height !== undefined) updates.height = uFenceOp.height
        if (uFenceOp.thickness !== undefined) updates.thickness = uFenceOp.thickness
        if (uFenceOp.style) updates.style = uFenceOp.style
        if (uFenceOp.baseStyle) updates.baseStyle = uFenceOp.baseStyle
        if (uFenceOp.color) updates.color = uFenceOp.color
        if (uFenceOp.postSpacing !== undefined) updates.postSpacing = uFenceOp.postSpacing
        if (uFenceOp.curveOffset !== undefined) updates.curveOffset = uFenceOp.curveOffset
        draft.updateNode(uFenceOp.nodeId, updates)
        affectedNodeIds.push(uFenceOp.nodeId)
        break
      }
      case 'add_cut_out': {
        const cutOp = op as ValidatedAddCutOut
        const targetNode = nodes[cutOp.nodeId]
        if (targetNode && (targetNode.type === 'slab' || targetNode.type === 'ceiling')) {
          const currentHoles = (targetNode as { holes?: [number, number][][] }).holes ?? []
          draft.updateNode(cutOp.nodeId, {
            holes: [...currentHoles, cutOp.hole],
          })
          affectedNodeIds.push(cutOp.nodeId)
        }
        break
      }
      case 'update_wall_material': {
        const uOp = op as ValidatedUpdateWallMaterial
        const updates = applySurfaceMaterialUpdate({
          preset: uOp.materialPreset,
          color: uOp.materialColor,
          presetField:
            uOp.side === 'interior'
              ? 'interiorMaterialPreset'
              : uOp.side === 'exterior'
                ? 'exteriorMaterialPreset'
                : 'materialPreset',
          materialField:
            uOp.side === 'interior'
              ? 'interiorMaterial'
              : uOp.side === 'exterior'
                ? 'exteriorMaterial'
                : 'material',
        })
        if (updates) {
          draft.updateNode(uOp.nodeId, updates)
          affectedNodeIds.push(uOp.nodeId)
        }
        break
      }
      case 'update_roof_material': {
        const uOp = op as ValidatedUpdateRoofMaterial
        const updates = applySurfaceMaterialUpdate({
          preset: uOp.materialPreset,
          color: uOp.materialColor,
          presetField:
            uOp.role === 'top'
              ? 'topMaterialPreset'
              : uOp.role === 'edge'
                ? 'edgeMaterialPreset'
                : 'wallMaterialPreset',
          materialField:
            uOp.role === 'top'
              ? 'topMaterial'
              : uOp.role === 'edge'
                ? 'edgeMaterial'
                : 'wallMaterial',
        })
        if (updates) {
          draft.updateNode(uOp.nodeId, updates)
          affectedNodeIds.push(uOp.nodeId)
        }
        break
      }
      case 'update_stair_material': {
        const uOp = op as ValidatedUpdateStairMaterial
        const updates = applySurfaceMaterialUpdate({
          preset: uOp.materialPreset,
          color: uOp.materialColor,
          presetField:
            uOp.role === 'railing'
              ? 'railingMaterialPreset'
              : uOp.role === 'tread'
                ? 'treadMaterialPreset'
                : 'sideMaterialPreset',
          materialField:
            uOp.role === 'railing'
              ? 'railingMaterial'
              : uOp.role === 'tread'
                ? 'treadMaterial'
                : 'sideMaterial',
        })
        if (updates) {
          draft.updateNode(uOp.nodeId, updates)
          affectedNodeIds.push(uOp.nodeId)
        }
        break
      }
      // --- MEP node creation (Phase 2 §6.2) ---
      // Each MEP case uses safeParse + explicit stale-parent guard: the
      // validator resolves levelId, but the parent level may be deleted between
      // validation and execution (undo/redo, cascade delete). A missing parent
      // or a ZodError here would previously throw and abort the whole batch;
      // now we skip the individual op and let the rest of the batch land.
      case 'add_duct_segment': {
        const mOp = op as ValidatedAddDuctSegment
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        const parsed = DuctSegmentNode.safeParse({
          path: mOp.points,
          shape: mOp.crossSection,
          ...(mOp.diameter !== undefined ? { diameter: mOp.diameter } : {}),
          ...(mOp.width !== undefined ? { width: mOp.width } : {}),
          ...(mOp.height !== undefined ? { height: mOp.height } : {}),
          system: mOp.system,
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'add_duct_fitting': {
        const mOp = op as ValidatedAddDuctFitting
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        // Map "cap" (round end-cap) → a straight 0° elbow that closes the run.
        const schemaKind = mOp.fittingType === 'cap' ? 'elbow' : mOp.fittingType
        const parsed = DuctFittingNode.safeParse({
          position: mOp.position,
          rotation: mOp.rotation,
          fittingType: schemaKind,
          ...(mOp.fittingType === 'cap' ? { angle: 0 } : {}),
          ...(mOp.diameter !== undefined ? { diameter: mOp.diameter } : {}),
          ...(mOp.diameter2 !== undefined ? { diameter2: mOp.diameter2 } : {}),
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'add_duct_terminal': {
        const mOp = op as ValidatedAddDuctTerminal
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        // Map SaaS terminalType → schema enum + mount.
        const schemaKind =
          mOp.terminalType === 'supply'
            ? 'supply-register'
            : mOp.terminalType === 'return'
              ? 'return-grille'
              : 'diffuser'
        // Derive mount from host kind if present; diffusers default to ceiling.
        let mount: 'floor' | 'ceiling' | 'wall' =
          mOp.terminalType === 'diffuser' ? 'ceiling' : 'floor'
        if (mOp.hostId) {
          const host = nodes[mOp.hostId as AnyNodeId]
          if (host?.type === 'ceiling') mount = 'ceiling'
          else if (host?.type === 'wall') mount = 'wall'
        }
        const parsed = DuctTerminalNode.safeParse({
          position: mOp.position,
          rotation: mOp.rotation,
          terminalType: schemaKind,
          mount,
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'add_pipe_segment': {
        const mOp = op as ValidatedAddPipeSegment
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        // PipeSegment schema only exposes waste / vent; map supply / gas to
        // waste for now so the LLM's intent is preserved in the polyline
        // while the geometry system stays consistent.
        const system = mOp.pipeKind === 'dwv' ? 'waste' : 'waste'
        const parsed = PipeSegmentNode.safeParse({
          path: mOp.points,
          diameter: mOp.diameter,
          system,
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'add_pipe_fitting': {
        const mOp = op as ValidatedAddPipeFitting
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        // Map alignment tool kinds → schema enum.
        //   tee     → sanitary-tee (square branch)
        //   reducer → 0° elbow that steps diameter
        //   elbow / wye pass through.
        const schemaKind: 'elbow' | 'wye' | 'sanitary-tee' | 'cross' =
          mOp.fittingType === 'tee'
            ? 'sanitary-tee'
            : mOp.fittingType === 'reducer'
              ? 'elbow'
              : mOp.fittingType
        const parsed = PipeFittingNode.safeParse({
          position: mOp.position,
          rotation: mOp.rotation,
          fittingType: schemaKind,
          diameter: mOp.diameter,
          ...(mOp.fittingType === 'reducer' ? { angle: 0 } : {}),
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'add_pipe_trap': {
        const mOp = op as ValidatedAddPipeTrap
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        // Schema only exposes one trap kind; s-trap is stored as p-trap
        // geometry but the validator preserved the requested trapType for
        // downstream logging.
        const parsed = PipeTrapNode.safeParse({
          position: mOp.position,
          rotation: mOp.rotation,
          diameter: mOp.diameter,
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'add_hvac_equipment': {
        const mOp = op as ValidatedAddHvacEquipment
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        // Map SaaS kind → schema enum:
        //   indoor-unit / ahu → air-handler
        //   outdoor-unit      → condenser
        const schemaKind: 'furnace' | 'air-handler' | 'condenser' =
          mOp.equipmentType === 'outdoor-unit' ? 'condenser' : 'air-handler'
        const parsed = HvacEquipmentNode.safeParse({
          position: mOp.position,
          rotation: mOp.rotation,
          equipmentType: schemaKind,
          width: mOp.width,
          depth: mOp.depth,
          height: mOp.height,
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'add_lineset': {
        const mOp = op as ValidatedAddLineset
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        const parsed = LinesetNode.safeParse({
          path: mOp.route,
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'add_liquid_line': {
        const mOp = op as ValidatedAddLiquidLine
        const parentId = (mOp.levelId ?? levelId) as AnyNodeId
        if (!draft.nodes[parentId]) {
          throw new Error('MISSING_NODE')
        }
        const parsed = LiquidLineNode.safeParse({
          path: mOp.route,
        })
        if (!parsed.success) {
          throw new Error('INVALID_NODE')
        }
        batchCreates.push({ node: parsed.data, parentId })
        affectedNodeIds.push(parsed.data.id as AnyNodeId)
        createdNodeIds.push(parsed.data.id as AnyNodeId)
        break
      }
      case 'align_opening_to_nearest': {
        const aOp = op as ValidatedAlignOpeningToNearest
        if (aOp.snappedPosition) {
          draft.updateNode(aOp.nodeId, { position: aOp.snappedPosition })
          affectedNodeIds.push(aOp.nodeId)
        }
        break
      }
      // enter_walkthrough is handled in ai-agent-loop.ts before reaching confirm path
    }
  }

  draft.createNodes(batchCreates)
  return {
    commands: draft.commands,
    resources: { materials: { set: draft.materials } },
    selectedLevelId,
  }
}
