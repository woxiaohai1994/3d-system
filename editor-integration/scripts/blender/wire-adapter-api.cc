/* SPDX-FileCopyrightText: 2026 Pascal Authors
 * SPDX-License-Identifier: GPL-2.0-or-later */
extern "C" float wire_width(float width, float pixel_size, float theme_width)
{
  // These expressions are extracted from the upstream packing, vertex and theme code.
  const int packed = int(encode_2f_to_float(0.0f, width / WIRE_WIDTH_COMPRESSION));
  const float decoded = float(packed >> 8) * (1.0f / 255.0f);
  sizeEdge = pixel_size * max(1.0f, theme_width) / 2.0f;
  geometry_in[0].wire_width = decoded * WIRE_WIDTH_COMPRESSION;
  return geometry_in[0].wire_width * (sizeEdge * 2);
}
extern "C" int wire_quad(float ax, float ay, float az, float aw,
                         float bx, float by, float bz, float bw,
                         float width, float pixel_size, float theme_width,
                         float viewport_width, float viewport_height, int smooth)
{
  emitted = 0;
  gl_in[0].gl_Position = vec4(ax, ay, az, aw);
  gl_in[1].gl_Position = vec4(bx, by, bz, bw);
  geometry_in[0].finalColor = vec4(1.0f);
  wire_width(width, pixel_size, theme_width);
  sizeViewport = vec4(viewport_width, viewport_height, 0.0f, 0.0f);
  sizeViewportInv = vec2(1.0f / viewport_width, 1.0f / viewport_height);
  do_smooth_wire = smooth;
  source_geometry_main();
  return emitted;
}
extern "C" float *wire_result() { return result; }
extern "C" float wire_smooth_start() { return GRID_LINE_SMOOTH_START; }
extern "C" float wire_smooth_end() { return GRID_LINE_SMOOTH_END; }
extern "C" float wire_alpha(float edge_coord, float width, int smooth, float opacity)
{
  geometry_out.wire_width = width;
  geometry_out.finalColor = vec4(1.0f);
  geometry_noperspective_out.edgeCoord = edge_coord;
  do_smooth_wire = smooth;
  alpha = opacity;
  source_fragment_main();
  return fragColor.a;
}
