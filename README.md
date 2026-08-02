> ⚠️ **已冻结（2026-08-02）**：本仓库已合并进 private monorepo `DeliciousBuding/arena`（TS SDK 在 `packages/arena-hero-ts/`，Python 镜像在 `reference/arena-hero-python/`）。保留此仓库仅作历史与上游追踪参考，不再更新。

# Arena Hero TS SDK

Arena Hero 游戏的 TypeScript SDK（`@arena/arena-hero-ts`）——fork 自官方 [arena-hero-python](https://github.com/arena-hero/arena-hero-python)（Apache-2.0），作为 TS 分支持续追上游新功能。

本仓库是**混合仓**：上游 Python SDK 原样保留（`src/` + `docs/`），TS 实现独立在 `packages/arena-hero-ts/`，互不干扰。

## 双轨结构

```
src/                    ← 上游 Python SDK（原样保留，追上游用）
docs/                   ← 上游 Python 文档镜像（quickstart/api-reference，追上游用）
packages/arena-hero-ts/ ← TS 实现（本仓库主角）
contracts/              ← 契约产物（generated/ JSON Schema + fixtures/ 真实样本）
```

- **追上游**：`git remote add upstream https://github.com/arena-hero/arena-hero-python` → `git merge upstream/main`（冲突面 = `src/` Python 侧，TS 包目录不动）→ 协议变更手动同步到 TS 实现（见 `docs/sync-log.md`）。
- 规则权威版本：v0.11（编排层 `docs/game-rules.md`）。

## TS 实现要点

- **wire schema 单源**：`packages/arena-hero-ts/src/wire-schema.ts`（TypeBox）定义全部线上协议（PlayerState / CommandPlan / Accepted / Received / StreamEnvelope / WorldObject），经 `scripts/generate-schemas.mjs` 生成 `contracts/generated/*.schema.json` 契约产物，供跨仓库消费与校验。
- **WebSocket 事件流 + HTTP 提交**：`ArenaHeroClient`（async 迭代器 `turns()`、抖动退避重连、MessageQueue、submit 幂等重试）。
- **Turn builder 控制**：`Worker` / `Vanguard` / `Ranger` / `Core` 动作排队，`submit()` 一次提交完整计划；`replace(plan)` 支持编排层整体注入外部决策计划。
- **类型安全**：wire 校验（TypeBox Compile）+ domain 关系约束（跨字段一致性）分层，拒绝坏消息而非静默。

## 消费方

编排层（arena-agent 等）以 git 依赖引用：

```json
{
  "dependencies": {
    "@arena/arena-hero-ts": "git+https://github.com/DeliciousBuding/arena-hero-ts.git#<commit>"
  }
}
```

根 `package.json` 是 git 依赖安装 wrapper（`main` 指向 `packages/arena-hero-ts/src/index.ts`），消费方安装时自动带上 `typebox` + `ws`。

## 开发

```bash
cd packages/arena-hero-ts
npm install
npx tsc --noEmit                        # 类型检查
node --experimental-transform-types --test "test/*.test.ts"   # 47 测试
node scripts/generate-schemas.mjs       # 契约产物再生成（生成后 git 应保持干净）
```

## 测试

| 文件 | 覆盖 |
|------|------|
| `test/client.test.ts` | WS 生命周期（重连/1008/握手超时）、submit 重试与幂等、APIError |
| `test/turn.test.ts` | Turn 拆分、动作序列、unit id 排序、seal、replace 注入 |
| `test/protocol.test.ts` | encodePlan 与 Python 逐字节兼容、envelope 解析、关系约束 |
| `test/wire-schema.test.ts` | 数值/枚举/判别器校验 + 契约生成 |
| `test/golden-replay.test.ts` | 真实 raw-state fixture 完整解析 |
