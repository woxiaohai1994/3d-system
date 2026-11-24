/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "unit-adapter-prefix.hh"

static char input_text[4096];
static char result_text[4096];
static UnitSettings scene_units;
static bool has_unit;
static double unit_scale;

extern "C" {
int numinput_ui_is_unit(int, int, int);
float numinput_ui_step(float, int, int, double, int);
double numinput_ui_base_scalar(int, int);
int numinput_ui_valid(int, int);
int numinput_ui_format(char *, int, double, int, const UnitSettings *, int);
int numinput_ui_edit_format(char *, double, int, int, float, int, int, const UnitSettings *);
int numinput_unit_ui_edit_format(double value, int subtype, int type, float step, int floating, int factor) {
  return numinput_ui_edit_format(result_text,value,subtype,type,step,floating,factor,&scene_units);
}
int numinput_unit_ui_is_unit(int type) { return numinput_ui_is_unit(type, scene_units.system, scene_units.system_rotation); }
float numinput_unit_ui_step(float step, int type) { return numinput_ui_step(step, type, scene_units.system, scene_units.scale_length, scene_units.system_rotation); }
double numinput_unit_ui_base_scalar(int type) { return numinput_ui_base_scalar(scene_units.system, type); }
int numinput_unit_ui_valid(int type) { return numinput_ui_valid(scene_units.system, type); }
int numinput_unit_ui_format(double value, int precision, int type) { return numinput_ui_format(result_text, 64, value, precision, &scene_units, type); }

char *numinput_unit_text() { return input_text; }
char *numinput_unit_result() { return result_text; }
int numinput_unit_capacity() { return sizeof(input_text); }

void numinput_unit_settings(int system, double scale_length, int rotation, int length,
                            int mass, int time, int temperature, int flag)
{
  scene_units = {};
  scene_units.system = char(system);
  scene_units.scale_length = float(scale_length);
  scene_units.system_rotation = char(rotation);
  scene_units.length_unit = char(length);
  scene_units.mass_unit = char(mass);
  scene_units.time_unit = char(time);
  scene_units.temperature_unit = char(temperature);
  scene_units.flag = short(flag);
}

void numinput_unit_preprocess(int type)
{
  unit_scale = BKE_scene_unit_scale(&scene_units, type, 1.0);
  has_unit = BKE_unit_string_contains_unit(input_text, type);
  BLI_strncpy(result_text, input_text, sizeof(result_text));
  if (has_unit) {
    BLI_strncpy(result_text, input_text, 256);
    BKE_unit_replace_string(result_text, 256, input_text, unit_scale,
                            scene_units.system, type);
  }
}

int numinput_unit_has_unit() { return has_unit; }
double numinput_unit_scale() { return unit_scale; }
double numinput_unit_multiplier(int type)
{
  return has_unit ? 1.0 : BKE_unit_apply_preferred_unit(&scene_units, type, 1.0) / unit_scale;
}
double numinput_unit_preferred(double value, int type)
{
  return BKE_unit_apply_preferred_unit(&scene_units, type, value);
}

int numinput_unit_format(double value, int precision, int system, int type, int split, int pad)
{
  return int(BKE_unit_value_as_string_adaptive(result_text, 64, value, precision, system, type,
                                               bool(split), bool(pad)));
}

int numinput_unit_cursor_step(int offset, int direction, int jump, int use_init_step)
{
  BLI_str_cursor_step_utf8(input_text, int(strlen(input_text)), &offset,
                           eStrCursorJumpDirection(direction), eStrCursorJumpType(jump),
                           bool(use_init_step));
  return offset;
}

int numinput_unit_strip_invalid(int length)
{
  return BLI_str_utf8_invalid_strip(input_text, size_t(length));
}

int numinput_unit_char_size(int offset) { return BLI_str_utf8_size_or_error(input_text + offset); }
}
