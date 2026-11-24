/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "property-text-boundaries.hh"
#include "property-text-functions.hh"
#include <Python.h>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <vector>

extern "C" {
int numinput_ui_is_unit(int, int, int);
float numinput_ui_step(float, int, int, double, int);
double numinput_ui_base_scalar(int, int);
int numinput_ui_valid(int, int);
int numinput_ui_format(char *, int, double, int, const UnitSettings *, int);
int numinput_ui_edit_format(char *, double, int, int, float, int, int, const UnitSettings *);
void number_begin(double, float, float, float, float, float, int, int, int, int, int,
                  float, int, float, float);
void number_units(int, int, int, double, int, int, float, float);
void number_bounds(float, float, float);
int number_move(int, int, int, int);
int number_event(int, int, int, int);
double number_value();
int number_changed();
int number_locked();
int number_start_x();
float number_soft_min();
float number_soft_max();
int number_state();
int number_cancel();
}

static bool evaluated, evaluation_ok;
static double evaluation_value;
static std::string expression, evaluation_error;
static std::vector<std::string> reports;

void BKE_reportf(ReportList *, int, const char *format, ...)
{
  char message[1024];
  va_list args;
  va_start(args, format);
  vsnprintf(message, sizeof(message), format, args);
  va_end(args);
  reports.emplace_back(message);
}

static bool property_text_eval_number(const char **imports, const char *text,
                                     const char *filename, double *value)
{
  evaluated = true;
  expression = text;
  *value = 0.0;
  evaluation_ok = PyC_RunString_AsNumber(imports, text, filename, value);
  evaluation_value = *value;
  return evaluation_ok;
}

static void run_string_handle_error(BPy_RunErrInfo *info)
{
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
    if (info->r_string) {
      *info->r_string = static_cast<char *>(std::malloc(evaluation_error.size() + 1));
      std::memcpy(*info->r_string, evaluation_error.c_str(), evaluation_error.size() + 1);
    }
    if (info->reports) {
      BKE_reportf(info->reports, RPT_ERROR, "%s: %s", info->report_prefix, evaluation_error.c_str());
    }
  }
}

static void bpy_context_set(bContext *, PyGILState_STATE *state) { *state = PyGILState_Ensure(); }
static void bpy_context_clear(bContext *, PyGILState_STATE *state) { PyGILState_Release(*state); }
#define PyC_RunString_AsNumber property_text_eval_number
#include "property-text-bpy-functions.hh"
#undef PyC_RunString_AsNumber

static std::string decode_hex(const std::string &hex)
{
  if (hex == "-") { return ""; }
  std::string text;
  for (size_t index = 0; index < hex.size(); index += 2) {
    text += char(std::stoi(hex.substr(index, 2), nullptr, 16));
  }
  return text;
}

static void json_string(const std::string &text)
{
  std::cout << '"';
  for (const unsigned char character : text) {
    if (character == '"' || character == '\\') { std::cout << '\\' << character; }
    else if (character < 32) {
      std::cout << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(character)
                << std::dec << std::setfill(' ');
    }
    else { std::cout << character; }
  }
  std::cout << '"';
}

static void json_number(double value)
{
  if (value == 0.0 && std::signbit(value)) { std::cout << "-0.0"; }
  else { std::cout << value; }
}

static UnitSettings read_units()
{
  int system, rotation, flag, length, mass, time, temperature;
  double scale;
  std::cin >> system >> scale >> rotation >> flag >> length >> mass >> time >> temperature;
  UnitSettings unit{};
  unit.system = char(system);
  unit.scale_length = float(scale);
  unit.system_rotation = char(rotation);
  unit.flag = short(flag);
  unit.length_unit = char(length);
  unit.mass_unit = char(mass);
  unit.time_unit = char(time);
  unit.temperature_unit = char(temperature);
  return unit;
}

static void unit_context(int type, const UnitSettings &unit, float step)
{
  const float converted = numinput_ui_step(step, type, unit.system,
                                          unit.scale_length, unit.system_rotation);
  std::cout << "{\"enabled\":" << bool(numinput_ui_is_unit(type, unit.system, unit.system_rotation))
            << ",\"valid\":" << bool(numinput_ui_valid(unit.system, type))
            << ",\"baseScalar\":" << numinput_ui_base_scalar(unit.system, type)
            << ",\"step\":" << converted << '}';
}

static void snapshot(int handled)
{
  std::cout << "{\"value\":"; json_number(number_value());
  std::cout << ",\"handled\":" << handled
            << ",\"changed\":" << number_changed() << ",\"locked\":" << number_locked()
            << ",\"startX\":" << number_start_x() << ",\"softMin\":"; json_number(number_soft_min());
  std::cout << ",\"softMax\":"; json_number(number_soft_max());
  std::cout << ",\"state\":" << number_state()
            << ",\"cancel\":" << number_cancel() << '}';
}

