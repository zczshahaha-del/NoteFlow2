from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "server"
OUTPUT = ROOT / "docs" / "current-baseline" / "database-runtime.md"


def _cell(value: object) -> str:
    return str(value if value is not None else "-").replace("|", "\\|").replace("\n", " ")


async def main_async() -> None:
    sys.path.insert(0, str(SERVER_ROOT))
    os.chdir(ROOT)
    import asyncpg
    from app.config import cfg
    from app.models.db import Base

    connection = await asyncpg.connect(
        host=cfg.DB_HOST,
        port=int(cfg.DB_PORT),
        user=cfg.DB_USER,
        password=cfg.DB_PASSWORD,
        database=cfg.DB_NAME,
    )
    try:
        version = await connection.fetchval("select version()")
        migration = await connection.fetchval("select version_num from alembic_version")
        extensions = await connection.fetch("select extname, extversion from pg_extension order by extname")
        tables = await connection.fetch(
            """
            select table_name
            from information_schema.tables
            where table_schema = 'public' and table_type = 'BASE TABLE'
            order by table_name
            """
        )
        runtime_tables = [row["table_name"] for row in tables]
        row_counts: list[tuple[str, int]] = []
        for table in runtime_tables:
            count = await connection.fetchval(f'SELECT count(*) FROM "{table}"')
            row_counts.append((table, int(count)))

        indexes = await connection.fetch(
            """
            select tablename, indexname, indexdef
            from pg_indexes
            where schemaname = 'public'
            order by tablename, indexname
            """
        )
        foreign_keys = await connection.fetch(
            """
            select tc.table_name, tc.constraint_name, kcu.column_name,
                   ccu.table_name as foreign_table_name, ccu.column_name as foreign_column_name,
                   rc.delete_rule
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on tc.constraint_name = kcu.constraint_name and tc.constraint_schema = kcu.constraint_schema
            join information_schema.constraint_column_usage ccu
              on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
            join information_schema.referential_constraints rc
              on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.constraint_schema
            where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
            order by tc.table_name, tc.constraint_name
            """
        )

        model_tables = sorted(Base.metadata.tables)
        runtime_only = sorted(set(runtime_tables) - set(model_tables))
        model_only = sorted(set(model_tables) - set(runtime_tables))
        vector_indexes = [row for row in indexes if "vector" in row["indexdef"].lower() or "hnsw" in row["indexdef"].lower()]

        lines = [
            "# NoteFlow 当前 PostgreSQL 运行时基线",
            "",
            "> 由 `scripts/export_database_runtime.py` 从真实 PostgreSQL 只读导出；不包含密码、正文或用户内容。",
            "",
            f"- PostgreSQL：`{_cell(version)}`",
            f"- Alembic revision：`{migration}`",
            f"- 运行时表数：{len(runtime_tables)}",
            f"- SQLAlchemy 模型表数：{len(model_tables)}",
            f"- 仅数据库存在：{', '.join(runtime_only) or '无'}",
            f"- 仅模型存在：{', '.join(model_only) or '无'}",
            f"- 索引数：{len(indexes)}",
            f"- 外键数：{len(foreign_keys)}",
            "",
            "## 扩展",
            "",
            "| 扩展 | 版本 |",
            "|---|---|",
        ]
        lines.extend(f"| `{row['extname']}` | `{row['extversion']}` |" for row in extensions)
        lines.extend(
            [
                "",
                "## 表行数快照",
                "",
                "| 表 | 行数 |",
                "|---|---:|",
            ]
        )
        lines.extend(f"| `{table}` | {count} |" for table, count in row_counts)
        lines.extend(
            [
                "",
                "## pgvector 索引",
                "",
            ]
        )
        if vector_indexes:
            lines.extend(f"- `{row['indexname']}`：`{_cell(row['indexdef'])}`" for row in vector_indexes)
        else:
            lines.append("- 未发现向量索引。")
        lines.extend(
            [
                "",
                "## 软删除基线",
                "",
                "- `notes`、`note_categories`、`user_memories` 使用 `deleted_at` 软删除语义。",
                "- 草稿、编辑预览、运行记录和索引任务使用状态字段控制生命周期。",
                "- 用户删除依赖外键级联清理所属数据；笔记删除默认不物理删除正文。",
                "",
            ]
        )
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text("\n".join(lines), encoding="utf-8")
        print(f"database runtime baseline exported to {OUTPUT}")
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main_async())
