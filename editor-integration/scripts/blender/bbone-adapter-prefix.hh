/* SPDX-License-Identifier: GPL-2.0-or-later */
#include <cmath>
#include <cstdint>
#include <algorithm>
using std::abs;
using uchar = uint8_t;
struct vec2 {
  float x, y;
  vec2(float a = 0) : x(a), y(a) {}
  vec2(float a, float b) : x(a), y(b) {}
  vec2 operator+(vec2 b) const { return {x + b.x, y + b.y}; }
  vec2 operator-(vec2 b) const { return {x - b.x, y - b.y}; }
  vec2 operator-() const { return {-x, -y}; }
  vec2 operator*(vec2 b) const { return {x * b.x, y * b.y}; }
  vec2 operator*(float b) const { return {x * b, y * b}; }
  vec2 operator/(float b) const { return {x / b, y / b}; }
  vec2 &operator+=(vec2 b) { x += b.x; y += b.y; return *this; }
  vec2 &operator*=(float b) { x *= b; y *= b; return *this; }
};
static vec2 operator*(float a, vec2 b) { return b * a; }
struct vec3 {
  float x, y, z;
  vec3(float a = 0) : x(a), y(a), z(a) {}
  vec3(float a, float b, float c) : x(a), y(b), z(c) {}
  vec3 operator-(vec3 b) const { return {x - b.x, y - b.y, z - b.z}; }
  vec3 operator-() const { return {-x, -y, -z}; }
  vec3 operator*(float b) const { return {x * b, y * b, z * b}; }
  vec3 operator/(float b) const { return {x / b, y / b, z / b}; }
};
struct vec4 {
  union {
    struct { float x, y, z, w; };
    struct { vec2 xy; float _z, _w; };
    struct { vec3 xyz; float _w2; };
    struct { vec3 rgb; float a; };
  };
  vec4(float q = 0) : x(q), y(q), z(q), w(q) {}
  vec4(float p, float q, float r, float s) : x(p), y(q), z(r), w(s) {}
  vec4(vec3 v, float q) : x(v.x), y(v.y), z(v.z), w(q) {}
};
static float dot(vec2 a, vec2 b) { return a.x*b.x + a.y*b.y; }
static float dot(vec3 a, vec3 b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
static vec3 cross(vec3 a, vec3 b) { return {a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x}; }
static vec2 normalize(vec2 v) { return v / std::sqrt(dot(v,v)); }
static vec3 normalize(vec3 v) { return v / std::sqrt(dot(v,v)); }
static float sign(float a) { return (a > 0) - (a < 0); }
static float clamp(float a,float b,float c) { return std::max(b,std::min(a,c)); }
static vec3 mix(vec3 a,vec3 b,float c) { return {a.x*(1-c)+b.x*c,a.y*(1-c)+b.y*c,a.z*(1-c)+b.z*c}; }
#define CLAMP(x,a,b) x = std::max(a,std::min(x,b))
struct GeometryInput { vec3 vPos; vec4 pPos; vec2 ssPos; vec4 vColSize; };
static GeometryInput geom_in[4];
static struct { int inverted; } geom_flat_in[1];
static struct { float winmat[4][4]; } drw_view;
static vec2 sizeViewport, sizeViewportInv, edgeStart, edgePos;
static vec4 finalColor, gl_Position;
static int gl_in[4], emitted;
static float input[28], result[8], shade_result[3];
static void gpu_EmitVertex() {
  result[emitted*4]=gl_Position.x; result[emitted*4+1]=gl_Position.y;
  result[emitted*4+2]=gl_Position.z; result[emitted*4+3]=gl_Position.w;
  emitted++;
}
static void EndPrimitive() {}
static void view_clipping_distances_set(int) {}
