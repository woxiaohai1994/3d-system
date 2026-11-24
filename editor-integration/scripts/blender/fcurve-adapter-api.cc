// SPDX-License-Identifier: GPL-2.0-or-later
// Flat ABI keeps host buffers independent from Blender's BezTriple struct layout.
extern "C" FCurve *curve_create(const float *data, int count, int flags, int smoothing, int extend, int cyclic)
{
  if (count < 0) return nullptr;
  FCurve *curve = static_cast<FCurve *>(malloc(sizeof(FCurve)));
  BezTriple *points = static_cast<BezTriple *>(count ? calloc(count, sizeof(BezTriple)) : nullptr);
  if (!curve || (count && !points)) { free(curve); free(points); return nullptr; }
  *curve = {};
  curve->bezt = points; curve->totvert = count; curve->flag = flags;
  curve->auto_smoothing = smoothing; curve->extend = extend;
  curve->active_keyframe_index = FCURVE_ACTIVE_KEYFRAME_NONE;
  if (cyclic) {
    curve->cycles.before_mode = curve->cycles.after_mode = FCM_EXTRAPOLATE_CYCLIC;
    curve->modifier.type = FMODIFIER_TYPE_CYCLES;
    curve->modifier.data = &curve->cycles;
    curve->modifiers.first = &curve->modifier;
  }
  for (int i = 0; i < count; i++) {
    auto &point = points[i];
    const float *row = data + i * 16;
    point.vec[1][0] = row[0]; point.vec[1][1] = row[1];
    point.vec[0][0] = row[2]; point.vec[0][1] = row[3];
    point.vec[2][0] = row[4]; point.vec[2][1] = row[5];
    point.h1 = row[6]; point.h2 = row[7]; point.ipo = row[8]; point.easing = row[9];
    point.back = row[10]; point.amplitude = row[11]; point.period = row[12];
    point.f1 = row[13]; point.f2 = row[14]; point.f3 = row[15];
  }
  return curve;
}
extern "C" void curve_destroy(FCurve *curve)
{
  if (curve) { free(curve->bezt); free(curve); }
}
extern "C" void curve_recalculate(FCurve *curve)
{
  BKE_fcurve_handles_recalc_ex(curve, eBezTriple_Flag(SELECT));
}
extern "C" void curve_read(const FCurve *curve, float *data)
{
  for (int i = 0; i < curve->totvert; i++) {
    const auto &point = curve->bezt[i]; float *row = data + i * 16;
    row[0] = point.vec[1][0]; row[1] = point.vec[1][1];
    row[2] = point.vec[0][0]; row[3] = point.vec[0][1];
    row[4] = point.vec[2][0]; row[5] = point.vec[2][1];
    row[6] = point.h1; row[7] = point.h2; row[8] = point.ipo; row[9] = point.easing;
    row[10] = point.back; row[11] = point.amplitude; row[12] = point.period;
    row[13] = point.f1; row[14] = point.f2; row[15] = point.f3;
  }
}
extern "C" float curve_evaluate(const FCurve *curve, float time)
{
  return evaluate_fcurve(curve, time);
}
extern "C" int curve_count(const FCurve *curve) { return curve->totvert; }
extern "C" int curve_insert(FCurve *curve, float time, float value, int handle, int interpolation, int flags)
{
  KeyframeSettings settings = get_keyframe_settings(false);
  settings.handle = eBezTriple_Handle(handle);
  settings.interpolation = eBezTriple_Interpolation(interpolation);
  return int(insert_vert_fcurve(curve, {time, value}, settings, eInsertKeyFlags(flags)));
}
extern "C" int curve_delete(FCurve *curve, float time)
{
  return fcurve_delete_keyframe_at_time(curve, time);
}
extern "C" int curve_find(const FCurve *curve, float time)
{
  bool found;
  int index = BKE_fcurve_bezt_binarysearch_index(curve->bezt, time, curve->totvert, &found);
  return found ? index : -1;
}
