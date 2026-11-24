/* SPDX-License-Identifier: GPL-2.0-or-later */
#include <cmath>
struct vec2 {
  float x, y;
  vec2(float a = 0.0f, float b = 0.0f) : x(a), y(b) {}
};
vec2 operator/(vec2 a, float b) { return {a.x / b, a.y / b}; }
vec2 operator*(vec2 a, float b) { return {a.x * b, a.y * b}; }
vec2 operator*(vec2 a, vec2 b) { return {a.x * b.x, a.y * b.y}; }
vec2 operator+(vec2 a, float b) { return {a.x + b, a.y + b}; }
struct vec4 {
  float x, y, z, a, w;
  vec2 xy;
  vec4(float r = 0, float g = 0, float b = 0, float alpha = 0)
      : x(r), y(g), z(b), a(alpha), w(alpha), xy(r, g) {}
};
float distance(vec2 a, vec2 b) {
  float x = a.x - b.x, y = a.y - b.y;
  return std::sqrt(x * x + y * y);
}
float fract(float a) { return a - std::floor(a); }
vec4 pack_line_data(vec2, vec2, vec2) { return {}; }
void select_id_output(int) {}
vec2 sizeViewport, stipple_coord, stipple_start;
vec4 finalColor, fragColor, lineOutput, gl_FragCoord;
int select_id = 0;
bool relation_discarded = false;
#define discard { relation_discarded = true; return; }
using eBone_Flag = int;
struct Bone { int flag; };
struct bPoseChannel { Bone *bone; bPoseChannel *parent; };
struct UnifiedBonePtr {
  int mode;
  bool parent;
  bPoseChannel *channel;
  bool has_parent() const { return parent; }
  bool is_editbone() const { return mode == 1; }
  bool is_posebone() const { return mode == 2; }
  const bPoseChannel *as_posebone() const { return channel; }
};
