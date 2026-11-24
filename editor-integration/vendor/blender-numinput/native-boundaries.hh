/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <regex>
#include <string>

using uint = unsigned int;
using std::isfinite;

#define BLI_assert assert
#define BLI_assert_unreachable() assert(false)
#define UNUSED_VARS(...) ((void)0)
#define UNUSED_VARS_NDEBUG(...) ((void)0)
#define ATTR_FALLTHROUGH [[fallthrough]]
#define UNLIKELY(a) (a)
#define ELEM(a, b, c) ((a) == (b) || (a) == (c))
#define RPT_(a) (a)
#define RPT_ERROR 1
#define DEG2RAD(a) ((a) * (M_PI / 180.0))
#define RAD2DEG(a) ((a) * (180.0 / M_PI))
#define BLI_snprintf std::snprintf
#define STRNCPY(dst, src) BLI_strncpy(dst, src, sizeof(dst))
#define ARRAY_SIZE(a) (sizeof(a) / sizeof(*(a)))
#define CLAMP(value, minimum, maximum) ((value) = std::clamp((value), (minimum), (maximum)))
#define BLI_STR_UTF8_DEGREE_SIGN "°"
#define MINLINE static inline

enum eStrCursorJumpType { STRCUR_JUMP_NONE, STRCUR_JUMP_DELIM, STRCUR_JUMP_ALL };
enum eStrCursorJumpDirection { STRCUR_DIR_PREV, STRCUR_DIR_NEXT };
void BLI_str_cursor_step_utf8(const char *, int, int *, eStrCursorJumpDirection, eStrCursorJumpType, bool);
void BLI_str_cursor_step_utf32(const char32_t *, int, int *, eStrCursorJumpDirection, eStrCursorJumpType, bool);

enum { USER_UNIT_NONE, B_UNIT_NONE = 0, B_UNIT_LENGTH = 1, B_UNIT_ROTATION = 6 };
enum { USER_FLAG_NUMINPUT_ADVANCED = 1 << 1 };
enum { KM_CTRL = 1, KM_ALT = 2, KM_SHIFT = 4 };
enum {
  EVT_MODAL_MAP = 1, EVT_BACKSPACEKEY, EVT_DELKEY, EVT_LEFTARROWKEY, EVT_RIGHTARROWKEY,
  EVT_HOMEKEY, EVT_ENDKEY, EVT_TABKEY, EVT_PADPERIOD, EVT_PERIODKEY, EVT_PADMINUS,
  EVT_MINUSKEY, EVT_PADSLASHKEY, EVT_SLASHKEY, EVT_CKEY, EVT_VKEY, EVT_TEXT,
};
struct wmEvent { int type; int val = 0; int modifier; char utf8_buf[8]; };
struct UnitSettings { int system = USER_UNIT_NONE; };
struct Scene { UnitSettings unit; };
struct ReportList {};
struct bContext { Scene scene; ReportList reports; };
struct UserDef { int flag = 0; };
inline UserDef U;
struct BPy_RunErrInfo { bool use_single_line_error = false; char **r_string = nullptr; };

inline Scene *CTX_data_scene(bContext *C) { return &C->scene; }
inline ReportList *CTX_wm_reports(bContext *C) { return &C->reports; }
inline void BKE_report(ReportList *, int, const char *) {}
inline void MEM_freeN(void *ptr) { std::free(ptr); }
inline char WM_event_utf8_to_ascii(const wmEvent *event)
{
  return static_cast<unsigned char>(event->utf8_buf[0]) < 128 ? event->utf8_buf[0] : '\0';
}
inline void WM_clipboard_text_set(const char *, bool) {}
inline char *WM_clipboard_text_get_firstline(bool, bool, int *) { return nullptr; }
inline void zero_v3(float *v) { std::fill(v, v + 3, 0.0f); }
inline void copy_v3_v3(float *to, const float *from) { std::copy(from, from + 3, to); }
inline void copy_vn_i(int *v, int count, int value) { std::fill(v, v + count, value); }
inline void copy_vn_short(short *v, int count, short value) { std::fill(v, v + count, value); }
inline void copy_vn_fl(float *v, int count, float value) { std::fill(v, v + count, value); }
inline void BLI_strncpy(char *dst, const char *src, size_t size)
{
  if (size) { std::strncpy(dst, src, size - 1); dst[size - 1] = '\0'; }
}
inline int UI_calc_float_precision(int precision, double) { return precision; }
inline void BLI_str_utf8_invalid_strip(char *, size_t) {}
inline size_t BLI_snprintf_rlen(char *str, size_t length, const char *format, ...)
{
  va_list args;
  va_start(args, format);
  const int result = std::vsnprintf(str, length, format, args);
  va_end(args);
  return result < 0 ? 0 : std::min(size_t(result), length - 1);
}

