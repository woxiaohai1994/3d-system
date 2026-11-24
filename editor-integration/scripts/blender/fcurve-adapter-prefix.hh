// SPDX-License-Identifier: GPL-2.0-or-later
#include <cmath>
#include <cfloat>
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>

using std::isfinite;
using uint = unsigned int;
#define MINLINE inline
#define UNLIKELY(value) __builtin_expect(bool(value), false)
#define SELECT 1
#define SMALL -1.0e-10
#define NAN_FLT NAN
#define BLI_assert(condition) ((condition) ? (void)0 : __builtin_trap())
#define BLI_assert_msg(condition, message) BLI_assert(condition)
#define BLI_assert_unreachable() __builtin_trap()
#define CLOG_WARN(...) ((void)0)
#define CLOG_ERROR(...) ((void)0)
#define IS_EQT(a, b, threshold) (fabsf((a) - (b)) <= (threshold))
#define CLAMP_MAX(a, b) do { if ((a) > (b)) (a) = (b); } while (0)
#define CLAMP_MIN(a, b) do { if ((a) < (b)) (a) = (b); } while (0)
template<typename A, typename... B> static bool elem(A a, B... b) { return ((a == b) || ...); }
#define ELEM(...) elem(__VA_ARGS__)

static void *MEM_mallocN(size_t bytes, const char *) { return malloc(bytes); }
static void *MEM_malloc_arrayN(size_t count, size_t size, const char *) { return malloc(count * size); }
static void *MEM_callocN(size_t bytes, const char *) { return calloc(1, bytes); }
#define MEM_SAFE_FREE(p) do { free(p); (p) = nullptr; } while (0)
static void MEM_freeN(void *p) { free(p); }
static constexpr struct { int debug = 0; } G;
static constexpr int G_DEBUG = 1;

namespace blender {
struct IndexRange {
  int count;
  explicit IndexRange(int count) : count(count) {}
  struct Iterator {
    int value;
    int operator*() const { return value; }
    Iterator &operator++() { ++value; return *this; }
    bool operator!=(const Iterator &other) const { return value != other.value; }
  };
  Iterator begin() const { return {0}; }
  Iterator end() const { return {count}; }
};
namespace threading {
template<typename F> void parallel_for(IndexRange range, int, F callback) { callback(range); }
}
}
