# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile the pinned C++ branches and record independent native picking fixtures."""
import ctypes, hashlib, itertools, json, random, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
directory = ROOT / 'vendor/blender-rig-picking'
manifest = json.loads((directory/'UPSTREAM.json').read_text())
def read(name):
    data = (directory/name).read_bytes()
    assert hashlib.sha256(data).hexdigest() == manifest['files'][name]['sha256']
    return data.decode()
def block(source, start):
    end = source.index('{', start) + 1
    depth = 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]

arm = read('armature_select.cc')
function = block(arm, arm.index('static void *ed_armature_pick_bone_from_selectbuffer_impl'))
priority = block(function, function.index('if (data)'))
geometry = read('math_geom.cc')
clip = block(geometry, geometry.index('bool clip_segment_v3_plane_n('))
query = read('wm_event_query.cc')
motion = block(query, query.index('bool WM_cursor_test_motion_and_update('))
default_move = int(__import__('re').search(r'\.move_threshold\s*=\s*(\d+)', read('userdef_default.c'))[1])
native = '''
#include <cstdint>
#include <cstdlib>
float motion_ui_scale=1;
#define WM_EVENT_CURSOR_MOTION_THRESHOLD (''' + str(default_move) + ''' * motion_ui_scale)
int len_manhattan_v2v2_int(const int*a,const int*b){return abs(a[0]-b[0])+abs(a[1]-b[1]);}
void copy_v2_v2_int(int*a,const int*b){a[0]=b[0];a[1]=b[1];}
''' + motion + '''
extern "C" bool motion_native(int x,int y,float scale){
 motion_ui_scale=scale;
 int mval[2]={x,y};
 return WM_cursor_test_motion_and_update(mval);
}
#define UNPACK3(v) (v)[0],(v)[1],(v)[2]
void sub_v3_v3v3(float*r,const float*a,const float*b){for(int i=0;i<3;i++)r[i]=a[i]-b[i];}
float dot_v3v3(const float*a,const float*b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
float plane_point_side_v3(const float*p,const float*v){return dot_v3v3(p,v)+p[3];}
void madd_v3_v3v3fl(float*r,const float*a,const float*b,float f){for(int i=0;i<3;i++)r[i]=a[i]+b[i]*f;}
''' + clip + '''
extern "C" bool clip_native(const float*a,const float*b,const float*p,int count,float*out){
 return clip_segment_v3_plane_n(a,b,reinterpret_cast<const float(*)[4]>(p),count,out,out+3);
}
void* pick_impl(const uint32_t*depths,const int*selected,int count,bool do_nearest){
 void *firstunSel=nullptr,*firstSel=nullptr,*data;
 void *firstunSel_base=nullptr,*firstSel_base=nullptr,*base=nullptr,*out=nullptr;
 void **r_base=&out;
 bool takeNext=false;
 int minsel=0xffffffff,minunsel=0xffffffff;
 for(int i=0;i<count;i++){
  data=reinterpret_cast<void*>(intptr_t(i+1));
  bool sel=selected[i];
  struct {uint32_t depth;} hit_result{depths[i]};
''' + priority + '''
 }
 if(firstunSel) return firstunSel;
 return firstSel;
}
extern "C" int pick_native(const uint32_t*d,const int*s,int count,bool nearest){
 return intptr_t(pick_impl(d,s,count,nearest))-1;
}
'''
with tempfile.TemporaryDirectory(prefix='rig-picking-native-') as temp:
    cpp=Path(temp)/'picking.cc';cpp.write_text(native)
    library=Path(temp)/'picking.dylib'
    subprocess.run(['clang++','-std=c++17','-shared','-fPIC',str(cpp),'-o',str(library)],check=True)
    lib=ctypes.CDLL(str(library))
    floatp=ctypes.POINTER(ctypes.c_float)
    lib.clip_native.argtypes=[floatp,floatp,floatp,ctypes.c_int,floatp]
    lib.clip_native.restype=ctypes.c_bool
    lib.pick_native.argtypes=[ctypes.POINTER(ctypes.c_uint32),ctypes.POINTER(ctypes.c_int),ctypes.c_int,ctypes.c_bool]
    lib.pick_native.restype=ctypes.c_int
    lib.motion_native.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_float]
    lib.motion_native.restype=ctypes.c_bool
    pick=[]
    for depths in itertools.permutations([100,200,300]):
        for mask in range(8):
            selected=[bool(mask & (1<<i)) for i in range(3)]
            for nearest in [False,True]:
                expected=lib.pick_native((ctypes.c_uint32*3)(*depths),(ctypes.c_int*3)(*selected),3,nearest)
                pick.append(dict(depths=depths,selected=selected,nearest=nearest,expected=expected))
    rng=random.Random(91435)
    cursor=[]
    position=[-1,-1]
    for index in range(200):
        scale=rng.choice([1,1.5,2,3])
        position=[-1,-1] if index%37==0 else [v+rng.randint(-4,4) for v in position]
        moved=lib.motion_native(*position,scale)
        cursor.append(dict(position=position,scale=scale,moved=moved))
    planes=[[1,0,0,1],[-1,0,0,1],[0,1,0,1],[0,-1,0,1],[0,0,1,1],[0,0,-1,1]]
    flat=[value for plane in planes for value in plane]
    segments=[]
    for i in range(180):
        a=[ctypes.c_float(rng.uniform(-3,3)).value for _ in range(3)]
        b=[ctypes.c_float(rng.uniform(-3,3)).value for _ in range(3)]
        out=(ctypes.c_float*6)()
        visible=lib.clip_native((ctypes.c_float*3)(*a),(ctypes.c_float*3)(*b),(ctypes.c_float*24)(*flat),6,out)
        segments.append(dict(a=a,b=b,expected=[list(out[:3]),list(out[3:])] if visible else None))
    output={'source':manifest,'pick':pick,'planes':planes,'segments':segments,'cursor':cursor}
    destination=ROOT/'packages/editor/src/components/scene-camera/rig-picking-native-fixtures.json'
    destination.write_text(json.dumps(output,separators=(',',':'))+'\n')
    print(f'{len(pick)} native selection cases; {len(segments)} native segment cases; {len(cursor)} native cursor cases')
