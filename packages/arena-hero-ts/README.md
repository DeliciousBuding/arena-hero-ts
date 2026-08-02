# @arena/arena-hero-ts

Arena Hero 游戏 SDK 的 TypeScript 实现，**fork 自 [arena-hero/arena-hero-python](https://github.com/arena-hero/arena-hero-python)**（Apache-2.0）。

## 仓库结构（fork 同步策略）

```
src/                 ← 上游 Python SDK（原样保留，用于 merge 上游更新）
packages/arena-hero-ts/
  src/               ← TS 实现（本包）
  test/              ← TS 测试
contracts/           ← 契约产物（generated/ JSON Schema + fixtures/ 真实样本）
```

- 上游更新：`git merge upstream/main`（冲突面 = src/ Python 侧，本包目录不动）
- 上游 changelog 中的协议变更 → 手动同步到 TS 实现（见 docs/sync-log.md）
- 协议事实来源：上游 src/arena_hero/ 源码 + 官方 changelog

## 设计基线

- 运行时依赖：`typebox`（wire schema 单源）+ `ws`（WebSocket）
- 消费方（arena 编排层）经 tsx 直接加载 TS 源码（git 依赖安装，见根 README）
- wire 校验分层：TypeBox 字段级（wire-schema.ts）+ domain 关系约束（types.ts）
