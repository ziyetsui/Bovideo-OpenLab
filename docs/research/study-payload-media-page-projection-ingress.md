# Study: Payload Media 与 PageProjection 的数据入口

Status: Done · Owner: pSEO platform · Date: 2026-08-26 · Source: local implementation at `phase2-local`

## Question

本地自动化和 assets 应当通过哪些 Payload 集合进入系统，经过哪些关卡后才能成为 pSEO Hub、Gallery、Entity、Detail 页面？为什么当前 Payload Admin 与 Hub 没有真实数据？

## Architecture map

```text
外部自动化 / 资产目录
  │
  │  verified snapshot: manifest.json + normalized_posts.jsonl
  │                   + raw_posts.jsonl | media_refs.jsonl
  ▼
Snapshot importer
  ├── Sources                 原始来源与私有 raw ObjectRef
  ├── PromptArtifacts         draft prompt / metadata
  ├── MediaEvidence           私有证据（默认 metadata_only）
  └── WorkflowRuns            幂等、审计、可恢复的导入账本
          │
          │  模块生成、图谱提取、审核、rights / locale gates
          ▼
Page blueprint / projector    [尚未完成]
  └── PageProjections         immutable renderer-ready page + navigation + slots
          │
          │  released projection IDs bound to active publish_version
          ▼
ActivePublicationPointer      [尚未完成绑定 read-plane]
          ▼
Next routes → /frontend       只读取已绑定的 active projection

独立公开媒体路径
  approved first-party / redistribution-licensed object
          ▼
Payload Media + public-media ObjectRef
          ▼
APPROVED_MEDIA_CATALOG → public <img>/<video>
```

## Findings

1. **Payload `media` 不是所有文件的通用入库桶。** 它要求受信任的 `object_ref`、`public-media` namespace、`first_party` 或 `redistribution_licensed` rights 和 active deletion state；本地上传也被关闭（`src/collections/Media.ts:7-41`）。因此 X/竞品抓取到的图片或视频不能直接上传为公开 Media。

2. **远程素材应先作为私有 `media-evidence` 进入。** 该集合无上传配置、读取权限恒为 false，远程 URL/thumbnail 也不可读取；写入还要求 source version 和 workflow run provenance（`src/collections/MediaEvidence.ts:7-68`）。这正是“可审计但不公开再分发”的证据层。

3. **现有 snapshot importer 已能导入 Sources、PromptArtifacts 和 MediaEvidence，但尚未导入 PageProjection。** 它校验 manifest、normalized post 与 media 流的一致性后，写入 workflow run、Source、draft PromptArtifact 与 private MediaEvidence（`src/imports/higgsfield-snapshot.ts:430-556`）。Snapshot 最低输入为 `manifest.json`、`normalized_posts.jsonl` 和 `raw_posts.jsonl` 或 `media_refs.jsonl`（同文件:436-455）。

4. **PageProjection 只能由受控 projector 写入，不应由资产自动化直接拼 JSON。** Payload collection 对 projection、navigation、slot contract 做 strict Zod validation、append-only 限制，并拒绝直接 `released` state（`src/collections/PageProjections.ts:6-78`）。其输入必须是已经审核的 Prompt/Module/graph facts，而不是“文件夹中的静态资源”。

5. **当前实际阻塞点在 Projection materialization + active publication read-plane。** 执行台账显示 snapshot import、workflow 和 graph extraction 已完成；module generation、wireframe blueprint/projector、projection repository、release binding 仍未完成（`.superpowers/sdd/2026-08-26-contract-driven-pseo-projections/progress.md:49-76`）。前端 resolver 因没有 `publish_version → projection` 绑定而在生产环境 fail closed，只允许 `PSEO_FRONTEND_PREVIEW=1` 的开发注入（`frontend/routes/resolve-active-projection.ts:23-59`）。

6. **当前本地 Admin 数据库本来就不会持久化。** `dev:local` 的 wrapper 使用临时目录、`persistent: false`，并在子进程结束后停止数据库并删除目录（`scripts/run-with-postgres.ts:30-40`, `84-86`）。即使手动写入，关闭本地服务后记录也会消失。

## Snapshot validation

用户提供的绝对目录 `/Users/a1/Documents/wiki/30-39 Product and Web Builds/bo/assets` 中有一份可直接使用的 snapshot：`higgsfield-x-prompts-2026-08-20-twitter241`。它包含 `manifest.json`、`normalized_posts.jsonl` 和 `raw_posts.jsonl`，并且 manifest 覆盖这些输入。

于 2026-08-26 对该目录运行了无写入 `importHiggsfieldSnapshot({ dryRun: true })`。结果为：

```text
manifestHash: sha256:v1:0ddadea23a8dcee6d91269d0ded4086502be6035f87c57598194674f2b640f1b
dryRun: true
```

这证明 hash、JSONL 格式以及 post/media 关联通过了 importer 的预检；`created` / `skipped` 为零是 dry-run 的预期结果，不能代表待写入记录数。

## Decision

**GO-with-amendments：采用“snapshot → private evidence/artifact → review/module/graph → immutable projection → active publication”流程；不要让 assets 直接填 PageProjection 或公开 Media。**

实施规则：

1. 先配置持久化本地 PostgreSQL（或团队共享 dev DB），再让 Payload Admin 成为可观察的长期数据面。
2. 自动化产出一个 hash-verified snapshot 目录；第一步先运行 dry-run，展示将创建/跳过的 Source、Artifact、MediaEvidence 数量。
3. 将 importer 暴露为受权限保护的 CLI/API，不允许管理员直接手工构造 PageProjection JSON。
4. 只有 rights 合格的自有/获许可媒体进入 `media`；其余进入 `media-evidence`。
5. 完成 P3 Task 6–8：modules → wireframe blueprints/projector → Payload repository + active publication binding。完成后前端即可从实际 active PageProjection 自动渲染，无需 preview fixture。
6. 最后完成 release adapter：将已验证 projection IDs 与 `publish_version` 一起记录，并原子更新 active pointer；sitemap 只读取 released projections。

## Open questions

- `spike-automation-snapshot-adapter.md`：用户现有自动化输出的绝对目录、文件格式和 rights metadata 是否能无损映射到 verified snapshot。
- `spike-persistent-local-payload-runtime.md`：本机持久 PostgreSQL 的运行方式、备份与 developer reset 约定。
