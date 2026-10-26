# n8n-nodes-lifespace 0.2.10 — Core compatibility / 契约对齐

## 中文

目标版本：LifeSpace Core Kernel **0.53.0**，Integration/Eventing **0.3.0**；普通模型的语义以运行环境中发布的 Discovery / Model Contract（`modelKey`、`schemaHash`）为准，而不是仅用 Kernel 版本推断模型能力。

本次通过 #113 对齐最新的 `location` Canonical Field：Workflow Resource Mapper 投影为结构化对象；Agent Tool 直接消费 LifeSpace 发布的 `valueSchema`，不得自行地理编码；Canonical Query 支持 `withinDistance`、`isNull`、`isNotNull`。增加 Workflow、Agent Create 及空间查询回归测试。#112 的 Semantic Relation 字段顺序修复也包含在 0.2.10 内。

与 Core 已对齐的现有表面包括：Service/Agent Credentials 与 Delegation、配置期模型发现、Person Directory、普通模型 CRUD/Action、原子 Batch 与非原子 Bulk、Canonical Query、文件上传、`enum_list`/`file_ref_list`、`recurrence_rule`/`entity_ref`、外部模型动态字段投影与 Semantic Relations。

**边界 / 非承诺**：
- Core Kernel 0.53.0 不等于所有环境已部署 Event 的 Location breaking migration（Core Schema 74）。消费端要检查实际发布的模型 `schemaHash`，并在模型改变后刷新 n8n 编辑器中的字段与已固定的 Agent Tool Snapshot。
- Habit Check-in、Record Icon 等能力不在本版新增专门节点 UI；如需直接调用平台专用路由，可使用现有 API Request 路径并遵循 Core 授权约束。不将它们宣传为本版新增的一等节点操作。
- n8n CI 校验的是本仓库静态契约、构建、Lint 和模拟请求/字段投影；没有生产凭据，因此 **不代表对 Production 进行了端到端写入验证**。
- Schema/Model 兼容性由 Core 动态 Discovery 控制；Adapter 不保存第二套领域模型、地理服务或授权策略。

发布门禁：先合并 0.2.10 的 `package.json` / `package-lock.json`，验证三个版本字段一致并等待 **main CI 成功**；再仅在 CI 验证的 exact main SHA 上创建 `0.2.10` 标签，并触发原 `publish.yml` 的 npm trusted provenance 发布。不得提前打 tag。

## English

This release aligns supported node adapter surfaces to Core Kernel 0.53.0 without copying the platform's domain semantics into n8n. Model features are discovered per published model `schemaHash`. The new Location projection and `withinDistance` handling are covered by regression tests; #112's Semantic Relation field-order correction is included.

A migrated Event Location is available only after the target environment publishes that model revision. Refresh the pinned Agent Tool schema after a breaking model update. Specialized Habit Check-in / Record Icon UX is out of scope. Repository CI is not a production integration test.

The one-time release helper tags only a green exact main SHA and dispatches the existing trusted publish workflow; remove the helper after verified publication.
