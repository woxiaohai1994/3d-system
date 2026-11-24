import { type AnyNode, nodeRegistry } from '@pascal-app/core'
import { type Locale, translateLabel } from '../../i18n/messages'
import { catalogDisplayName } from '../ui/item-catalog/catalog-label'
import { getNodeDisplay } from '../ui/panels/node-display'

export function cameraTargetLabel(node: AnyNode, locale: Locale) {
  if (node.type === 'item' && node.asset && (!node.name || node.name === node.asset.name))
    return catalogDisplayName(locale, node.asset)
  const defaultLabel = nodeRegistry.get(node.type)?.presentation?.label
  if (defaultLabel && (!node.name || node.name === defaultLabel))
    return translateLabel(locale, defaultLabel)
  return getNodeDisplay(node, locale).label
}
