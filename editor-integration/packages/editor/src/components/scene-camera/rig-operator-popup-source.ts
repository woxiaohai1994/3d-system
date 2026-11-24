// SPDX-License-Identifier: GPL-2.0-or-later
// Generated from wm_operators.cc by compile-operator-popup.py; do not edit.
export type PopupHistoryHost = {
  WM_operator_last_redo: (context: unknown) => unknown
  ED_undo_operator_repeat: (context: unknown, operator: unknown) => void
  ED_undo_push_op: (context: unknown, operator: unknown) => void
  wm_operator_register: (context: unknown, operator: unknown) => void
  WM_operator_repeat: (context: unknown, operator: unknown) => void
  WM_operator_free: (operator: unknown) => void
}
export const sourcePopupHash = 'abad7dd2eac31c863408de5daeb99b50a29b2f395a79c9430b30175f6c478980'

export const sourcePopupWidthUnits = 15
export const sourcePopupExecuteOnOpen = false
export function sourcePopupCallbacks(h: PopupHistoryHost) {
  const {
    WM_operator_last_redo,
    ED_undo_operator_repeat,
    ED_undo_push_op,
    wm_operator_register,
    WM_operator_repeat,
    WM_operator_free,
  } = h
  function wm_block_redo_cb(C: unknown, arg_op: unknown) {
    const op = arg_op

    if (op === WM_operator_last_redo(C)) {
      /* Operator was already executed once? undo & repeat. */
      ED_undo_operator_repeat(C, op)
    } else {
      /* Operator not executed yet, call it. */
      ED_undo_push_op(C, op)
      wm_operator_register(C, op)

      WM_operator_repeat(C, op)
    }
  }
  function wm_block_redo_cancel_cb(C: unknown, arg_op: unknown) {
    const op = arg_op

    /* If operator never got executed, free it. */
    if (op !== WM_operator_last_redo(C)) {
      WM_operator_free(op)
    }
  }
  return { update: wm_block_redo_cb, close: wm_block_redo_cancel_cb }
}
