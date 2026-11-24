# 材质资源恢复（2026-09-20）

材质目录引用了 65 张 WebP 缩略图、249 张 KTX2 贴图。其中 48 张缩略图和
187 张贴图在集成源码中缺失，实际请求返回 HTTP 404。源仓库快照
`73e5789` 中也存在这一缺口；对应的 JPG / PNG / WebP 原始贴图仍在
`apps/editor/public/material/`，因此无需替换材质或依赖远程图片。

恢复保留原有材质 ID、URL、参数和已有资源，只补齐缺失文件：

- 缩略图：原始 diffuse / basecolor 图缩放至 256 × 256，WebP quality 88。
- 涂装贴图：原始对应通道缩放至 512 × 512，标准 UASTC KTX2 + Zstandard，
  10 级 mipmap；颜色贴图使用 sRGB，其他通道使用线性空间，法线 mipmap 重新归一化。
- specular 图片不冒充 roughness 或 metallic；每个缺失通道均匹配到唯一原图。

这会重建有效的预览图和压缩贴图，不保证与上游未提供的生成文件逐字节相同。

## 检查与重新生成

完整性检查无额外依赖；根目录 `build` 也会先运行该检查：

```sh
node scripts/check-material-assets.mjs
```

恢复脚本需要已安装的项目依赖（Sharp）和官方 Basis Universal WASM 编码器。
使用 [Basis Universal](https://github.com/BinomialLLC/basis_universal) 的固定提交
`99f52d63aa6799cbdaecfe977111dc5ec3b31d47`，无需安装系统级工具：

```sh
mkdir -p .integration-audit/material-recovery
curl -fL https://raw.githubusercontent.com/BinomialLLC/basis_universal/99f52d63aa6799cbdaecfe977111dc5ec3b31d47/webgl/encoder/build/basis_encoder.js -o .integration-audit/material-recovery/basis_encoder.js
curl -fL https://raw.githubusercontent.com/BinomialLLC/basis_universal/99f52d63aa6799cbdaecfe977111dc5ec3b31d47/webgl/encoder/build/basis_encoder.wasm -o .integration-audit/material-recovery/basis_encoder.wasm
node scripts/recover-material-assets.mjs .integration-audit/material-recovery/basis_encoder.js
node scripts/check-material-assets.mjs
```

脚本预先检查所有待恢复文件的来源，已有文件不会覆盖，来源有歧义时会停止。
每次恢复的来源路径、原图及输出 SHA-256 和文件大小写入
`.integration-audit/material-recovery/provenance.json`。

## 本次验证

- 恢复前完整性检查实际报出 235 个缺失文件；恢复后 314 / 314 通过。
- 本地生产入口 `http://127.0.0.1:3002` 重启后，314 个 URL 均返回 HTTP 200。
- 65 张 WebP 实际解码通过；使用与应用相同 CDN 的 Basis 解码器验证
  249 张 KTX2 的全部 10 级 mipmap，失败数为 0。
- Chrome 中逐一打开 10 个有纹理的材质分类，65 张图片的 `naturalWidth` 均大于 0，
  没有材质资源请求失败；石材和木材分类截图目视检查通过。
- 继续使用 `evidence/baseline/runtime-data`；重启前后数据库逻辑导出的 SHA-256 一致。
- 本次仅补资源及检查脚本，没有改编辑器运行代码，未重跑完整应用构建。

原始证据位于 `.integration-audit/material-recovery/`：
`validation.json`、`browser-validation.json`、`stone-restored.png`、`wood-restored.png`。
