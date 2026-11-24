// SPDX-License-Identifier: GPL-2.0-or-later
#include <algorithm>
#include <cassert>
#include <cfloat>
#include <climits>
#include <cmath>
#include <cstdlib>
using std::isfinite;
template<typename T, typename... Args> bool elem(T value, Args... args) { return ((value == args) || ...); }
#define ELEM(...) elem(__VA_ARGS__)
#define BLI_assert(...) assert(__VA_ARGS__)
#define UNLIKELY(x) (x)
#define CLAMP_MIN(v, lo) ((v) = std::max((v), decltype(v)(lo)))
#define CLAMP_MAX(v, hi) ((v) = std::min((v), decltype(v)(hi)))
#define CLAMP(v, lo, hi) (CLAMP_MIN(v, lo), CLAMP_MAX(v, hi))
static float min_ff(float a, float b) { return std::min(a, b); }
static float max_ff(float a, float b) { return std::max(a, b); }
static float cube_f(float v) { return v*v*v; }
static int round_fl_to_int(float v);
static int max_ii(int a, int b) { return std::max(a, b); }
static int min_ii(int a, int b) { return std::min(a, b); }
enum PropertyScaleType { PROP_SCALE_LINEAR, PROP_SCALE_CUBIC, PROP_SCALE_LOG };
enum PropertyType { PROP_INT, PROP_FLOAT };
enum PropertySubType { PROP_NONE, PROP_COLOR };
enum { UI_BTYPE_NUM, UI_BTYPE_NUM_SLIDER, UI_BTYPE_SCROLL, UI_BTYPE_CURVE, UI_BTYPE_CURVEPROFILE, UI_BTYPE_COLORBAND, UI_BTYPE_UNITVEC, UI_BTYPE_HSVCUBE, UI_BTYPE_HSVCIRCLE, UI_BTYPE_COLOR };
enum { B_UNIT_LENGTH = 1, B_UNIT_AREA, B_UNIT_VOLUME, PROP_UNIT_ROTATION = 5 << 16, USER_UNIT_ROT_RADIANS = 2 };
enum { UI_BUT_POIN_TYPES = 1, KM_CTRL = 1, KM_SHIFT = 2 };
#define USE_ALLSELECT
enum { MOUSEPAN, WHEELDOWNMOUSE, WHEELUPMOUSE, LEFTMOUSE, RIGHTMOUSE, MOUSEMOVE, EVT_PADENTER, EVT_RETKEY, EVT_BUT_OPEN, EVT_MINUSKEY, EVT_ESCKEY, EVT_LEFTCTRLKEY, EVT_RIGHTCTRLKEY, EVT_LEFTSHIFTKEY, EVT_RIGHTSHIFTKEY };
enum { KM_PRESS = 1, KM_RELEASE = 2, WM_UI_HANDLER_CONTINUE = 0, WM_UI_HANDLER_BREAK = 1 };
enum { UI_BUT_HOVER_LEFT = 1, UI_BUT_HOVER_RIGHT = 2, UI_SELECT = 1, WM_CURSOR_X_MOVE = 1 };
enum uiHandleButtonState { BUTTON_STATE_HIGHLIGHT, BUTTON_STATE_NUM_EDITING, BUTTON_STATE_TEXT_EDITING, BUTTON_STATE_TEXT_SELECTING, BUTTON_STATE_EXIT };
struct wmEvent { int modifier; int type = MOUSEMOVE, val = KM_PRESS; int xy[2] = {0, 0}; };
struct wmWindow { wmEvent *eventstate; };
struct uiHandleButtonData;
struct bContext {};
struct UnitSettings { int system = 0, system_rotation = 0; float scale_length = 1; };
struct uiBlock { void *evil_C = nullptr; UnitSettings *unit; };
struct PropertyRNA { PropertyType type; PropertySubType subtype = PROP_NONE; float softmin, softmax, step; int precision; PropertyScaleType scale; bool is_array = false; float array_min = 0, array_max = 0; };
struct rctf { float xmin, xmax, ymin, ymax; };
static float BLI_rctf_size_x(const rctf *r) { return r->xmax - r->xmin; }
static float BLI_rctf_size_y(const rctf *r) { return r->ymax - r->ymin; }
struct uiBut {
  int type = UI_BTYPE_NUM, pointype = 0, rnaindex = 0;
  void *poin = nullptr; double *editval = nullptr; float *editvec = nullptr;
  float softmin, softmax, hardmin, hardmax;
  double value;
  PropertyRNA *rnaprop; void *rnapoin = nullptr;
  uiBlock *block;
  uiHandleButtonData *active = nullptr;
  int drawflag = 0, flag = 0;
  bool warp = true;
  int unit_type = 0;
  rctf rect;
};
struct uiButNumber : uiBut { float step_size; int precision; };
using uiButNumberSlider = uiButNumber;
struct CurveMapping {}; struct CurveProfile {}; struct ColorBand {};
struct uiButCurveMapping : uiBut { CurveMapping *edit_cumap; };
struct uiButCurveProfile : uiBut { CurveProfile *edit_profile; };
struct uiButColorBand : uiBut { ColorBand *edit_coba; };
struct uiHandleButtonData {
  double startvalue = 0, origvalue = 0, value = 0;
  float dragfstart = 0, dragf = 0, drag_map_soft_min = 0, drag_map_soft_max = 0;
  int dragstartx = 0, draglastx = 0, dragstarty = 0, draglasty = 0;
  uiHandleButtonState state = BUTTON_STATE_HIGHLIGHT;
  bool cancel = false, escapecancel = false, changed_cursor = false;
  wmWindow *window; void *region = nullptr;
  bool draglock = true, dragchange = false;
  float origvec[3], vec[3]; ColorBand *coba;
};
static bool ui_but_is_float(const uiBut *b) { return b->rnaprop->type == PROP_FLOAT; }
static bool ui_but_is_cursor_warp(const uiBut *b) { return b->warp; }
static bool number_unit_enabled = false, number_unit_valid = false;
static double number_unit_base_scalar = 1;
static bool ui_but_is_unit(const uiBut *) { return number_unit_enabled; }
static int UI_but_unit_type_get(const uiBut *b) { return b->unit_type; }
static double ui_but_value_get(const uiBut *b) { return b->value; }
static bool BKE_unit_is_valid(int, int) { return number_unit_valid; }
static double BKE_unit_base_scalar(int, int) { return number_unit_base_scalar; }
#define RNA_SUBTYPE_UNIT_VALUE(x) ((x) >> 16)
static PropertyType RNA_property_type(const PropertyRNA *p) { return p->type; }
static PropertySubType RNA_property_subtype(const PropertyRNA *p) { return p->subtype; }
static PropertyScaleType RNA_property_ui_scale(const PropertyRNA *p) { return p->scale; }
static bool RNA_property_array_check(const PropertyRNA *p) { return p->is_array; }
static void RNA_property_int_ui_range(void *, const PropertyRNA *p, int *a, int *b, int *step) { *a=p->softmin; *b=p->softmax; *step=p->step; }
static void RNA_property_float_ui_range(void *, const PropertyRNA *p, float *a, float *b, float *step, float *precision) { *a=p->softmin; *b=p->softmax; *step=p->step; *precision=p->precision; }
static void RNA_property_int_get_array_range(void *, const PropertyRNA *p, int *range) { range[0] = p->array_min; range[1] = p->array_max; }
static void RNA_property_float_get_array_range(void *, const PropertyRNA *p, float *range) { range[0] = p->array_min; range[1] = p->array_max; }
static void ui_but_v3_get(uiBut *, float *) { abort(); }
static void copy_v3_v3(float *, const float *) { abort(); }
static void ui_block_interaction_begin_ensure(bContext *, uiBlock *, uiHandleButtonData *, bool) {}
static float ui_scale_fac = 1;
#define UI_SCALE_FAC ui_scale_fac

