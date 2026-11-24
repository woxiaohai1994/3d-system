/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "advanced-boundaries.hh"
#include "ED_numinput.hh"
#include <Python.h>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <type_traits>

static std::string clipboard, copied, expression, evaluation_error;
static bool clipboard_available = false, did_copy = false, evaluated = false, evaluation_ok = false;
static double evaluation_value = 0.0;

char *wm_clipboard_text_get_impl(bool)
{
  if (!clipboard_available) { return nullptr; }
  char *buffer = static_cast<char *>(std::malloc(clipboard.size() + 1));
  std::memcpy(buffer, clipboard.c_str(), clipboard.size() + 1);
  return buffer;
}
void WM_clipboard_text_set(const char *text, bool)
{
  copied = text;
  did_copy = true;
}
bool BPY_run_string_as_number(bContext *, const char **imports, const char *text,
                             BPy_RunErrInfo *, double *value)
{
  evaluated = true;
  expression = text;
  *value = 0.0;
  evaluation_ok = PyC_RunString_AsNumber(imports, text, "<numeric input oracle>", value);
  evaluation_value = *value;
  if (PyErr_Occurred()) {
    PyObject *type, *error, *trace;
    PyErr_Fetch(&type, &error, &trace);
    PyObject *name = PyObject_GetAttrString(type, "__name__");
    evaluation_error = name ? PyUnicode_AsUTF8(name) : "PythonError";
    Py_XDECREF(name);
    Py_XDECREF(type);
    Py_XDECREF(error);
    Py_XDECREF(trace);
    PyErr_Clear();
  }
  return evaluation_ok;
}

static std::string decode_hex(const std::string &hex)
{
  if (hex == "-") { return ""; }
  std::string result;
  for (size_t index = 0; index < hex.size(); index += 2) {
    result += char(std::stoi(hex.substr(index, 2), nullptr, 16));
  }
  return result;
}
static void json_string(const std::string &value)
{
  std::cout << '"';
  for (const unsigned char character : value) {
    if (character == '"' || character == '\\') { std::cout << '\\' << character; }
    else if (character < 32) {
      std::cout << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(character)
                << std::dec << std::setfill(' ');
    }
    else { std::cout << character; }
  }
  std::cout << '"';
}
template<typename T> static void array3(const T *values)
{
  std::cout << '[';
  for (int index = 0; index < 3; index++) {
    if (index) { std::cout << ','; }
    if constexpr (std::is_floating_point_v<T>) {
      if (values[index] == 0 && std::signbit(values[index])) { std::cout << "-0.0"; continue; }
    }
    std::cout << values[index];
  }
  std::cout << ']';
}
static void snapshot(NumInput &input, const float *result, bool handled, bool applied)
{
  std::cout << "{\"handled\":" << handled << ",\"idx\":" << input.idx
            << ",\"idx_max\":" << input.idx_max << ",\"str\":";
  json_string(input.str);
  std::cout << ",\"str_cur\":" << input.str_cur << ",\"flag\":" << input.flag
            << ",\"unit_sys\":" << input.unit_sys << ",\"unit_use_radians\":" << input.unit_use_radians
            << ",\"unit_type\":";
  array3(input.unit_type);
  std::cout << ",\"val_flag\":"; array3(input.val_flag);
  std::cout << ",\"val\":"; array3(input.val);
  std::cout << ",\"val_org\":"; array3(input.val_org);
  std::cout << ",\"val_inc\":"; array3(input.val_inc);
  std::cout << ",\"result\":"; array3(result);
  std::cout << ",\"applied\":" << applied << ",\"hasInput\":" << hasNumInput(&input);
  if (evaluated) {
    std::cout << ",\"evaluation\":{\"expression\":"; json_string(expression);
    std::cout << ",\"success\":" << evaluation_ok << ",\"value\":" << evaluation_value;
    if (!evaluation_error.empty()) { std::cout << ",\"error\":"; json_string(evaluation_error); }
    std::cout << '}';
  }
  if (did_copy) { std::cout << ",\"copied\":"; json_string(copied); }
  std::cout << "}\n";
}
int main()
{
  Py_Initialize();
  std::cout << std::boolalpha << std::setprecision(17);
  std::string operation;
  bContext context;
  NumInput input;
  float initial[3] = {0, 0, 0};
  while (std::cin >> operation) {
    evaluated = did_copy = false;
    evaluation_error.clear();
    if (operation == "INIT") {
      std::string kind;
      int maximum, advanced, system, rotation, length;
      double scale;
      std::cin >> kind >> maximum >> advanced >> system >> scale >> rotation >> length
               >> initial[0] >> initial[1] >> initial[2];
      UnitSettings &units = context.scene.unit;
      units = {};
      units.system = char(system);
      units.scale_length = float(scale);
      units.system_rotation = char(rotation);
      units.length_unit = char(length);
      units.mass_unit = units.time_unit = units.temperature_unit = char(USER_UNIT_ADAPTIVE);
      U.flag = advanced ? USER_FLAG_NUMINPUT_ADVANCED : 0;
      initNumInput(&input);
      input.idx_max = maximum;
      input.unit_sys = units.system;
      if (kind == "rotate") {
        input.unit_type[0] = B_UNIT_ROTATION;
        input.unit_use_radians = units.system_rotation == USER_UNIT_ROT_RADIANS;
        copy_vn_fl(input.val_inc, 3, float(DEG2RAD(1.0)));
      }
      else if (kind == "translate") {
        copy_vn_i(input.unit_type, 3, B_UNIT_LENGTH);
      }
      else {
        input.flag |= NUM_AFFECT_ALL;
        copy_vn_short(input.val_flag, 3, NUM_NULL_ONE);
        copy_vn_fl(input.val_inc, 3, 0.1f);
      }
      float result[3]; copy_v3_v3(result, initial);
      const bool applied = applyNumInput(&input, result);
      snapshot(input, result, false, applied);
    }
    else if (operation == "EVENT") {
      int type, modifiers, modal;
      std::string text, clipboard_hex;
      std::cin >> type >> modifiers >> modal >> text >> clipboard_hex;
      clipboard_available = clipboard_hex != "NULL";
      clipboard = clipboard_available ? decode_hex(clipboard_hex) : "";
      wmEvent event{};
      event.type = type;
      event.modifier = modifiers;
      event.val = modal;
      const std::string utf8 = decode_hex(text);
      BLI_strncpy(event.utf8_buf, utf8.c_str(), sizeof(event.utf8_buf));
      const bool handled = handleNumInput(&context, &input, &event);
      float result[3]; copy_v3_v3(result, initial);
      const bool applied = applyNumInput(&input, result);
      snapshot(input, result, handled, applied);
    }
    else { std::cerr << "Unknown operation: " << operation << '\n'; return 2; }
  }
  Py_FinalizeEx();
}
