/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <cstddef>
#include "advanced-sources/BLI_sys_types.h"
typedef struct UnitSettings {

  /** Maybe have other unit conversions? */
  float scale_length;
  /** Imperial, metric etc. */
  char system;
  /** Not implemented as a proper unit system yet. */
  char system_rotation;
  short flag;

  char length_unit;
  char mass_unit;
  char time_unit;
  char temperature_unit;

  char _pad[4];
} UnitSettings;
#define USER_UNIT_ADAPTIVE 0xFF
/** #UnitSettings::system */
enum {
  USER_UNIT_NONE = 0,
  USER_UNIT_METRIC = 1,
  USER_UNIT_IMPERIAL = 2,
};
/** #UnitSettings::flag */
enum {
  USER_UNIT_OPT_SPLIT = 1,
  USER_UNIT_ROT_RADIANS = 2,
};


struct UnitSettings;

/* In all cases the value is assumed to be scaled by the user-preference. */

/**
 * Humanly readable representation of a value in units (used for button drawing).
 */
size_t BKE_unit_value_as_string_adaptive(char *str,
                                         int str_maxncpy,
                                         double value,
                                         int prec,
                                         int system,
                                         int type,
                                         bool split,
                                         bool pad);
/**
 * Representation of a value in units. Negative precision is used to disable stripping of zeroes.
 * This reduces text jumping when changing values.
 */
size_t BKE_unit_value_as_string(char *str,
                                int str_maxncpy,
                                double value,
                                int prec,
                                int type,
                                const UnitSettings *settings,
                                bool pad);

/**
 * Replace units with values, used before python button evaluation.
 *
 * Make a copy of the string that replaces the units with numbers.
 * This is only used when evaluating user input and can afford to be a bit slower
 *
 * This is to be used before python evaluation so:
 * `10.1km -> 10.1*1000.0`
 * ...will be resolved by Python.
 *
 * Values will be split by an add sign:
 * `5'2" -> 5*0.3048 + 2*0.0254`
 *
 * \param str_prev: is optional, when valid it is used to get a base unit when none is set.
 *
 * \return True of a change was made.
 */
bool BKE_unit_replace_string(
    char *str, int str_maxncpy, const char *str_prev, double scale_pref, int system, int type);

/**
 * \return true if the string contains any valid unit for the given type.
 */
bool BKE_unit_string_contains_unit(const char *str, int type);

/**
 * If user does not specify a unit, this converts it to the unit from the settings.
 */
double BKE_unit_apply_preferred_unit(const UnitSettings *settings, int type, double value);

/**
 * Make string keyboard-friendly, e.g: `10µm -> 10um`.
 */
void BKE_unit_name_to_alt(char *str, int str_maxncpy, const char *orig_str, int system, int type);

/**
 * The size of the unit used for this value (used for calculating the click-step).
 */
double BKE_unit_closest_scalar(double value, int system, int type);

/**
 * Base scale for these units.
 */
double BKE_unit_base_scalar(int system, int type);

/**
 * \return true is the unit system exists.
 */
bool BKE_unit_is_valid(int system, int type);

/**
 * Loop over scales, could add names later.
 */
// double bUnit_Iter(void **unit, char **name, int system, int type);

void BKE_unit_system_get(int system, int type, const void **r_usys_pt, int *r_len);
int BKE_unit_base_get(const void *usys_pt);
int BKE_unit_base_of_type_get(int system, int type);
const char *BKE_unit_name_get(const void *usys_pt, int index);
const char *BKE_unit_display_name_get(const void *usys_pt, int index);
const char *BKE_unit_identifier_get(const void *usys_pt, int index);
double BKE_unit_scalar_get(const void *usys_pt, int index);
bool BKE_unit_is_suppressed(const void *usys_pt, int index);

/** Aligned with #PropertyUnit and `bpyunits_ucategories_items` in `bpy_utils_units.cc`. */
enum {
  B_UNIT_NONE = 0,
  B_UNIT_LENGTH = 1,
  B_UNIT_AREA = 2,
  B_UNIT_VOLUME = 3,
  B_UNIT_MASS = 4,
  B_UNIT_ROTATION = 5,
  B_UNIT_TIME = 6,
  B_UNIT_TIME_ABSOLUTE = 7,
  B_UNIT_VELOCITY = 8,
  B_UNIT_ACCELERATION = 9,
  B_UNIT_CAMERA = 10,
  B_UNIT_POWER = 11,
  B_UNIT_TEMPERATURE = 12,
  B_UNIT_WAVELENGTH = 13,
  B_UNIT_COLOR_TEMPERATURE = 14,
  B_UNIT_FREQUENCY = 15,
  B_UNIT_TYPE_TOT = 16,
};

