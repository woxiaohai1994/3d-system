import { useScene } from '@pascal-app/core'
import storeSubpath from '@pascal-app/core/store'
import * as React from 'react'
import { Vector3 } from 'three'
import { Vector3 as WebGPUVector3 } from 'three/webgpu'

export const runtimeIdentity = {
  singleCore: useScene === storeSubpath,
  singleThree: Vector3 === WebGPUVector3,
  reactVersion: React.version,
}
