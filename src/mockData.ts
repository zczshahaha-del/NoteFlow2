import type { FileNode } from "./types";

const redisContent = `在实际生产环境中，Redis 缓存虽然能显著提升系统性能，但也会遇到一些常见问题，主要包括：缓存穿透、缓存击穿和缓存雪崩。

1. 缓存穿透

指查询一个在缓存和数据库中都不存在的数据，导致请求直接落到数据库，造成数据库压力。

解决方案：
- 接口参数校验，避免非法请求
- 缓存空对象 Null 值，并设置较短过期时间
- 使用布隆过滤器拦截不存在的 key

2. 缓存击穿

指某个热点 key 在过期的瞬间，大量并发请求同时落到数据库，导致数据库瞬时压力骤增。

解决方案：
- 设置热点 key 永不过期，定期异步刷新
- 使用互斥锁或分布式锁，保证同一时间只有一个请求重建缓存
- 提前预热热点数据

示例：使用 Redis 互斥锁控制缓存重建。

\`\`\`go
lockKey := "lock:product:1001"
token := uuid.NewString()
locked, err := rdb.SetNX(ctx, lockKey, token, 10*time.Second).Result()
if err != nil {
    return err
}
if locked {
    defer releaseLock(ctx, lockKey, token)
    return rebuildProductCache(ctx, 1001)
}
\`\`\`

3. 缓存雪崩

指大量 key 同时过期，或 Redis 故障宕机，大量请求直接打到数据库，导致系统崩溃。

解决方案：
- 随机设置 key 过期时间，避免集中失效
- 多级缓存，本地缓存 + Redis
- Redis 集群高可用，保证服务稳定`;

const redisDistributedLock = `## Redis 分布式锁

在分布式系统中，多个服务实例需要互斥地访问共享资源，Redis 分布式锁是最常见的实现方式之一。

### 基本原理

使用 SET NX PX 命令，将 key 作为锁标识，value 使用唯一标识（如 UUID），并设置过期时间防止死锁。

### 关键要点

- 加锁需要原子性，使用 SET key value NX PX timeout
- 释放锁需要 Lua 脚本校验 value，防止误删别人的锁
- 使用 RedLock 算法提高可用性
- 考虑锁续期机制，防止业务超时导致锁提前释放

### 常见问题

- 时钟漂移可能导致锁过期判断不准
- RedLock 在 GC 暂停时可能失效
- 单节点方案在主从切换时可能丢失锁`;

const redisPersistence = `## Redis 持久化机制

Redis 提供了两种持久化方式：RDB 快照和 AOF 日志。

### RDB（Redis Database）

在指定的时间间隔内，将内存中的数据快照写入磁盘。

优点：
- 文件紧凑，适合灾备恢复
- 对性能影响小
- 恢复大数据集速度快

缺点：
- 可能丢失最后一次快照后的数据
- 数据量大时 fork 子进程耗时

### AOF（Append Only File）

将每一条写命令追加到日志文件中。

优点：
- 数据安全性更高，最多丢失 1 秒数据
- AOF 文件可读，便于误操作恢复

缺点：
- 文件体积大
- 恢复速度慢于 RDB

### 混合持久化

Redis 4.0 后支持混合模式，结合 RDB 和 AOF 的优点。`;

const redisDataTypes = `## Redis 数据类型总结

Redis 支持丰富的数据类型，每种都有其适用的业务场景。

### String（字符串）

最基本的类型，可以是字符串、整数或浮点数。

使用场景：缓存、计数器、分布式锁、Session 共享

### Hash（哈希）

键值对集合，适合存储对象。

使用场景：用户信息、商品信息、购物车

### List（列表）

有序的字符串列表，支持两端操作。

使用场景：消息队列、最新列表、时间线

### Set（集合）

无序不重复的字符串集合。

使用场景：标签、共同好友、去重统计

### Sorted Set（有序集合）

每个元素关联一个分数，按分数排序。

使用场景：排行榜、延迟队列、时间线排序

### 高级类型

- Bitmap：签到统计
- HyperLogLog：UV 统计
- Geo：地理位置
- Stream：消息队列`;

const redisCluster = `## Redis Cluster 笔记

Redis Cluster 是 Redis 官方提供的分布式解决方案。

### 架构特点

- 无中心节点，所有节点互相连接
- 使用哈希槽（hash slot）分片，共 16384 个槽
- 每个节点负责一部分槽
- 客户端可以连接任意节点，自动重定向

### 数据分布

使用 CRC16(key) % 16384 计算 key 所在的槽。

### 高可用

- 每个主节点可以有多个从节点
- 主节点故障时，从节点自动升级
- 需要半数以上主节点存活才能提供服务

### 限制

- 不支持多 key 跨槽操作
- 批量操作要求 key 在同一个槽
- 事务只支持单个节点`;

export const treeData: FileNode[] = [];

export function findFileById(
  nodes: FileNode[],
  id: string
): FileNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findFileById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}
