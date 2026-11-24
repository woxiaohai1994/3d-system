// SPDX-License-Identifier: GPL-2.0-or-later
// Blender v4.3.0 PyC_DefaultNameSpace / PyC_RunString_AsNumber, using CPython C exports.
export type RigPythonNumberResult = { success: boolean; value: number; error?: string }

export type RigPythonCAPI = {
  HEAPU32: Uint32Array
  stringToNewUTF8: (text: string) => number
  UTF8ToString: (pointer: number) => string
  _free: (pointer: number) => void
  _PyImport_GetModuleDict: () => number
  _PyDict_GetItemString: (dict: number, key: number) => number
  _PyDict_SetItemString: (dict: number, key: number, value: number) => number
  _PyDict_DelItemString: (dict: number, key: number) => number
  _PyDict_Merge: (dict: number, other: number, override: number) => number
  _Py_IncRef: (object: number) => void
  _Py_DecRef: (object: number) => void
  _PyEval_GetBuiltins: () => number
  _PyModule_New: (name: number) => number
  _PyModule_AddStringConstant: (module: number, name: number, value: number) => number
  _PyModule_AddObject: (module: number, name: number, value: number) => number
  _PyModule_AddObjectRef: (module: number, name: number, value: number) => number
  _PyModule_GetDict: (module: number) => number
  _PyImport_ImportModule: (name: number) => number
  _PyUnicode_FromString: (text: number) => number
  _PyRun_String: (expression: number, start: number, globals: number, locals: number) => number
  _PyObject_Type: (object: number) => number
  _PyType_GetFlags: (type: number) => number
  _PyTuple_Size: (tuple: number) => number
  _PyTuple_GetItem: (tuple: number, index: number) => number
  _PyFloat_AsDouble: (object: number) => number
  _PyErr_Occurred: () => number
  _PyErr_Clear: () => void
  _PyErr_Fetch: (type: number, value: number, traceback: number) => void
  _PyErr_NormalizeException: (type: number, value: number, traceback: number) => void
  _PyObject_GetAttrString: (object: number, name: number) => number
  _PyObject_Str: (object: number) => number
  _PyUnicode_AsUTF8: (object: number) => number
}

const Py_eval_input = 258
const Py_TPFLAGS_TUPLE_SUBCLASS = 1 << 26

export function sourcePythonNumber(api: RigPythonCAPI, expression: string): RigPythonNumberResult {
  if (!expression || expression[0] === '\0') return { success: true, value: 0 }
  const allocated: number[] = []
  const utf8 = (text: string) => {
    const pointer = api.stringToNewUTF8(text)
    allocated.push(pointer)
    return pointer
  }
  const decrement = (object: number) => {
    if (object) api._Py_DecRef(object)
  }
  const failure = (): RigPythonNumberResult => {
    const slots = utf8(' '.repeat(12))
    api.HEAPU32.fill(0, slots / 4, slots / 4 + 3)
    api._PyErr_Fetch(slots, slots + 4, slots + 8)
    api._PyErr_NormalizeException(slots, slots + 4, slots + 8)
    const [type, value, traceback] = Array.from(api.HEAPU32.slice(slots / 4, slots / 4 + 3))
    const name = type ? api._PyObject_GetAttrString(type, utf8('__name__')) : 0
    const message = value ? api._PyObject_Str(value) : 0
    const text = (object: number) => {
      const pointer = object ? api._PyUnicode_AsUTF8(object) : 0
      return pointer ? api.UTF8ToString(pointer) : ''
    }
    const error = `${text(name)}: ${text(message)}`
    for (const object of [name, message, type, value, traceback]) decrement(object!)
    api._PyErr_Clear()
    return { success: false, value: 0, error }
  }
  try {
    const modules = api._PyImport_GetModuleDict()
    const mainName = utf8('__main__')
    const backup = api._PyDict_GetItemString(modules, mainName)
    if (backup) api._Py_IncRef(backup)
    let retval = 0
    try {
      const main = api._PyModule_New(mainName)
      if (!main) return failure()
      api._PyDict_SetItemString(modules, mainName, main)
      decrement(main)
      api._PyModule_AddStringConstant(main, utf8('__name__'), mainName)
      api._PyModule_AddObject(
        main,
        utf8('__file__'),
        api._PyUnicode_FromString(utf8('<expr as number>')),
      )
      api._PyModule_AddObjectRef(main, utf8('__builtins__'), api._PyEval_GetBuiltins())
      const globals = api._PyModule_GetDict(main)
      const math = api._PyImport_ImportModule(utf8('math'))
      if (math) {
        api._PyDict_Merge(globals, api._PyModule_GetDict(math), 0)
        decrement(math)
      } else api._PyErr_Clear()
      retval = api._PyRun_String(utf8(expression), Py_eval_input, globals, globals)
    } finally {
      if (backup) {
        api._PyDict_SetItemString(modules, mainName, backup)
        decrement(backup)
      } else api._PyDict_DelItemString(modules, mainName)
    }
    if (!retval) return failure()
    let value: number
    const type = api._PyObject_Type(retval)
    const tuple = !!(api._PyType_GetFlags(type) & Py_TPFLAGS_TUPLE_SUBCLASS)
    decrement(type)
    if (tuple) {
      value = 0
      const size = api._PyTuple_Size(retval)
      for (let i = 0; i < size; i++) {
        const item = api._PyFloat_AsDouble(api._PyTuple_GetItem(retval, i))
        if (item === -1 && api._PyErr_Occurred()) {
          value = -1
          break
        }
        value += item
      }
    } else value = api._PyFloat_AsDouble(retval)
    decrement(retval)
    if (value === -1 && api._PyErr_Occurred()) return failure()
    return { success: true, value: Number.isFinite(value) ? value : 0 }
  } finally {
    for (const pointer of allocated) api._free(pointer)
  }
}