static void ui_window_to_block(void *, uiBlock *, int *, int *) {}
static void WM_cursor_modal_restore(wmWindow *) {}
static void WM_cursor_modal_set(wmWindow *, int) {}
static void ED_region_tag_redraw(void *) {}
// Text editing and panning are delegated to host controls; these APIs accept neither branch.
static void ui_pan_to_scroll(const wmEvent *, int *, int *) { abort(); }
static void ui_do_but_textedit(bContext *, uiBlock *, uiBut *, uiHandleButtonData *, const wmEvent *) { abort(); }
static void ui_do_but_textedit_select(bContext *, uiBlock *, uiBut *, uiHandleButtonData *, const wmEvent *) { abort(); }
static void ui_numedit_begin(uiBut *, uiHandleButtonData *);
static void button_activate_state(bContext *, uiBut *but, uiHandleButtonState state) {
  auto *data = but->active;
  if (data->state == state) return;
  if (state == BUTTON_STATE_NUM_EDITING) ui_numedit_begin(but, data);
  data->state = state;
  but->flag = state == BUTTON_STATE_HIGHLIGHT ? 0 : UI_SELECT;
}
static void ui_numedit_apply(bContext *, uiBlock *, uiBut *, uiHandleButtonData *) {}

using uint = unsigned int;
#define ARRAY_SIZE(a) (sizeof(a) / sizeof((a)[0]))
struct rcti { int xmin, xmax, ymin, ymax; };
static int BLI_rcti_size_x(const rcti *r) { return r->xmax - r->xmin; }
static int BLI_rcti_size_y(const rcti *r) { return r->ymax - r->ymin; }
enum { ROUNDBOX_TRIA_ARROWS = 1 };
struct uiWidgetTrias { int type; float size, vec[3][2], center[2]; int tot; const uint (*index)[3]; };
