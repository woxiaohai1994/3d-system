/* SPDX-License-Identifier: GPL-2.0-or-later */
extern "C" int relation_visible(int mode, int has_parent, int connected, int selected, int parent_selected)
{
  if (mode == 0) return 0;
  Bone parent_bone{parent_selected ? BONE_SELECTED : 0};
  bPoseChannel parent{&parent_bone, nullptr}, child{nullptr, &parent};
  UnifiedBonePtr bone{mode, bool(has_parent), &child};
  const int flags = (connected ? BONE_CONNECTED : 0) | (selected ? BONE_SELECTED : 0);
  return ArmatureBoneDrawStrategy().should_draw_relation_to_parent(bone, flags);
}
extern "C" int relation_stipple(float dist, int enabled)
{
  stipple_start = vec2(0, 0);
  stipple_coord = vec2(dist, 0);
  finalColor = vec4(0, 0, 0, enabled ? 1.0f : 0.0f);
  relation_discarded = false;
  source_fragment_main();
  return !relation_discarded;
}
float relation_screen_values[2];
extern "C" float *relation_screen(float x, float y, float z, float w, float width, float height)
{
  sizeViewport = vec2(width, height);
  const vec2 result = screen_position(vec4(x, y, z, w));
  relation_screen_values[0] = result.x;
  relation_screen_values[1] = result.y;
  return relation_screen_values;
}
