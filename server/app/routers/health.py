from fastapi import APIRouter, Depends

from app.deps import CurrentUser, get_current_user
from app.services.diagnostics import build_diagnostics
from app.services.observability import metrics_snapshot

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    diagnostics = await build_diagnostics()
    checks = {check["name"]: check for check in diagnostics["checks"]}
    postgres_ready = checks.get("postgres", {}).get("status") == "ok"
    return {
        "ok": diagnostics["ok"],
        "status": diagnostics["status"],
        "postgresReady": postgres_ready,
        "mysqlReady": postgres_ready,
        "redisReady": checks.get("redis", {}).get("status") == "ok",
        "deepseekReady": bool(checks.get("ai", {}).get("details", {}).get("configured")),
        "deepseekModel": diagnostics["config"]["ai"]["model"],
        "deepseekBaseURL": diagnostics["config"]["ai"]["baseURL"],
        "checks": diagnostics["checks"],
    }


@router.get("/diagnostics")
async def diagnostics():
    return await build_diagnostics()


@router.get("/metrics")
async def metrics(_user: CurrentUser = Depends(get_current_user)):
    return metrics_snapshot()
