# 灯串配色与效果预设依据

核对日期：2026-09-21。目标是复用厂家公开的产品分类和常见控制器模式，不把商业命名当成统一行业标准。

## 配色

内置八种配色由用户给出的真实产品范围确定：白色、暖色、紫色、橙紫色、绿色、红蓝白、红蓝黄绿、粉色。多色按用户指定顺序循环；不同 SKU 的顺序可以在预设编辑器中调整。节日是用途标签，不限定灯头或布置形态。

- [NOMA 灯串产品目录](https://www.noma.co.uk/collections/christmas-string-lights)公开使用 White、Warm White、Multi、Red、Green、Duo 等商品分类。
- [Wintergreen C6 产品目录](https://www.christmaslightsetc.com/LED-christmas-lights-c6.htm)提供暖白、冷白、多色、紫、绿、粉等款式，同时给出固定灯数与间距。颜色一致性和灯距属于产品规格。
- [Kringle Traditions 橙紫万圣节灯串](https://www.christmaslightsetc.com/p/Orange-Purple-Halloween-Icicle-Lights-Black-Wire-5885.htm)明确标注橙紫配色与常亮，说明节日配色本身不意味着动态功能。
- [爱国节日灯产品目录](https://www.christmaslightsetc.com/patriotic-decorations.htm)使用红、白、蓝组合；插件保留用户要求的红、蓝、白顺序，不声称这是所有商品的实际装配顺序。
- [情人节灯目录](https://www.christmaslightsetc.com/Valentine-Lights--805.htm)提供粉色灯串。绿色的圣帕特里克节标签沿用用户指定用途。

HEX 是可编辑的屏幕预览色，不是厂家实测光谱、统一色温或标准色号。红蓝黄绿四种颜色来自用户的产品要求，不能用厂商泛称的 Multicolor 推断所有多色灯串都恰好是这四种。默认不提供虚构节日渐变，手动渐变仍作为用户自定义能力保留。

## 动态模式

[Festive Lights 自有 ConnectGo 系统说明](https://festive-lights.com/pages/connectgo-overview)列出 Combination、In Waves、Sequential、Slow-Glow、Flash、Slow Fade、Twinkling、Steady On。[品牌系统对比](https://festive-lights.com/pages/difference-between-connectgo-connectpro)同时说明 ConnectPro 只有静态开关，证明不能把八功能当成所有灯串的能力。

[ConnectGo 产品页](https://www.festive-lights.com/connectgo-festoon-lights-connectable-frosted-cap-multi-bulbs-black-cable)进一步区分变压器、电池和太阳能供电下的模式。插件采用常见中文名：组合循环、波浪、顺序点亮、缓慢明暗、追逐闪烁、缓慢渐隐、闪烁、常亮。

公开资料支持模式名称和功能分类，没有给出统一 PWM 波形、闪烁周期、逐灯寻址或分路时序。因此这里的算法是可调速度与亮度的视觉模拟，不是某一控制器固件复刻，也不模拟供电与电气性能。模式选择需匹配实际产品；普通固定色灯串也可能配有多功能控制器，故动态亮度不等同于智能变色。

## 智能款与自建预设

[Twinkly 效果库](https://help.twinkly.com/hc/en-gb/articles/18277857033501-what-s-the-effects-gallery)按 RGB、RGB+W、AWW 灯珠能力组织效果；[编辑预设说明](https://help.twinkly.com/hc/en-gb/articles/18277872204573-how-do-i-edit-a-preset-effect)支持调整内置效果并保存为自己的版本。这里只参考产品交互原则，不复制其效果资源。

插件颜色模板不隐式开启智能款。随机颜色仅 `smart=true` 可应用。尺寸、沿线间距永不随机。颜色与发光模板分别保存，互不覆盖；预设编辑不自动修改已创建对象。

## 保存范围

自建和覆盖系统的预设存储在当前浏览器本地库 `pascal:string-light-presets:v1`，使用严格 Zod 校验，颜色模板只能保存配色/排列，发光模板只能保存亮度/模式/速度。保存失败显示提示，取消不写入。系统预设可恢复默认参数后保存；自建预设可删除。

场景仅保存应用后的具体参数，不依赖模板 ID。即使换浏览器、删除或修改模板，已保存灯串仍能按其参数渲染。预设库本身当前不做账户云同步或跨浏览器同步。

## 发光边界

复用实例化自发光材质；不新增逐灯点光源、光晕后处理或照度计算。发光动画只调整发光强度，不改变产品颜色序列或几何。实体/无材质查看模式依旧遵循宿主材质替换逻辑，查看自发光需开启材质着色。
