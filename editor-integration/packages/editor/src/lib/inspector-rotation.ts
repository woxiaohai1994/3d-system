import type { AnyNode } from '@pascal-app/core'
import { Children, isValidElement, type ReactNode } from 'react'

export function controlLabelText(label: ReactNode): string {
  return Children.toArray(label)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      return isValidElement<{ children?: ReactNode }>(child)
        ? controlLabelText(child.props.children)
        : ''
    })
    .join(' ')
}

export function isRotationLabel(label: ReactNode): boolean {
  return /rotation|\brot\b|\byaw\b|旋转|偏航/i.test(controlLabelText(label))
}

export function hasInspectorRotation(children: ReactNode, node?: AnyNode): boolean {
  return Children.toArray(children).some((child) => {
    if (
      !isValidElement<{
        children?: ReactNode
        rotationControl?: boolean
        unit?: string
        label?: ReactNode
        title?: string
        field?: { key: string; visibleIf?: (node: AnyNode) => boolean }
      }>(child)
    )
      return false
    const props = child.props
    if (props.rotationControl) return true
    if ((props.unit === '°' || props.unit === 'rad') && isRotationLabel(props.label)) return true
    if (props.field && /^rotation(?:[XYZ])?$/.test(String(props.field.key))) {
      return !props.field.visibleIf || !node || props.field.visibleIf(node)
    }
    return hasInspectorRotation(props.children, node)
  })
}