#ifdef __cplusplus
extern "C" {
#endif

char *BLI_strncpy_utf8(char *__restrict dst, const char *__restrict src, size_t dst_maxncpy)
    ;
size_t BLI_strncpy_utf8_rlen(char *__restrict dst,
                             const char *__restrict src,
                             size_t dst_maxncpy)  ;
/**
 * Find first UTF-8 invalid byte in given \a str, of \a length bytes.
 *
 * \return the offset of the first invalid byte.
 */
ptrdiff_t BLI_str_utf8_invalid_byte(const char *str, size_t length) ;
/**
 * Remove any invalid UTF-8 byte (taking into account multi-bytes sequence of course).
 *
 * \return number of stripped bytes.
 */
int BLI_str_utf8_invalid_strip(char *str, size_t length) ;

/**
 * \return The size (in bytes) of a single UTF-8 char.
 * \warning Can return -1 on bad chars.
 */
int BLI_str_utf8_size_or_error(const char *p)  ;
/**
 * Use when we want to skip errors.
 */
int BLI_str_utf8_size_safe(const char *p)  ;
/**
 * \param p: a pointer to Unicode character encoded as UTF-8
 *
 * Converts a sequence of bytes encoded as UTF-8 to a Unicode character.
 * If \a p does not point to a valid UTF-8 encoded character, results are
 * undefined. If you are not sure that the bytes are complete
 * valid Unicode characters, you should use g_utf8_get_char_validated()
 * instead.
 *
 * Return value: the resulting character
 */
unsigned int BLI_str_utf8_as_unicode_or_error(const char *p) 
    ;
unsigned int BLI_str_utf8_as_unicode_safe(const char *p)  ;
/**
 * UTF8 decoding that steps over the index.
 * When an error is encountered fall back to `LATIN1`, stepping over a single byte.
 *
 * \param p: The text to step over.
 * \param p_len: The length of `p`.
 * \param index: Index of `p` to step over.
 * \return the code-point `(p + *index)` if there is a decoding error.
 */
unsigned int BLI_str_utf8_as_unicode_step_safe(const char *__restrict p,
                                               size_t p_len,
                                               size_t *__restrict index) 
    ;
/**
 * UTF8 decoding that steps over the index (unless an error is encountered).
 *
 * \param p: The text to step over.
 * \param p_len: The length of `p`.
 * \param index: Index of `p` to step over.
 * \return the code-point or #BLI_UTF8_ERR if there is a decoding error.
 *
 * \note The behavior for clipped text (where `p_len` limits decoding trailing bytes)
 * must have the same behavior is encountering a nil byte,
 * so functions that only use the first part of a string has matching behavior to functions
 * that null terminate the text.
 */
unsigned int BLI_str_utf8_as_unicode_step_or_error(
    const char *__restrict p, size_t p_len, size_t *__restrict index) 
    ;

size_t BLI_str_utf8_from_unicode_len(unsigned int c) ;
/**
 * BLI_str_utf8_from_unicode:
 *
 * \param c: a Unicode character code
 * \param dst: output buffer, must have at least `dst_maxncpy` bytes of space.
 * If the length required by `c` exceeds `dst_maxncpy`,
 * the bytes available bytes will be zeroed and `dst_maxncpy` returned.
 *
 * Converts a single character to UTF-8.
 *
 * \return number of bytes written.
 */
size_t BLI_str_utf8_from_unicode(unsigned int c, char *dst, size_t dst_maxncpy) ;
size_t BLI_str_utf8_as_utf32(char32_t *__restrict dst_w,
                             const char *__restrict src_c,
                             size_t dst_w_maxncpy) ;
size_t BLI_str_utf32_as_utf8(char *__restrict dst,
                             const char32_t *__restrict src,
                             size_t dst_maxncpy) ;
/**
 * \return The UTF-32 len in UTF-8 with a clamped length.
 */
size_t BLI_str_utf32_as_utf8_len_ex(const char32_t *src, size_t src_maxlen) 
    ;
/**
 * \return The UTF-32 len in UTF-8.
 */
size_t BLI_str_utf32_as_utf8_len(const char32_t *src)  ;

/**
 * BLI_str_find_prev_char_utf8:
 * \param p: pointer to some position within \a str
 * \param str_start: pointer to the beginning of a UTF-8 encoded string
 *
 * Given a position \a p with a UTF-8 encoded string \a str, find the start
 * of the previous UTF-8 character starting before. \a p Returns \a str_start if no
 * UTF-8 characters are present in \a str_start before \a p.
 *
 * \a p does not have to be at the beginning of a UTF-8 character. No check
 * is made to see if the character found is actually valid other than
 * it starts with an appropriate byte.
 *
 * \return A pointer to the found character.
 */
const char *BLI_str_find_prev_char_utf8(const char *p, const char *str_start)
      ;
/**
 * \param p: a pointer to a position within a UTF-8 encoded string
 * \param str_end: a pointer to the byte following the end of the string.
 *
 * Finds the start of the next UTF-8 character in the string after \a p
 *
 * \a p does not have to be at the beginning of a UTF-8 character. No check
 * is made to see if the character found is actually valid other than
 * it starts with an appropriate byte.
 *
 * \return a pointer to the found character or a pointer to the null terminating character '\0'.
 */
const char *BLI_str_find_next_char_utf8(const char *p, const char *str_end)
      ;

/**
 * \return the `wchar_t` length in UTF-8.
 */
size_t BLI_wstrlen_utf8(const wchar_t *src)  ;
size_t BLI_strlen_utf8_ex(const char *strc, size_t *r_len_bytes)
     ;
size_t BLI_strlen_utf8(const char *strc)  ;
size_t BLI_strnlen_utf8_ex(const char *strc, size_t strc_maxlen, size_t *r_len_bytes)
    ;
/**
 * \param strc: the string to measure the length.
 * \param strc_maxlen: the string length (in bytes)
 * \return the unicode length (not in bytes!)
 */
size_t BLI_strnlen_utf8(const char *strc, size_t strc_maxlen)
     ;
size_t BLI_strncpy_wchar_as_utf8(char *__restrict dst,
                                 const wchar_t *__restrict src,
                                 size_t dst_maxncpy) ;
size_t BLI_strncpy_wchar_from_utf8(wchar_t *__restrict dst_w,
                                   const char *__restrict src_c,
                                   size_t dst_w_maxncpy) ;

/**
 * Count columns that character/string occupies (based on `wcwidth.co`).
 */
int BLI_wcwidth_or_error(char32_t ucs) ;
int BLI_wcwidth_safe(char32_t ucs) ;
int BLI_wcswidth_or_error(const char32_t *pwcs, size_t n)  ;

/**
 * Return the uppercase of a 32-bit character or the character when no case change is needed.
 *
 * \note A 1:1 mapping doesn't account for multiple characters as part of conversion in some cases.
 */
char32_t BLI_str_utf32_char_to_upper(char32_t wc);
/**
 * Return the lowercase of a 32-bit character or the character when no case change is needed.
 *
 * \note A 1:1 mapping doesn't account for multiple characters as part of conversion in some cases.
 */
char32_t BLI_str_utf32_char_to_lower(char32_t wc);

/**
 * \warning can return -1 on bad chars.
 */
int BLI_str_utf8_char_width_or_error(const char *p)  ;
int BLI_str_utf8_char_width_safe(const char *p)  ;

size_t BLI_str_partition_utf8(const char *str,
                              const unsigned int delim[],
                              const char **r_sep,
                              const char **r_suf) ;
size_t BLI_str_rpartition_utf8(const char *str,
                               const unsigned int delim[],
                               const char **r_sep,
                               const char **r_suf) ;
size_t BLI_str_partition_ex_utf8(const char *str,
                                 const char *end,
                                 const unsigned int delim[],
                                 const char **r_sep,
                                 const char **r_suf,
                                 bool from_right)  ;

int BLI_str_utf8_offset_to_index(const char *str,
                                 size_t str_len,
                                 int offset_target)  ;
/**
 * Return the byte offset in `str` from `index_target`.
 * \param index_target: The unicode index, where multi-byte characters are counted once.
 * There is no need to clamp this value, the index is logically clamped to `BLI_strlen_utf8(str)`
 * or below.
 */
int BLI_str_utf8_offset_from_index(const char *str,
                                   size_t str_len,
                                   int index_target)  ;
int BLI_str_utf8_offset_to_column(const char *str,
                                  size_t str_len,
                                  int offset_target)  ;
int BLI_str_utf8_offset_from_column(const char *str,
                                    size_t str_len,
                                    int column_target)  ;
int BLI_str_utf8_offset_to_column_with_tabs(const char *str,
                                            size_t str_len,
                                            int offset_target,
                                            int tab_width)  ;
int BLI_str_utf8_offset_from_column_with_tabs(const char *str,
                                              size_t str_len,
                                              int column_target,
                                              int tab_width) 
    ;

/** Size in bytes. */
#define BLI_UTF8_MAX 6
#define BLI_UTF8_WIDTH_MAX 2 /* columns */
#define BLI_UTF8_ERR ((unsigned int)-1)

/* -------------------------------------------------------------------- */
/** \name String Copy/Format Macros
 * Avoid repeating destination with `sizeof(..)`.
 * \note `ARRAY_SIZE` allows pointers on some platforms.
 * \{ */

#define STRNCPY_UTF8(dst, src) BLI_strncpy_utf8(dst, src, ARRAY_SIZE(dst))
#define STRNCPY_UTF8_RLEN(dst, src) BLI_strncpy_utf8_rlen(dst, src, ARRAY_SIZE(dst))

/** \} */

#ifdef __cplusplus
}
#endif

#include "advanced-sources/BLI_string_cursor_utf8.h"
double BKE_scene_unit_scale(const UnitSettings *, int, double);
