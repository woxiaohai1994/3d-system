# 固定版本插件的界面语言补丁

六个 GitHub 插件的 ref 与 apps/editor/package.json 一致。补丁仅接入编辑器语言 API 和 UI 文案，不改协议值。manifest.json 记录每个修改文件的上游与补丁后 SHA-256。

安装依赖后根 postinstall 执行 `bun scripts/apply-localization-patches.ts`；`bun run check:localization:patches` 只做校验。首次应用前校验所有版本、文件和 git apply --check；重复安装跳过已应用文件。部分应用、上游变化或本地修改均失败退出，不能默默覆盖。

升级插件时先审查新的固定源码及文案入口，再重新生成补丁和两侧摘要，运行补丁测试、类型检查、构建及浏览器语言切换。不要直接修改 manifest 以接受未知源码，也不要修改 Bun 共享缓存。当前使用独立 git apply 补丁，是因为本机 Bun 1.3.14 的 patch --commit 崩溃；无需运行该命令。

脚本依赖 Git。包缺失时请先按锁文件安装依赖，勿将缺包或版本不匹配当作可忽略的语言回退。