inline int BLI_str_utf8_size_or_error(const char *text)
{
  const unsigned char lead = text[0];
  if (lead < 128) { return 1; }
  if ((lead & 0xe0) == 0xc0) { return 2; }
  if ((lead & 0xf0) == 0xe0) { return 3; }
  if ((lead & 0xf8) == 0xf0) { return 4; }
  return -1;
}
inline const char *BLI_str_find_next_char_utf8(const char *text, const char *end)
{
  return std::min(text + BLI_str_utf8_size_or_error(text), end);
}
inline const char *BLI_str_find_prev_char_utf8(const char *text, const char *begin)
{
  if (text == begin) { return begin; }
  --text;
  while (text > begin && (static_cast<unsigned char>(*text) & 0xc0) == 0x80) { --text; }
  return text;
}
inline uint BLI_str_utf8_as_unicode_step_or_error(const char *text, size_t length, size_t *index)
{
  const int size = BLI_str_utf8_size_or_error(text + *index);
  if (size < 1 || *index + size > length) { return 0xffffffffu; }
  uint value = static_cast<unsigned char>(text[(*index)++]);
  if (size == 1) { return value; }
  value &= (1u << (7 - size)) - 1;
  for (int i = 1; i < size; ++i) { value = (value << 6) | (text[(*index)++] & 0x3f); }
  return value;
}
// The frozen corpus contains only ASCII and a spacing degree sign, never combining marks.
inline int BLI_str_utf8_char_width_or_error(const char *) { return 1; }
inline int BLI_wcwidth_or_error(char32_t) { return 1; }

inline double BKE_scene_unit_scale(const UnitSettings *, int, double value) { return value; }
inline bool BKE_unit_string_contains_unit(const char *str, int type)
{
  return type == B_UNIT_ROTATION && std::strstr(str, "°");
}
inline double BKE_unit_apply_preferred_unit(const UnitSettings *, int type, double value)
{
  return type == B_UNIT_ROTATION ? DEG2RAD(value) : value;
}
inline bool boundary_parse_decimal(const char *str, double *result)
{
  static const std::regex decimal(R"([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)");
  const std::string input(str);
  const auto first = input.find_first_not_of(" \t\r\n"), last = input.find_last_not_of(" \t\r\n");
  const std::string token = first == std::string::npos ? "" : input.substr(first, last - first + 1);
  if (!std::regex_match(token, decimal)) { *result = 0; return false; }
  const auto start = token.find_first_not_of("+-");
  if (token.find_first_of(".eE") == std::string::npos && token[start] == '0' &&
      token.find_first_not_of('0', start) != std::string::npos)
  {
    *result = 0; return false;
  }
  *result = std::strtod(token.c_str(), nullptr);
  return true;
}
inline bool BKE_unit_replace_string(char *str, int length, const char *, double, int, int)
{
  const std::string expression(str);
  const auto sign = expression.find("°");
  if (sign == std::string::npos) { return false; }
  const std::string degrees = expression.substr(0, sign);
  double value;
  if (sign + std::strlen("°") != expression.size() || !boundary_parse_decimal(degrees.c_str(), &value)) {
    BLI_strncpy(str, "invalid", length);
    return true;
  }
  std::snprintf(str, length, "%.17g", DEG2RAD(value));
  return true;
}
size_t BKE_unit_value_as_string_adaptive(char *, int, double, int, int, int, bool, bool);
inline bool BPY_run_string_as_number(bContext *, const char **, const char *str,
                                     BPy_RunErrInfo *, double *result)
{
  // Python is mocked only at its API boundary. Restricted to the default simple decimal grammar.
  return boundary_parse_decimal(str, result);
}
