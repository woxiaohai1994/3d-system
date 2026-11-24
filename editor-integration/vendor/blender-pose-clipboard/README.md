# Blender 姿态剪贴板原文

固定版本为 Blender `v4.3.0`。`UPSTREAM.json` 记录官方下载地址、完整文件字节数与 SHA-256；源码未经改写，保留原版权及 GPL 标识。`blender_default.py` 使用已有 `../blender-keymap/` 中相同哈希的完整文件。未独立验证 Git blob。

`pose_transform.cc:602–617` 标记已选中且在可见骨骼集合中的源骨；`776–830` 写内部姿态缓冲；`628–767` 应用本地通道、镜像与属性；`839–947` 默认粘贴及选中遮罩。

`string_utils.cc:267–386` 的侧名规则包含 `Left_Corner` / `Right_Corner`，不限于 `.L` / `.R`。`idprop.cc:578–606` 只同步已有且类型相同的属性，空指针属性组的复制分支见 `pose_transform.cc:752–764`。

`Blender.py:375–377` 及 `platform_helpers.py:6–50` 在 macOS 上为 Ctrl 快捷键添加 Cmd 等价项，同时保留 Ctrl。

当前独立 TypeScript 模块只覆盖原插件实际使用的 XYZ Euler 作者通道及数字属性字典；不表示已支持任意 Blender 骨架的其他旋转模式、B-Bone、嵌套属性或属性类型转换。原生结果导出器记录本机实际 Blender 版本，不能将它称为 Blender 4.3 实机结果。
