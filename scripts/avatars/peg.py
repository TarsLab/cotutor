"""出厂头像(包根 avatars/<学科>.webp)的出处:三门主科的木钉娃娃,在 Blender 里现建,不用任何乐高零件。

借 figshot 的影棚(scene.blend 的灯、相机、Cycles 设置;没装 figshot 就先装,见它的 README),
脸是旁边的 face-<zh|ma|en>.svg 平投到头上。重渲:

    cd scripts/avatars
    for w in zh ma en; do rsvg-convert -w 1024 -h 1024 face-$w.svg -o /tmp/face-$w.png; done
    blender -b $FIGSHOT/blender/scene.blend --python peg.py -- --who ma --preset peg --faces /tmp --out /tmp/ma.png --final
    magick /tmp/ma.png -resize 384x384 -quality 90 ../../avatars/math.webp      # zh → chinese、en → english

FIGSHOT 缺省 ~/Projects/github-tarslab/figshot。--preset bust 是 figshot 那种带半截身子的取景,peg 是头像用的近景。
尺寸沿用 LDraw 单位(LDU,0.4mm),h 是往上的高度(= -LDraw y),好套 figshot 的取景:
头心 h=19、半径 11.5;身子顶 h=8,往下是桶形的身子。脸从正面(-Y)平投到头上。
"""
import bpy, bmesh, sys, os, math, argparse
from mathutils import Vector

FIGSHOT = os.path.expanduser(os.environ.get("FIGSHOT", "~/Projects/github-tarslab/figshot"))
sys.path.insert(0, os.path.join(FIGSHOT, "blender"))
import figshot_scene as fs

L = fs.LDU
FACES = os.path.dirname(os.path.abspath(__file__))  # --faces 改
R = 11.5          # 头的半径
HC = 19.0         # 头心高度
SUBJECT = {"zh": "#c43c74", "ma": "#2f6fd6", "en": "#1f8a4c"}
SKIN = "#f3caa4"
HAIR = "#3a2a22"


def lin(hex_):
    c = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


def P(x, h, y=0.0):
    """LDU 的 (左右, 高, 前后) → Blender 米;前面是 -Y"""
    return Vector((x * L, y * L, h * L))


