// SPDX-FileCopyrightText: 2001-2002 NaN Holding BV, 2026 Pascal Authors
// SPDX-License-Identifier: GPL-2.0-or-later
import type { BlenderRigState } from '@pascal-app/core'

type Bones = BlenderRigState['bones']
type PoseBone = {
  readonly location: readonly [number, number, number]
  readonly rotation: readonly [number, number, number]
  readonly scale: readonly [number, number, number]
  readonly properties: Readonly<Record<string, number>>
}
export type RigPoseClipboard = Readonly<Record<string, PoseBone>>

const vector = (values: readonly number[]) => values.map(Math.fround) as [number, number, number]
const separator = (char: string | undefined) => char !== undefined && '. -_'.includes(char)

// BLI_string_flip_side_name(..., strip_number=false); source control names fit MAXBONENAME.
export function sourcePoseFlipName(input: string): string {
  if (input.length < 3) return input
  let name = input,
    number = ''
  if (/\d$/.test(name)) {
    const dot = name.lastIndexOf('.')
    if (dot !== -1 && /\d/.test(name[dot + 1]!)) {
      number = name.slice(dot)
      name = name.slice(0, dot)
    }
  }
  const opposite = { l: 'r', r: 'l', L: 'R', R: 'L' } as Record<string, string>
  if (separator(name.at(-2)) && opposite[name.at(-1)!])
    return name.slice(0, -1) + opposite[name.at(-1)!] + number
  if (separator(name[1]) && opposite[name[0]!]) return opposite[name[0]!] + name.slice(1) + number
  if (name.length > 5) {
    for (const word of ['right', 'left']) {
      const index = name.toLowerCase().indexOf(word)
      if (index === -1 || (index !== 0 && index !== name.length - word.length)) continue
      const replacement =
        name[index] === word[0]
          ? word === 'right'
            ? 'left'
            : 'right'
          : name[index + 1] === word[1]!.toUpperCase()
            ? word === 'right'
              ? 'LEFT'
              : 'RIGHT'
            : word === 'right'
              ? 'Left'
              : 'Right'
      return name.slice(0, index) + replacement + name.slice(index + word.length) + number
    }
  }
  return name + number
}

export function sourcePoseCopy(bones: Bones, selected: readonly string[]): RigPoseClipboard {
  const buffer: Record<string, PoseBone> = {}
  for (const [name, bone] of Object.entries(bones)) {
    if (!selected.includes(name)) continue
    buffer[name] = Object.freeze({
      location: Object.freeze(vector(bone.location)),
      rotation: Object.freeze(vector(bone.rotation)),
      scale: Object.freeze(vector(bone.scale)),
      properties: Object.freeze({ ...bone.properties }),
    })
  }
  return Object.freeze(buffer)
}

export function sourcePosePaste(
  currentBones: Bones,
  buffer: RigPoseClipboard | null,
  options: { flipped?: boolean; selectedMask?: boolean; selected?: readonly string[] } = {},
): { bones: Bones; pastedNames: string[]; changed: boolean } | null {
  if (!buffer) return null
  const bones = structuredClone(currentBones),
    selected = options.selected ?? [],
    selectedMask = options.selectedMask === true && selected.length > 0,
    pastedNames: string[] = []
  let changed = false
  for (const [sourceName, source] of Object.entries(buffer)) {
    const name = options.flipped ? sourcePoseFlipName(sourceName) : sourceName
    if (!Object.hasOwn(bones, name) || (selectedMask && !selected.includes(name))) continue
    const target = bones[name]!,
      before = JSON.stringify(target)
    target.location = [...source.location]
    target.rotation = [...source.rotation]
    target.scale = [...source.scale]
    if (options.flipped) {
      target.location[0] *= -1
      target.rotation[1] *= -1
      target.rotation[2] *= -1
    }
    // The adapter represents an absent property group as {}; source rig properties are numeric.
    if (Object.keys(target.properties).length === 0) target.properties = { ...source.properties }
    else
      for (const [key, value] of Object.entries(source.properties))
        if (Object.hasOwn(target.properties, key)) target.properties[key] = value
    pastedNames.push(name)
    changed ||= before !== JSON.stringify(target)
  }
  return { bones, pastedNames, changed }
}

export const sourcePoseClipboardHashes = {
  'pose_transform.cc': 'c2b54f32ebcdf0f553b8a71474cf12cca0cf45e2ef6eb587131d582c34efeb34',
  'string_utils.cc': '6808450d267008bc9d03ab644ef2123abb458d49d764fe0e502ec0c58ba47bf9',
  'idprop.cc': '7bf3a1d0f733c03ef864b66155317140dec923839379a871e893e2d382bd762e',
} as const
