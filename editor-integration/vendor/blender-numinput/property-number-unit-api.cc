/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Host boundary for unchanged interface.cc unit gate/step/format functions. */
#include "unit-adapter-prefix.hh"
#include "property-number-source.hh"
struct bContext {};
struct Scene {};
struct uiBlock { const UnitSettings *unit; void *evil_C = nullptr; };
struct PropertyRNA { PropertySubType subtype = PROP_NONE; };
struct uiBut { uiBlock *block; int unit_type; int precision; float step_size = 1; double value = 0;
  bool floating = true; PropertyRNA *rnaprop = nullptr; };
static PropertySubType RNA_property_subtype(const PropertyRNA *property) { return property->subtype; }
static float ui_but_get_float_step_size(uiBut *button) { return button->step_size; }
static bool ui_but_is_float(const uiBut *button) { return button->floating; }
static double ui_but_value_get(const uiBut *button) { return button->value; }
// The edit initializer always supplies explicit precision6, so this branch is unreachable.
static int ui_but_calc_float_precision(uiBut *, double) { abort(); }
enum { USER_FACTOR_AS_FACTOR = 0, USER_FACTOR_AS_PERCENTAGE = 1 };
struct { int factor_display_type; } U;
static int UI_but_unit_type_get(const uiBut *but) { return but->unit_type << 16; }
static float ui_but_get_float_precision(uiBut *but) { return float(but->precision); }
static Scene *CTX_data_scene(const bContext *) { abort(); }
#define FRA2TIME(value) (abort(), (value))
#include "property-number-functions.hh"
#include "property-number-edit-functions.hh"
int BLI_str_rstrip_float_zero(char *, char);
extern "C" {
int numinput_ui_edit_format(char *output, double value, int subtype, int type, float step, int floating, int factor, const UnitSettings *unit) {
  uiBlock block{unit}; PropertyRNA property{PropertySubType(subtype)};
  uiBut button{&block,type,UI_PRECISION_FLOAT_MAX,step,value,bool(floating),&property};
  U.factor_display_type = factor;
  bool exponential = false;
  property_number_edit_string_get(&button, output, UI_MAX_DRAW_STR, UI_PRECISION_FLOAT_MAX, true, &exponential);
  if (floating && !ui_but_is_unit(&button) && !exponential) BLI_str_rstrip_float_zero(output, '\0');
  if (ui_but_is_unit(&button)) {
    char original[UI_MAX_DRAW_STR]; BLI_strncpy(original,output,sizeof(original));
    BKE_unit_name_to_alt(output,UI_MAX_DRAW_STR,original,unit->system,type);
  }
  return int(strlen(output));
}

int numinput_ui_is_unit(int type, int system, int rotation) {
  UnitSettings unit{}; unit.system=char(system); unit.system_rotation=char(rotation);
  uiBlock block{&unit}; uiBut button{&block,type,3};
  return ui_but_is_unit(&button);
}
float numinput_ui_step(float step, int type, int system, double scale_length, int rotation) {
  UnitSettings unit{}; unit.system=char(system); unit.system_rotation=char(rotation); unit.scale_length=float(scale_length);
  uiBlock block{&unit}; uiBut button{&block,type,3};
  return ui_but_is_unit(&button) ? ui_get_but_step_unit(&button,step) : step;
}
double numinput_ui_base_scalar(int system, int type) { return BKE_unit_base_scalar(system,type); }
int numinput_ui_valid(int system, int type) { return BKE_unit_is_valid(system,type); }
int numinput_ui_format(char *output, int capacity, double value, int precision, const UnitSettings *unit, int type) {
  uiBlock block{unit}; uiBut button{&block,type,precision};
  ui_get_but_string_unit(&button,output,capacity,value,false,precision);
  return int(strlen(output));
}
}
