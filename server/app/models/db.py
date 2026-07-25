from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.services.pgvector import Vector

LONGTEXT = Text
EMBEDDING_DIMENSIONS = 1024


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: uuid.uuid4().hex)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column("display_name", String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column("password_hash", String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    knowledge_base: Mapped["KnowledgeBase"] = relationship(back_populates="user", cascade="all, delete-orphan")
    note_categories: Mapped[list["NoteCategory"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    notes: Mapped[list["Note"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    note_versions: Mapped[list["NoteVersion"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    note_drafts: Mapped[list["NoteDraft"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    note_edit_previews: Mapped[list["NoteEditPreview"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    note_embeddings: Mapped[list["NoteEmbedding"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    user_memories: Mapped[list["UserMemory"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    user_memory_events: Mapped[list["UserMemoryEvent"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    chat_messages: Mapped[list["ChatMessage"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    agent_runs: Mapped[list["AgentRun"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    agent_steps: Mapped[list["AgentStep"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    agent_tool_traces: Mapped[list["AgentToolTrace"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    agent_checkpoints: Mapped[list["AgentCheckpoint"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    settings: Mapped["UserSettings"] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    memory_enabled: Mapped[bool] = mapped_column("memory_enabled", Boolean, nullable=False, default=True)
    preferences: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="settings")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_agent: Mapped[Optional[str]] = mapped_column("user_agent", String(512), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column("ip_address", String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column("last_seen_at", DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column("expires_at", DateTime, nullable=False, index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column("revoked_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="sessions")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column("token_hash", String(64), nullable=False, unique=True)
    requested_ip: Mapped[Optional[str]] = mapped_column("requested_ip", String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column("expires_at", DateTime, nullable=False, index=True)
    used_at: Mapped[Optional[datetime]] = mapped_column("used_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="password_reset_tokens")


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    tree_data: Mapped[dict] = mapped_column("tree_data", JSON, nullable=False, default=lambda: [])
    file_contents: Mapped[dict] = mapped_column("file_contents", JSON, nullable=False, default=lambda: {})
    selected_file_id: Mapped[Optional[str]] = mapped_column("selected_file_id", String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="knowledge_base")


class NoteCategory(Base):
    __tablename__ = "note_categories"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column("parent_id", String(64), ForeignKey("note_categories.id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column("sort_order", Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]] = mapped_column("deleted_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="note_categories")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[Optional[str]] = mapped_column("category_id", String(64), ForeignKey("note_categories.id", ondelete="SET NULL"), nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    content: Mapped[str] = mapped_column(LONGTEXT, nullable=False, default="")
    is_pinned: Mapped[bool] = mapped_column("is_pinned", Boolean, nullable=False, default=False)
    is_favorite: Mapped[bool] = mapped_column("is_favorite", Boolean, nullable=False, default=False)
    index_status: Mapped[str] = mapped_column("index_status", String(50), nullable=False, default="pending")
    index_version: Mapped[Optional[str]] = mapped_column("index_version", String(128), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column("idempotency_key", String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]] = mapped_column("deleted_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="notes")


class NoteAttachment(Base):
    __tablename__ = "note_attachments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    note_id: Mapped[Optional[str]] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=True, index=True)
    file_name: Mapped[str] = mapped_column("file_name", String(255), nullable=False)
    content_type: Mapped[str] = mapped_column("content_type", String(120), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    storage_key: Mapped[str] = mapped_column("storage_key", String(512), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


class NoteVersion(Base):
    __tablename__ = "note_versions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(LONGTEXT, nullable=False)
    change_summary: Mapped[Optional[str]] = mapped_column("change_summary", Text, nullable=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="manual_edit")
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="note_versions")


class NoteSection(Base):
    __tablename__ = "note_sections"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id: Mapped[Optional[str]] = mapped_column("parent_id", String(64), ForeignKey("note_sections.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    sort_order: Mapped[int] = mapped_column("sort_order", Integer, nullable=False, default=0)
    content: Mapped[str] = mapped_column(LONGTEXT, nullable=False, default="")
    token_count: Mapped[int] = mapped_column("token_count", Integer, nullable=False, default=0)
    content_hash: Mapped[str] = mapped_column("content_hash", String(64), nullable=False, default="", index=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


class NoteChunk(Base):
    __tablename__ = "note_chunks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    section_id: Mapped[str] = mapped_column("section_id", String(64), ForeignKey("note_sections.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column("chunk_index", Integer, nullable=False, default=0)
    content: Mapped[str] = mapped_column(LONGTEXT, nullable=False, default="")
    token_count: Mapped[int] = mapped_column("token_count", Integer, nullable=False, default=0)
    content_hash: Mapped[str] = mapped_column("content_hash", String(64), nullable=False, default="", index=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


class NoteEmbedding(Base):
    __tablename__ = "note_embeddings"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    chunk_id: Mapped[str] = mapped_column("chunk_id", String(64), ForeignKey("note_chunks.id", ondelete="CASCADE"), nullable=False, index=True)
    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    section_id: Mapped[str] = mapped_column("section_id", String(64), ForeignKey("note_sections.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="dashscope")
    embedding_model: Mapped[str] = mapped_column("embedding_model", String(100), nullable=False, default="")
    embedding_dim: Mapped[int] = mapped_column("embedding_dim", Integer, nullable=False, default=0)
    content_hash: Mapped[str] = mapped_column("content_hash", String(64), nullable=False, index=True)
    embedding: Mapped[list] = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    error_message: Mapped[Optional[str]] = mapped_column("error_message", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    indexed_at: Mapped[Optional[datetime]] = mapped_column("indexed_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="note_embeddings")


class NoteIndexJob(Base):
    __tablename__ = "note_index_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    error_message: Mapped[Optional[str]] = mapped_column("error_message", Text, nullable=True)
    stats: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    retry_count: Mapped[int] = mapped_column("retry_count", Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column("max_retries", Integer, nullable=False, default=3)
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column("next_attempt_at", DateTime, nullable=True, index=True)
    claim_owner: Mapped[Optional[str]] = mapped_column("claim_owner", String(160), nullable=True, index=True)
    claimed_at: Mapped[Optional[datetime]] = mapped_column("claimed_at", DateTime, nullable=True)
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column("heartbeat_at", DateTime, nullable=True, index=True)
    error_code: Mapped[Optional[str]] = mapped_column("error_code", String(80), nullable=True)
    source_version: Mapped[Optional[str]] = mapped_column("source_version", String(128), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column("idempotency_key", String(200), nullable=True)
    parser_version: Mapped[Optional[str]] = mapped_column("parser_version", String(80), nullable=True)
    chunker_version: Mapped[Optional[str]] = mapped_column("chunker_version", String(80), nullable=True)
    embedding_version: Mapped[Optional[str]] = mapped_column("embedding_version", String(120), nullable=True)
    graph_version: Mapped[Optional[str]] = mapped_column("graph_version", String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column("started_at", DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column("finished_at", DateTime, nullable=True)


class RagV2IndexState(Base):
    """Atomic pointer to the only source version visible to RAG v2."""

    __tablename__ = "rag_v2_index_states"

    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    source_version: Mapped[str] = mapped_column("source_version", String(128), nullable=False, default="")
    parser_version: Mapped[str] = mapped_column("parser_version", String(80), nullable=False, default="")
    chunker_version: Mapped[str] = mapped_column("chunker_version", String(80), nullable=False, default="")
    embedding_version: Mapped[str] = mapped_column("embedding_version", String(120), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    node_count: Mapped[int] = mapped_column("node_count", Integer, nullable=False, default=0)
    error_code: Mapped[Optional[str]] = mapped_column("error_code", String(80), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column("error_message", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    indexed_at: Mapped[Optional[datetime]] = mapped_column("indexed_at", DateTime, nullable=True)


class RagV2Node(Base):
    """Versioned, structured Markdown node used only by the v2 retriever."""

    __tablename__ = "rag_v2_nodes"
    __table_args__ = (
        Index("ix_rag_v2_nodes_visible", "user_id", "active", "source_version"),
        Index("ix_rag_v2_nodes_note_section", "note_id", "section_key"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    section_key: Mapped[str] = mapped_column("section_key", String(64), nullable=False, index=True)
    section_path: Mapped[list] = mapped_column("section_path", JSON, nullable=False, default=lambda: [])
    node_type: Mapped[str] = mapped_column("node_type", String(32), nullable=False, default="text")
    node_index: Mapped[int] = mapped_column("node_index", Integer, nullable=False, default=0)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    token_count: Mapped[int] = mapped_column("token_count", Integer, nullable=False, default=0)
    content_hash: Mapped[str] = mapped_column("content_hash", String(64), nullable=False, index=True)
    source_version: Mapped[str] = mapped_column("source_version", String(128), nullable=False, index=True)
    parser_version: Mapped[str] = mapped_column("parser_version", String(80), nullable=False)
    chunker_version: Mapped[str] = mapped_column("chunker_version", String(80), nullable=False)
    block_types: Mapped[list] = mapped_column("block_types", JSON, nullable=False, default=lambda: [])
    node_metadata: Mapped[dict] = mapped_column("node_metadata", JSON, nullable=False, default=lambda: {})
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RagV2Embedding(Base):
    __tablename__ = "rag_v2_embeddings"
    __table_args__ = (
        UniqueConstraint("node_id", "provider", "embedding_model", "embedding_dim", name="uq_rag_v2_embedding_version"),
        Index("ix_rag_v2_embeddings_vector_ready", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    node_id: Mapped[str] = mapped_column("node_id", String(64), ForeignKey("rag_v2_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    embedding_model: Mapped[str] = mapped_column("embedding_model", String(100), nullable=False)
    embedding_dim: Mapped[int] = mapped_column("embedding_dim", Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column("content_hash", String(64), nullable=False, index=True)
    embedding: Mapped[list] = mapped_column(Vector(EMBEDDING_DIMENSIONS), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    error_message: Mapped[Optional[str]] = mapped_column("error_message", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    indexed_at: Mapped[Optional[datetime]] = mapped_column("indexed_at", DateTime, nullable=True)


class NoteDraft(Base):
    __tablename__ = "note_drafts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[Optional[str]] = mapped_column("category_id", String(64), ForeignKey("note_categories.id", ondelete="SET NULL"), nullable=True)
    note_type: Mapped[str] = mapped_column("note_type", String(64), nullable=False, default="学习笔记")
    writing_tone: Mapped[str] = mapped_column("writing_tone", String(64), nullable=False, default="通俗易懂")
    note_format: Mapped[str] = mapped_column("note_format", String(64), nullable=False, default="详细教程")
    heading_level: Mapped[str] = mapped_column("heading_level", String(64), nullable=False, default="H2 / H3 / H4")
    include_code: Mapped[bool] = mapped_column("include_code", Boolean, nullable=False, default=True)
    include_exercises: Mapped[bool] = mapped_column("include_exercises", Boolean, nullable=False, default=True)
    extra_request: Mapped[str] = mapped_column("extra_request", Text, nullable=False, default="")
    draft_config: Mapped[dict] = mapped_column("draft_config", JSON, nullable=False, default=lambda: {})
    outline: Mapped[str] = mapped_column(LONGTEXT, nullable=False, default="")
    assembled_content: Mapped[str] = mapped_column("assembled_content", LONGTEXT, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="configuring")
    saved_note_id: Mapped[Optional[str]] = mapped_column("saved_note_id", String(64), ForeignKey("notes.id", ondelete="SET NULL"), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column("idempotency_key", String(160), nullable=True)
    runtime: Mapped[str] = mapped_column(String(32), nullable=False, default="langgraph")
    graph_thread_id: Mapped[Optional[str]] = mapped_column("graph_thread_id", String(160), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    canceled_at: Mapped[Optional[datetime]] = mapped_column("canceled_at", DateTime, nullable=True)
    saved_at: Mapped[Optional[datetime]] = mapped_column("saved_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="note_drafts")
    sections: Mapped[list["NoteDraftSection"]] = relationship(back_populates="draft", cascade="all, delete-orphan")


class NoteDraftSection(Base):
    __tablename__ = "note_draft_sections"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    draft_id: Mapped[str] = mapped_column("draft_id", String(64), ForeignKey("note_drafts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    sort_order: Mapped[int] = mapped_column("sort_order", Integer, nullable=False, default=0)
    outline_text: Mapped[str] = mapped_column("outline_text", LONGTEXT, nullable=False, default="")
    content: Mapped[str] = mapped_column(LONGTEXT, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="outline_only")
    generation_key: Mapped[Optional[str]] = mapped_column("generation_key", String(160), nullable=True)
    retry_count: Mapped[int] = mapped_column("retry_count", Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]] = mapped_column("deleted_at", DateTime, nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column("confirmed_at", DateTime, nullable=True)

    draft: Mapped["NoteDraft"] = relationship(back_populates="sections")


class NoteDraftSectionVersion(Base):
    __tablename__ = "note_draft_section_versions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    draft_section_id: Mapped[str] = mapped_column("draft_section_id", String(64), ForeignKey("note_draft_sections.id", ondelete="CASCADE"), nullable=False, index=True)
    draft_id: Mapped[str] = mapped_column("draft_id", String(64), ForeignKey("note_drafts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    outline_text: Mapped[str] = mapped_column("outline_text", LONGTEXT, nullable=False, default="")
    content: Mapped[str] = mapped_column(LONGTEXT, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="outline_only")
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="revise_section")
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


class NoteEditPreview(Base):
    __tablename__ = "note_edit_previews"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    note_id: Mapped[str] = mapped_column("note_id", String(64), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column("target_type", String(50), nullable=False, default="note")
    section_id: Mapped[Optional[str]] = mapped_column("section_id", String(64), ForeignKey("note_sections.id", ondelete="SET NULL"), nullable=True)
    old_content: Mapped[str] = mapped_column("old_content", LONGTEXT, nullable=False, default="")
    new_content: Mapped[str] = mapped_column("new_content", LONGTEXT, nullable=False, default="")
    instruction: Mapped[str] = mapped_column(Text, nullable=False, default="")
    change_summary: Mapped[list] = mapped_column("change_summary", JSON, nullable=False, default=lambda: [])
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="preview")
    idempotency_key: Mapped[Optional[str]] = mapped_column("idempotency_key", String(160), nullable=True)
    apply_idempotency_key: Mapped[Optional[str]] = mapped_column("apply_idempotency_key", String(160), nullable=True)
    runtime: Mapped[str] = mapped_column(String(32), nullable=False, default="langgraph")
    graph_thread_id: Mapped[Optional[str]] = mapped_column("graph_thread_id", String(160), nullable=True, index=True)
    source_content_hash: Mapped[str] = mapped_column("source_content_hash", String(64), nullable=False, default="")
    applied_content_hash: Mapped[Optional[str]] = mapped_column("applied_content_hash", String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    applied_at: Mapped[Optional[datetime]] = mapped_column("applied_at", DateTime, nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column("cancelled_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="note_edit_previews")


class NoteEditPreviewRevision(Base):
    __tablename__ = "note_edit_preview_revisions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    edit_id: Mapped[str] = mapped_column("edit_id", String(64), ForeignKey("note_edit_previews.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    new_content: Mapped[str] = mapped_column("new_content", LONGTEXT, nullable=False, default="")
    instruction: Mapped[str] = mapped_column(Text, nullable=False, default="")
    change_summary: Mapped[list] = mapped_column("change_summary", JSON, nullable=False, default=lambda: [])
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="generated")
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)


class UserMemory(Base):
    __tablename__ = "user_memories"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    memory_type: Mapped[str] = mapped_column("memory_type", String(50), nullable=False, default="preference")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    importance: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="user_explicit")
    scope: Mapped[str] = mapped_column(String(50), nullable=False, default="global")
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    external_provider: Mapped[Optional[str]] = mapped_column("external_provider", String(50), nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column("external_id", String(160), nullable=True)
    canonical_key: Mapped[Optional[str]] = mapped_column("canonical_key", String(120), nullable=True)
    memory_layer: Mapped[Optional[str]] = mapped_column("memory_layer", String(50), nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column("expires_at", DateTime, nullable=True, index=True)
    source_ref: Mapped[Optional[str]] = mapped_column("source_ref", String(255), nullable=True)
    provider_metadata: Mapped[dict] = mapped_column("provider_metadata", JSON, nullable=False, default=lambda: {})
    idempotency_key: Mapped[Optional[str]] = mapped_column("idempotency_key", String(160), nullable=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column("last_used_at", DateTime, nullable=True)
    access_count: Mapped[int] = mapped_column("access_count", Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]] = mapped_column("deleted_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="user_memories")
    events: Mapped[list["UserMemoryEvent"]] = relationship(back_populates="memory", cascade="all, delete-orphan")


class UserMemoryEvent(Base):
    __tablename__ = "user_memory_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    memory_id: Mapped[Optional[str]] = mapped_column("memory_id", String(64), ForeignKey("user_memories.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column("event_type", String(50), nullable=False)
    old_content: Mapped[Optional[str]] = mapped_column("old_content", Text, nullable=True)
    new_content: Mapped[Optional[str]] = mapped_column("new_content", Text, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="user_memory_events")
    memory: Mapped[Optional["UserMemory"]] = relationship(back_populates="events")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="新对话")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    current_note_id: Mapped[Optional[str]] = mapped_column("current_note_id", String(64), ForeignKey("notes.id", ondelete="SET NULL"), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata_json", JSON, nullable=False, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_message_at: Mapped[Optional[datetime]] = mapped_column("last_message_at", DateTime, nullable=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column("archived_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    runs: Mapped[list["AgentRun"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    checkpoints: Mapped[list["AgentCheckpoint"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column("session_id", String(64), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id: Mapped[Optional[str]] = mapped_column("run_id", String(64), ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    text: Mapped[str] = mapped_column(LONGTEXT, nullable=False, default="")
    context_mode: Mapped[Optional[str]] = mapped_column("context_mode", String(50), nullable=True)
    sources: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    metadata_json: Mapped[dict] = mapped_column("metadata_json", JSON, nullable=False, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="chat_messages")
    session: Mapped["ChatSession"] = relationship(back_populates="messages")
    run: Mapped[Optional["AgentRun"]] = relationship(back_populates="messages")


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column("session_id", String(64), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    intent: Mapped[str] = mapped_column(String(80), nullable=False, default="general_chat")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="running")
    input_text: Mapped[str] = mapped_column("input_text", LONGTEXT, nullable=False, default="")
    output_text: Mapped[str] = mapped_column("output_text", LONGTEXT, nullable=False, default="")
    error_message: Mapped[Optional[str]] = mapped_column("error_message", Text, nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column("request_id", String(64), nullable=True, index=True)
    trace_id: Mapped[Optional[str]] = mapped_column("trace_id", String(64), nullable=True, index=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column("idempotency_key", String(160), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata_json", JSON, nullable=False, default=lambda: {})
    started_at: Mapped[datetime] = mapped_column("started_at", DateTime, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column("finished_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="agent_runs")
    session: Mapped["ChatSession"] = relationship(back_populates="runs")
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="run")
    steps: Mapped[list["AgentStep"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    tool_traces: Mapped[list["AgentToolTrace"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    checkpoints: Mapped[list["AgentCheckpoint"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class AgentStep(Base):
    __tablename__ = "agent_steps"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column("run_id", String(64), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    step_index: Mapped[int] = mapped_column("step_index", Integer, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="running")
    input_summary: Mapped[Optional[str]] = mapped_column("input_summary", Text, nullable=True)
    output_summary: Mapped[Optional[str]] = mapped_column("output_summary", Text, nullable=True)
    trace_id: Mapped[Optional[str]] = mapped_column("trace_id", String(64), nullable=True, index=True)
    metadata_json: Mapped[dict] = mapped_column("metadata_json", JSON, nullable=False, default=lambda: {})
    started_at: Mapped[datetime] = mapped_column("started_at", DateTime, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column("finished_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="agent_steps")
    run: Mapped["AgentRun"] = relationship(back_populates="steps")
    tool_traces: Mapped[list["AgentToolTrace"]] = relationship(back_populates="step")


class AgentToolTrace(Base):
    __tablename__ = "agent_tool_traces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column("run_id", String(64), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    step_id: Mapped[Optional[str]] = mapped_column("step_id", String(64), ForeignKey("agent_steps.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    tool_name: Mapped[str] = mapped_column("tool_name", String(120), nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="success")
    duration_ms: Mapped[int] = mapped_column("duration_ms", Integer, nullable=False, default=0)
    input_summary: Mapped[Optional[str]] = mapped_column("input_summary", Text, nullable=True)
    output_summary: Mapped[Optional[str]] = mapped_column("output_summary", Text, nullable=True)
    trace_id: Mapped[Optional[str]] = mapped_column("trace_id", String(64), nullable=True, index=True)
    metadata_json: Mapped[dict] = mapped_column("metadata_json", JSON, nullable=False, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="agent_tool_traces")
    run: Mapped["AgentRun"] = relationship(back_populates="tool_traces")
    step: Mapped[Optional["AgentStep"]] = relationship(back_populates="tool_traces")


class AgentCheckpoint(Base):
    __tablename__ = "agent_checkpoints"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column("run_id", String(64), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column("session_id", String(64), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column("user_id", String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    intent: Mapped[str] = mapped_column(String(80), nullable=False, default="general_chat")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="open")
    checkpoint_type: Mapped[str] = mapped_column("checkpoint_type", String(80), nullable=False, default="runtime")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column("resolved_at", DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="agent_checkpoints")
    run: Mapped["AgentRun"] = relationship(back_populates="checkpoints")
    session: Mapped["ChatSession"] = relationship(back_populates="checkpoints")


class AgentShadowRun(Base):
    __tablename__ = "agent_shadow_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    trace_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    legacy_intent: Mapped[str] = mapped_column(String(80), nullable=False)
    graph_intent: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    legacy_route: Mapped[str] = mapped_column(String(80), nullable=False)
    graph_route: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    legacy_requires_sources: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    graph_requires_sources: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    hard_violation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running", index=True)
    differences: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    graph_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class MemoryShadowRun(Base):
    __tablename__ = "memory_shadow_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    memory_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("user_memories.id", ondelete="SET NULL"), nullable=True, index=True)
    operation: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    query_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    legacy_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    mem0_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    overlap_ratio: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hard_violation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="success", index=True)
    error_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class IntegrationOutbox(Base):
    __tablename__ = "integration_outbox"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    topic: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    aggregate_type: Mapped[str] = mapped_column(String(80), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    idempotency_key: Mapped[str] = mapped_column(String(240), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    available_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    locked_by: Mapped[Optional[str]] = mapped_column(String(160), nullable=True, index=True)
    locked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    error_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    trace_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class RagQueryLog(Base):
    __tablename__ = "rag_query_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    query_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    query_preview: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="llamaindex")
    mode: Mapped[str] = mapped_column(String(50), nullable=False, default="hybrid")
    candidate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    result_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trace_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    run_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class RagEvalCase(Base):
    __tablename__ = "rag_eval_cases"
    __table_args__ = (Index("uq_rag_eval_case_version_name", "dataset_version", "name", unique=True),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    dataset_version: Mapped[str] = mapped_column(String(80), nullable=False, default="v1")
    input_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    expected: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=lambda: [])
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RagEvalRun(Base):
    __tablename__ = "rag_eval_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    case_id: Mapped[Optional[str]] = mapped_column(String(64), ForeignKey("rag_eval_cases.id", ondelete="SET NULL"), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="llamaindex")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running", index=True)
    parameters: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    result: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {})
    trace_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