int main()
{
  Py_Initialize();
  bContext empty_context{};
  BPy_RunErrInfo empty_error{};
  double empty_value = 31.0;
  if (!BPY_run_string_as_number(&empty_context, nullptr, "", &empty_error, &empty_value) ||
      empty_value != 0.0 || evaluated)
  {
    return 4;
  }
  std::cout << std::boolalpha << std::setprecision(17);
  std::string operation;
  while (std::cin >> operation) {
    if (operation == "TEXT") {
      int subtype, type, floating, factor_display;
      double hardmin, hardmax, softmin, softmax, initial;
      std::string input;
      std::cin >> subtype >> type >> floating >> factor_display;
      UnitSettings unit = read_units();
      std::cin >> hardmin >> hardmax >> softmin >> softmax >> initial >> input;
      bContext context{};
      context.scene.unit = unit;
      uiBlock block{&unit};
      PropertyTextRNA property{PropertySubType(subtype)};
      uiBut button{&block, type, 3, &property, bool(floating), float(hardmin),
                   float(hardmax), softmin, softmax, initial};
      U.factor_display_type = factor_display;
      evaluated = evaluation_ok = false;
      evaluation_value = 0.0;
      expression.clear();
      evaluation_error.clear();
      reports.clear();
      const bool success = property_text_set_number(&context, &button, decode_hex(input).c_str());
      std::cout << "{\"success\":" << success << ",\"value\":"; json_number(button.value);
      std::cout << ",\"python\":{\"evaluated\":" << evaluated;
      if (evaluated) {
        std::cout << ",\"expression\":"; json_string(expression);
        std::cout << ",\"success\":" << evaluation_ok << ",\"value\":"; json_number(evaluation_value);
        if (!evaluation_error.empty()) {
          std::cout << ",\"error\":"; json_string(evaluation_error);
        }
      }
      std::cout << "},\"reports\":[";
      for (size_t index = 0; index < reports.size(); index++) {
        if (index) { std::cout << ','; }
        json_string(reports[index]);
      }
      std::cout << "]}\n";
    }
    else if (operation == "UNIT") {
      int type, precision;
      float step;
      double value;
      std::cin >> type;
      UnitSettings unit = read_units();
      std::cin >> step >> value >> precision;
      char formatted[1024];
      const float converted = numinput_ui_step(step, type, unit.system,
                                              unit.scale_length, unit.system_rotation);
      const int length = numinput_ui_format(formatted, sizeof(formatted), value, precision, &unit, type);
      std::cout << "{\"isUnit\":" << bool(numinput_ui_is_unit(type, unit.system, unit.system_rotation))
                << ",\"step\":" << converted
                << ",\"effectiveStep\":" << float(converted * UI_PRECISION_FLOAT_SCALE)
                << ",\"formatted\":";
      json_string(formatted);
      std::cout << ",\"formattedByteLength\":" << length << "}\n";
    }
    else if (operation == "EDIT") {
      int subtype, type, floating, factor;
      float step;
      double value;
      std::cin >> subtype >> type >> floating >> factor >> step;
      UnitSettings unit = read_units();
      std::cin >> value;
      char formatted[UI_MAX_DRAW_STR];
      const int length = numinput_ui_edit_format(formatted, value, subtype, type,
                                                step, floating, factor, &unit);
      std::cout << "{\"formatted\":"; json_string(formatted);
      std::cout << ",\"formattedByteLength\":" << length << "}\n";
    }
    else if (operation == "SNAP") {
      int mode, type, precision, scale, floating, warp, x, array, count;
      double value;
      float hardmin, hardmax, softmin, softmax, step, width, arraymin, arraymax;
      std::cin >> mode >> type;
      UnitSettings unit = read_units();
      std::cin >> value >> hardmin >> hardmax >> softmin >> softmax >> step >> precision
               >> scale >> floating >> warp >> x >> width >> array >> arraymin >> arraymax >> count;
      const float converted = numinput_ui_step(step, type, unit.system,
                                              unit.scale_length, unit.system_rotation);
      number_begin(value, hardmin, hardmax, softmin, softmax, converted, precision,
                   scale, floating, warp, x, width, array, arraymin, arraymax);
      number_units(type, numinput_ui_is_unit(type, unit.system, unit.system_rotation),
                   numinput_ui_valid(unit.system, type), numinput_ui_base_scalar(unit.system, type),
                   unit.system, unit.system_rotation, unit.scale_length, converted);
      if (mode) {
        float left, bound_width, height;
        std::cin >> left >> bound_width >> height;
        number_bounds(left, bound_width, height);
      }
      std::cout << "{\"unitContext\":"; unit_context(type, unit, step);
      std::cout << ",\"states\":[";
      for (int index = 0; index < count; index++) {
        int first, second, ctrl, shift;
        std::cin >> first >> second >> ctrl >> shift;
        const int handled = mode ? number_event(first, second, ctrl, shift) :
                                   number_move(first, second, ctrl, shift);
        if (index) { std::cout << ','; }
        snapshot(handled);
      }
      std::cout << "]}\n";
    }
    else { return 2; }
    if (!std::cin) { return 3; }
  }
  Py_Finalize();
  return 0;
}