def plastic(name, hex_, rough=0.24, coat=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(hex_)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.12
    return m


def smooth(ob, sub=2):
    for p in ob.data.polygons:
        p.use_smooth = True
    if sub:
        ob.modifiers.new("sub", "SUBSURF").levels = sub
        ob.modifiers["sub"].render_levels = sub


def put(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def sphere(at, r, scale=(1, 1, 1), seg=48, sub=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r * L, location=at)
    ob = bpy.context.object
    ob.scale = scale
    smooth(ob, sub)
    return ob


def cyl(at, r, depth, rot=(0, 0, 0), verts=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r * L, depth=depth * L, location=at, rotation=rot)
    return bpy.context.object


def cut(ob, cutter):
    m = ob.modifiers.new("cut", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.object = cutter
    cutter.hide_render = True
    cutter.hide_viewport = True
    return ob


def body(col):
    # 桶形的身子:顶上大圆角(肩),往下略收
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=11.5 * L, depth=48 * L, location=P(0, 8 - 24))
    ob = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for v in bm.verts:
        if v.co.z < 0:
            v.co.x *= 1.06
            v.co.y *= 1.06
    bm.to_mesh(ob.data)
    bm.free()
    bev = ob.modifiers.new("bev", "BEVEL")
    bev.width = 5 * L
    bev.segments = 10
    bev.limit_method = "ANGLE"
    smooth(ob, 1)
    return put(ob, plastic("cloth", col, rough=0.3))


def badge(col_white):
    # 胸口一枚开口朝右的 C(cotutor 的 C)
    bpy.ops.mesh.primitive_torus_add(major_radius=2.5 * L, minor_radius=0.75 * L, major_segments=64, minor_segments=16)
    ob = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    gone = [v for v in bm.verts if abs(math.degrees(math.atan2(v.co.y, v.co.x))) < 38]
    bmesh.ops.delete(bm, geom=gone, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.location = P(-4.2, 0.5, -12.0)
    put(ob, col_white)
    for a in (38, -38):
        s = sphere(P(-4.2 + 2.5 * math.cos(math.radians(a)), 0.5 + 2.5 * math.sin(math.radians(a)), -12.0), 0.75, seg=24)
        put(s, col_white)
    return ob


def head(who):
    ob = sphere(P(0, HC), R, scale=(1, 1, 1.06), seg=64)
    m = plastic("skin", SKIN, rough=0.3, coat=0.25)
    nt = m.node_tree
    n, ln = nt.nodes, nt.links
    bsdf = n["Principled BSDF"]
    tc = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    comb = n.new("ShaderNodeCombineXYZ")
    mp = n.new("ShaderNodeMapping")
    img = n.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(os.path.join(FACES, f"face-{who}.png"))
    img.extension = "CLIP"
    img.interpolation = "Cubic"
    front = n.new("ShaderNodeMath"); front.operation = "LESS_THAN"; front.inputs[1].default_value = 0.0
    k = n.new("ShaderNodeMath"); k.operation = "MULTIPLY"
    mix = n.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs["A"].default_value = lin(SKIN)
    ln.new(tc.outputs["Object"], sep.inputs[0])
    ln.new(sep.outputs["X"], comb.inputs["X"])
    ln.new(sep.outputs["Z"], comb.inputs["Y"])
    ln.new(comb.outputs[0], mp.inputs["Vector"])
    mp.inputs["Scale"].default_value = (1 / (2 * R * L), 1 / (2 * R * L), 1)
    mp.inputs["Location"].default_value = (0.5, 0.5, 0)
    ln.new(mp.outputs[0], img.inputs["Vector"])
    ln.new(sep.outputs["Y"], front.inputs[0])
    ln.new(img.outputs["Alpha"], k.inputs[0])
    ln.new(front.outputs[0], k.inputs[1])
    ln.new(k.outputs[0], mix.inputs["Factor"])
    ln.new(img.outputs["Color"], mix.inputs["B"])
    ln.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return put(ob, m)


def hair_shell(below, face_r, face_h, mat):
    """比头大一圈的发壳:正面挖出脸,底下按 below 切平"""
    shell = sphere(P(0, HC + 0.3), R * 1.065, scale=(1, 1, 1.06), seg=128, sub=0)
    put(shell, mat)
    face = cyl(P(0, face_h, -15), face_r, 30, rot=(math.radians(90), 0, 0), verts=96)
    cut(shell, face)
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(0, below - 20))
    box = bpy.context.object
    box.scale = (40 * L, 40 * L, 40 * L)
    cut(shell, box)
    return shell


def zh(col):
    hair = plastic("hair", HAIR, rough=0.35)
    hair_shell(below=10.5, face_r=9.2, face_h=16.0, mat=hair)
    put(sphere(P(0, 30.0, 4.5), 4.2, seg=32), hair)
    # 发髻上别一支毛笔:笔杆学科色,笔头墨色
    stem = cyl(P(2.5, 31.5, 4.5), 0.55, 14, rot=(0, math.radians(62), 0), verts=24)
    smooth(stem, 0)
    put(stem, plastic("brush", col))
    d = Vector((math.sin(math.radians(62)), 0, math.cos(math.radians(62))))
    tip_at = P(2.5, 31.5, 4.5) - d * (7.0 + 1.6) * L
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.9 * L, radius2=0.0, depth=3.2 * L, location=tip_at, rotation=(0, math.radians(62 + 180), 0))
    put(bpy.context.object, plastic("ink", "#1d1a18", rough=0.5))


def ma(col):
    hair = plastic("hair", HAIR, rough=0.35)
    hair_shell(below=18.0, face_r=10.0, face_h=14.4, mat=hair)
    frame = plastic("glasses", col, rough=0.2)
    eye_h = HC - 0.08 * R * 1.06
    for sx in (-1, 1):
        x = sx * 0.24 * R
        y = -math.sqrt(R * R - x * x - (eye_h - HC) ** 2) - 0.9
        bpy.ops.mesh.primitive_torus_add(major_radius=2.25 * L, minor_radius=0.38 * L, major_segments=48, minor_segments=12,
                                         location=P(x, eye_h, y), rotation=(math.radians(90), 0, math.radians(-sx * 12)))
        ob = bpy.context.object
        smooth(ob, 0)
        put(ob, frame)
    bridge = cyl(P(0, eye_h + 0.4, -R - 0.6), 0.3, 1.0, rot=(0, math.radians(90), 0), verts=16)
    put(bridge, frame)


def en(col):
    hair = plastic("hair", HAIR, rough=0.35)
    hair_shell(below=18.0, face_r=10.0, face_h=14.4, mat=hair)
    dark = plastic("band", "#34363a", rough=0.3)
    cups = plastic("cups", col, rough=0.22)
    # 头梁:竖着的一段圆环,只留上半
    bpy.ops.mesh.primitive_torus_add(major_radius=(R * 1.17) * L, minor_radius=0.75 * L, major_segments=96, minor_segments=16)
    band = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(band.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.3 * R * L], context="VERTS")
    bm.to_mesh(band.data)
    bm.free()
    for p in band.data.polygons:
        p.use_smooth = True
    band.rotation_euler = (math.radians(90), 0, 0)
    band.location = P(0, HC - 0.5, 1.0)
    put(band, dark)
    for sx in (-1, 1):
        c = cyl(P(sx * (R + 1.2), HC - 1.0, 0.5), 3.4, 2.6, rot=(0, math.radians(90), 0), verts=48)
        bev = c.modifiers.new("bev", "BEVEL"); bev.width = 0.9 * L; bev.segments = 6
        smooth(c, 0)
        put(c, cups)
    # 麦:从左耳罩弯到嘴边
    cu = bpy.data.curves.new("mic", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.38 * L
    cu.bevel_resolution = 6
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(1)
    a, b = sp.bezier_points
    a.co = P(R + 2.0, HC - 3.0, -1.0); a.handle_left = a.co + P(0, 2, 2); a.handle_right = a.co + P(0, -3, -4)
    b.co = P(3.6, HC - 7.6, -R + 0.2); b.handle_left = b.co + P(5, 0, 0); b.handle_right = b.co + P(-2, 0, 0)
    mic = bpy.data.objects.new("mic", cu)
    bpy.context.collection.objects.link(mic)
    mic.data.materials.append(dark)
    put(sphere(P(3.0, HC - 7.6, -R + 0.2), 1.1, seg=24), dark)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--who", required=True, choices=sorted(SUBJECT))
    ap.add_argument("--out", required=True)
    ap.add_argument("--final", action="store_true")
    ap.add_argument("--preset", default="bust")
    ap.add_argument("--faces", default=FACES, help="face-<who>.png 所在的目录")
    args = ap.parse_args(argv)
    globals()["FACES"] = args.faces
    col = SUBJECT[args.who]

    body(col)
    badge(plastic("badge", "#fbfaf6", rough=0.25))
    head(args.who)
    {"zh": zh, "ma": ma, "en": en}[args.who](col)

    scene = bpy.context.scene
    # 头像近景:头心在画面正中、上下装下发髻到下巴下一点(bust 带了半截身子,裁进圆里脸太小)
    fs.PRESETS["peg"] = {"centre_y": -18.0, "half": 16.5, "yaw": -14.0, "pitch": 4.0}
    fs.place_camera(args.preset)
    fs.set_look(scene, "film")
    if args.final:
        fs.use_cycles(scene, 64)
    else:
        fs.use_eevee(scene, 32)
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.filepath = os.path.abspath(args.out)
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED: {args.out}")


main()
