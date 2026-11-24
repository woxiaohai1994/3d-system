/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "unit-adapter-prefix.hh"
#include <string>

using std::isfinite;
#define ATTR_FALLTHROUGH [[fallthrough]]
#define RPT_(value) (value)
#define RPT_ERROR 1
#define DEG2RAD(value) ((value) * (M_PI / 180.0))
#define RAD2DEG(value) ((value) * (180.0 / M_PI))
#define STRNCPY(dst, src) BLI_strncpy(dst, src, sizeof(dst))

enum { USER_FLAG_NUMINPUT_ADVANCED = 1 << 1 };
enum { KM_CTRL = 1, KM_ALT = 2, KM_SHIFT = 4 };
enum {
  EVT_MODAL_MAP = 1, EVT_BACKSPACEKEY, EVT_DELKEY, EVT_LEFTARROWKEY, EVT_RIGHTARROWKEY,
  EVT_HOMEKEY, EVT_ENDKEY, EVT_TABKEY, EVT_PADPERIOD, EVT_PERIODKEY, EVT_PADMINUS,
  EVT_MINUSKEY, EVT_PADSLASHKEY, EVT_SLASHKEY, EVT_CKEY, EVT_VKEY, EVT_TEXT,
};
struct wmEvent { int type; int val = 0; int modifier; char utf8_buf[8]; };
struct Scene { UnitSettings unit; };
struct ReportList {};
struct bContext { Scene scene; ReportList reports; };
struct UserDef { int flag = 0; };
inline UserDef U;
struct Global { bool background = false; };
inline Global G;
struct BPy_RunErrInfo { bool use_single_line_error = false; char **r_string = nullptr; };

inline Scene *CTX_data_scene(bContext *context) { return &context->scene; }
inline ReportList *CTX_wm_reports(bContext *context) { return &context->reports; }
inline void BKE_report(ReportList *, int, const char *) {}
inline void MEM_freeN(void *pointer) { std::free(pointer); }
inline void *MEM_mallocN(size_t size, const char *) { return std::malloc(size); }
inline char WM_event_utf8_to_ascii(const wmEvent *event)
{
  return static_cast<unsigned char>(event->utf8_buf[0]) < 128 ? event->utf8_buf[0] : '\0';
}
inline void zero_v3(float *values) { std::fill(values, values + 3, 0.0f); }
inline void copy_v3_v3(float *to, const float *from) { std::copy(from, from + 3, to); }
inline void copy_vn_i(int *values, int count, int value) { std::fill(values, values + count, value); }
inline void copy_vn_short(short *values, int count, short value) { std::fill(values, values + count, value); }
inline void copy_vn_fl(float *values, int count, float value) { std::fill(values, values + count, value); }
inline int UI_calc_float_precision(int precision, double) { return precision; }

char *wm_clipboard_text_get_impl(bool);
char *WM_clipboard_text_get_firstline(bool, bool, int *);
void WM_clipboard_text_set(const char *, bool);
bool BPY_run_string_as_number(bContext *, const char **, const char *, BPy_RunErrInfo *, double *);
bool PyC_RunString_AsNumber(const char **, const char *, const char *, double *);
