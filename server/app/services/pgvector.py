from __future__ import annotations

from sqlalchemy.types import UserDefinedType


class Vector(UserDefinedType):
    cache_ok = True

    def __init__(self, dimensions: int):
        self.dimensions = dimensions

    def get_col_spec(self, **kw) -> str:
        return f"vector({self.dimensions})"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            if isinstance(value, str):
                return value
            return vector_literal(value)

        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None or isinstance(value, list):
                return value
            if isinstance(value, str):
                return parse_vector(value)
            return value

        return process


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in vector) + "]"


def parse_vector(value: str) -> list[float]:
    raw = value.strip()
    if raw.startswith("[") and raw.endswith("]"):
        raw = raw[1:-1]
    if not raw:
        return []
    return [float(item) for item in raw.split(",")]
