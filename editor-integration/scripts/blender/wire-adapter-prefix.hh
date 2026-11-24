/* SPDX-FileCopyrightText: 2024 Blender Authors, 2026 Pascal Authors
 * SPDX-License-Identifier: GPL-2.0-or-later */
#include <cmath>
#include <algorithm>
using std::abs;
using std::max;
struct vec2 {
  float x, y;
  vec2(float a = 0) : x(a), y(a) {}
  vec2(float a, float b) : x(a), y(b) {}
  float operator[](int i) const { return i ? y : x; }
  vec2 operator+(vec2 b) const { return {x + b.x, y + b.y}; }
  vec2 operator-(vec2 b) const { return {x - b.x, y - b.y}; }
  vec2 operator-() const { return {-x, -y}; }
  vec2 operator*(vec2 b) const { return {x * b.x, y * b.y}; }
  vec2 operator*(float b) const { return {x * b, y * b}; }
  vec2 operator/(float b) const { return {x / b, y / b}; }
  vec2 &operator+=(vec2 b) { x += b.x; y += b.y; return *this; }
};
static vec2 operator*(float a, vec2 b) { return b * a; }
struct vec3 { float x, y, z; };
struct vec4 {
  union {
    struct { float x, y, z, w; };
    struct { vec2 xy; float _z, _w; };
    struct { vec3 rgb; float a; };
  };
  vec4(float q = 0) : x(q), y(q), z(q), w(q) {}
  vec4(float p, float q, float r, float s) : x(p), y(q), z(r), w(s) {}
  vec4(vec3 v, float q) : x(v.x), y(v.y), z(v.z), w(q) {}
  vec4 operator+(vec4 b) const { return {x + b.x, y + b.y, z + b.z, w + b.w}; }
  vec4 operator-(vec4 b) const { return {x - b.x, y - b.y, z - b.z, w - b.w}; }
  vec4 operator*(float b) const { return {x * b, y * b, z * b, w * b}; }
  vec4 &operator+=(vec4 b) { *this = *this + b; return *this; }
  vec4 &operator-=(vec4 b) { *this = *this - b; return *this; }
};
using float4 = vec4;
struct bvec2 { bool x, y; };
static bvec2 lessThan(vec2 a, vec2 b) { return {a.x < b.x, a.y < b.y}; }
static bool all(bvec2 b) { return b.x && b.y; }
static vec2 normalize(vec2 v) { return v / std::sqrt(v.x * v.x + v.y * v.y); }
static float clamp(float x, float a, float b) { return std::max(a, std::min(b, x)); }
static float step(float edge, float x) { return x < edge ? 0.0f : 1.0f; }
static float smoothstep(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0f, 1.0f);
  return t * t * (3.0f - 2.0f * t);
}
static vec4 mix(vec4 a, vec4 b, float t) { return a * (1.0f - t) + b * t; }
#define CLAMP(x, a, b) x = clamp(x, a, b)
struct Input { vec4 gl_Position; };
struct GeometryData { vec4 finalColor; float wire_width; };
static Input gl_in[2];
static GeometryData geometry_in[1], geometry_out;
static struct { float edgeCoord; } geometry_noperspective_out;
static vec4 gl_Position, fragColor, lineOutput, sizeViewport;
static vec2 sizeViewportInv;
static float sizeEdge, alpha;
static bool do_smooth_wire;
static int select_id, emitted;
static float result[21];
static void gpu_EmitVertex() {
  const int i = emitted++;
  result[i * 4] = gl_Position.x;
  result[i * 4 + 1] = gl_Position.y;
  result[i * 4 + 2] = gl_Position.z;
  result[i * 4 + 3] = gl_Position.w;
  result[16 + i] = geometry_noperspective_out.edgeCoord;
  result[20] = geometry_out.wire_width;
}
static void EndPrimitive() {}
static void view_clipping_distances_set(Input) {}
static void select_id_output(int) {}
