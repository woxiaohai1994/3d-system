/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cctype>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "unit-native-boundaries.hh"
#include "advanced-sources/BLI_string_utf8_symbols.h"

#define BLI_assert assert
#define BLI_assert_msg(value, message) assert(value)
#define BLI_assert_unreachable() assert(false)
#define BLI_string_debug_size(...) ((void)0)
#define BLI_INLINE static inline
#define MINLINE static inline
#define UNLIKELY(value) (value)
#define UNUSED_VARS(...) ((void)0)
#define UNUSED_VARS_NDEBUG(...) ((void)0)
#define ARRAY_SIZE(value) (sizeof(value) / sizeof(*(value)))
#define SNPRINTF(dst, ...) BLI_snprintf(dst, sizeof(dst), __VA_ARGS__)
#define CLAMP(value, minimum, maximum) ((value) = std::clamp((value), (minimum), (maximum)))
template<class A, class... B> static bool unit_adapter_elem(A value, B... candidates)
{
  return ((value == candidates) || ...);
}
#define ELEM(...) unit_adapter_elem(__VA_ARGS__)

size_t BLI_strnlen(const char *, size_t);
char *BLI_strncpy(char *, const char *, size_t);
size_t BLI_strncpy_rlen(char *, const char *, size_t);
size_t BLI_snprintf(char *, size_t, const char *, ...);
size_t BLI_snprintf_rlen(char *, size_t, const char *, ...);
int BLI_strncasecmp(const char *, const char *, size_t);
char *BLI_strcasestr(const char *, const char *);

