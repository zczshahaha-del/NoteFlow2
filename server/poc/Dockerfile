FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-ai.txt requirements-ai.lock.txt /build/
RUN python -m pip wheel --no-cache-dir --wheel-dir /wheels -r /build/requirements-ai.lock.txt

FROM python:3.12-slim

WORKDIR /poc

COPY --from=builder /wheels /wheels
RUN python -m pip install --no-cache-dir /wheels/* \
    && rm -rf /wheels

COPY poc/check_ai_frameworks.py /poc/check_ai_frameworks.py
COPY poc/check_langgraph_readonly.py /poc/check_langgraph_readonly.py
COPY app /poc/app

ENV LANGGRAPH_STRICT_MSGPACK=true
CMD ["python", "/poc/check_ai_frameworks.py"]
