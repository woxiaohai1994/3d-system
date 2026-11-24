// SPDX-License-Identifier: GPL-3.0-or-later
// @ts-nocheck
// Generated directly from operators.py by compile-camera-rig-operators.py.
export const sourceSwapLensHash = '8939a8e0733a5a8fea9418a21c63921374f710ff79a4cc966062e8b952e99f39'
export function sourceSwapLensUI(h: any) {
  const get_rig_and_cam = h.get_rig_and_cam
  function draw(self: any, context: any) {
    let layout, row
    layout = h.get(self, 'layout')
    row = h.get(layout, 'row')()
    h.get(row, 'label')({ text: 'Focal Length:' })
    h.get(row, 'prop')(self, 'camera_lens', { text: '' })
    row = h.get(layout, 'row')()
  }
  function invoke(self: any, context: any, event: any) {
    let _cam, rig
    ;[rig, _cam] = get_rig_and_cam(h.get(context, 'active_object'))
    h.set(self, 'camera_lens', h.get(h.get(h.get(h.get(rig, 'pose'), 'bones'), 'Camera'), 'lens'))
    return h.get(h.get(context, 'window_manager'), 'invoke_props_popup')(self, event)
  }
  return { invoke, draw }
}
