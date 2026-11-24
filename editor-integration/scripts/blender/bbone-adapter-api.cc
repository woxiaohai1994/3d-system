/* SPDX-License-Identifier: GPL-2.0-or-later */
extern "C" float *bbone_input() { return input; }
extern "C" float *bbone_result() { return result; }
extern "C" int bbone_outline(float width,float height,int perspective,int inverted) {
  emitted=0;
  sizeViewport=vec2(width,height); sizeViewportInv=vec2(1.0f/width,1.0f/height);
  drw_view.winmat[3][3]=perspective?0.0f:1.0f;
  geom_flat_in[0].inverted=inverted;
  for (int i=0;i<4;i++) {
    const float *p=input+i*7;
    geom_in[i].vPos=vec3(p[0],p[1],p[2]);
    geom_in[i].pPos=vec4(p[3],p[4],p[5],p[6]);
    geom_in[i].ssPos=(0.5f*(geom_in[i].pPos.xy/geom_in[i].pPos.w)+vec2(0.5f))*sizeViewport;
    geom_in[i].vColSize=vec4(1.0f);
  }
  source_bbone_outline_main();
  return emitted;
}
extern "C" float *bbone_shade(float nx,float ny,float nz,float sr,float sg,float sb,float br,float bg,float bb) {
  vec3 normal(nx,ny,nz);
  vec4 state_color(vec3(sr,sg,sb),1.0f),bone_color(vec3(br,bg,bb),1.0f);
  source_bbone_shade(normal,state_color,bone_color);
  shade_result[0]=finalColor.x;shade_result[1]=finalColor.y;shade_result[2]=finalColor.z;
  return shade_result;
}
extern "C" float *bbone_wire_color(float r,float g,float b,int offset) {
  uint8_t color[3]={uint8_t(std::round(r*255)),uint8_t(std::round(g*255)),uint8_t(std::round(b*255))};
  cp_shade_color3ub(color,offset);
  for (int i=0;i<3;i++) shade_result[i]=float(color[i])/255.0f;
  return shade_result;
}
