// SPDX-License-Identifier: GPL-2.0-or-later
static PropertyRNA property;
static UnitSettings unit;
static uiBlock block;
static uiButNumber button;
static uiHandleButtonData data;
static wmEvent current_event;
static wmWindow window;
extern "C" {
void number_begin(double value, float hardmin, float hardmax, float softmin, float softmax,
                  float step, int precision, int scale, int is_float, int warp, int x, float slider_width, int is_array, float array_min, float array_max) {
  property = {is_float ? PROP_FLOAT : PROP_INT, PROP_NONE, softmin, softmax, step, precision, PropertyScaleType(scale), bool(is_array), array_min, array_max};
  unit = {}; number_unit_enabled = number_unit_valid = false; number_unit_base_scalar = 1;
  block = {nullptr, &unit};
  button = {};
  button.rnaprop = &property; button.block = &block; button.value = value;
  button.hardmin = hardmin; button.hardmax = hardmax;
  button.step_size = step; button.precision = precision; button.warp = warp;
  if (slider_width > 0) {
    button.type = UI_BTYPE_NUM_SLIDER;
    button.rect = {0, slider_width, 0, 24};
  }
  data = {};
  data.dragstartx = data.draglastx = x;
  window.eventstate = &current_event;
  data.window = &window;
  button.active = &data;
  ui_but_range_set_soft(&button);
  ui_numedit_begin(&button, &data);
}
// Unit collection values are supplied by the separate unchanged BKE/UI unit WASM.
void number_units(int type, int enabled, int valid, double base_scalar, int system, int rotation, float scale, float step) {
  button.unit_type = type << 16; number_unit_enabled = bool(enabled); number_unit_valid = bool(valid);
  number_unit_base_scalar = base_scalar; unit.system = system; unit.system_rotation = rotation;
  unit.scale_length = scale; button.step_size = step;
}
int number_move(int x, int is_motion, int ctrl, int shift) {
  wmEvent event{(ctrl ? KM_CTRL : 0) | (shift ? KM_SHIFT : 0)};
  const int changed = button.type == UI_BTYPE_NUM_SLIDER ?
    ui_numedit_but_SLI(&button, &data, x, true, is_motion, ctrl, shift) :
    ui_numedit_but_NUM(&button, &data, x, is_motion, ui_event_to_snap(&event), shift ? 0.1f : 1.0f);
  data.draglastx = x;
  return changed;
}
void number_bounds(float left, float width, float height) {
  button.rect = {left, left + width, 0, height};
}
int number_event(int kind, int x, int ctrl, int shift) {
  if (kind < 0 || kind > 10 || data.state == BUTTON_STATE_EXIT || data.state == BUTTON_STATE_TEXT_EDITING) return 0;
  const int types[] = {LEFTMOUSE, LEFTMOUSE, MOUSEMOVE, EVT_LEFTCTRLKEY, EVT_LEFTSHIFTKEY, EVT_ESCKEY, RIGHTMOUSE, EVT_RETKEY, EVT_MINUSKEY, WHEELDOWNMOUSE, WHEELUPMOUSE};
  current_event = {(ctrl ? KM_CTRL : 0) | (shift ? KM_SHIFT : 0), types[kind], kind == 1 ? KM_RELEASE : KM_PRESS, {x, 0}};
  return button.type == UI_BTYPE_NUM_SLIDER ?
    ui_do_but_SLI(nullptr, &block, &button, &data, &current_event) :
    ui_do_but_NUM(nullptr, &block, &button, &data, &current_event);
}
float number_arrow_vertex(int side, int index, int axis) {
  if (index < 0 || index > 2 || axis < 0 || axis > 1) return 0;
  uiWidgetTrias tria{}; rcti rect{0,24,0,24};
  shape_preset_init_number_arrows(&tria, &rect, 0.6f, side ? 'r' : 'l');
  return tria.vec[index][axis];
}
int number_state() { return int(data.state); }
int number_cancel() { return data.cancel; }
double number_value() { return data.value; }
int number_changed() { return data.dragchange; }
int number_locked() { return data.draglock; }
int number_start_x() { return data.dragstartx; }
float number_soft_min() { return button.softmin; }
float number_soft_max() { return button.softmax; }
}
