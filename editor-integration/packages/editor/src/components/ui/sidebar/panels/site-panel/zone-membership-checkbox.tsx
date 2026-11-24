import { useI18n } from '../../../../../i18n'
import { Checkbox } from './../../../primitives/checkbox'

/** Membership toggle shown on zone rows while a unit is focused. */
export function ZoneMembershipCheckbox({
  checked,
  onToggle,
  unitName,
}: {
  checked: boolean
  onToggle: () => void
  unitName: string
}) {
  const { t: uiText, label: uiLabel } = useI18n()

  return (
    <Checkbox
      aria-label={uiText('In {arg0}', { arg0: unitName })}
      checked={checked}
      className="mr-2"
      onCheckedChange={onToggle}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}
