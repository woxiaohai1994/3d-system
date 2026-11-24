# ADR 003：按文件能力迁移，保留来源身份

状态：接受设计，来源文件映射已生成，移植实施尚未开始。

donor checkout 只读。每个迁入文件记录固定 SHA、原路径、许可、目标、依赖和测试；纯数据/校验尽量保留可核对来源，UI、存储和渲染耦合部分明确标为适配或重写。保留来源 notice，不复制应用配置或发布流水线。

房间轮廓限定 rectangle/L/T/U；家具组合限定 Living Room、Bedroom、Kitchen、Bathroom、Office、Dining Room。模板固定厘米/角度数据必须统一转换为宿主单位和父局部坐标。家具目录使用显式 ID 映射，缺项不得默默换成同名对象。资产只导入确需且许可核实的子集。

静态 GLB 安全校验、项目包 ZIP 安全限制可以迁移；Svelte store、native PlanDocument、donor renderer、云账户/配额和浏览器密钥持久化不迁入。T06/T08/T09 分别完成准入、归档和模板验收。
