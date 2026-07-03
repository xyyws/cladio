"""
Claudio Agent Service — Python AI Agent 微服务

提供：
  - POST /agent/chat    — 多轮 Agent 对话（LangChain）
  - POST /agent/memory  — 记忆管理
  - GET  /agent/health  — 健康检查
"""
import os
import json
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from models import ChatRequest, ChatResponse, MemoryRequest
from agent import ClaudioAgent
from memory import MemoryStore
from orchestrator import Orchestrator

load_dotenv()

# ── 全局实例 ──
agent: ClaudioAgent = None
memory_store: MemoryStore = None
orchestrator: Orchestrator = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化，关闭时清理"""
    global agent, memory_store, orchestrator
    print("[Agent] 初始化中...")

    # 初始化记忆存储
    memory_store = MemoryStore()

    # 初始化 Agent
    agent = ClaudioAgent(
        api_key=os.getenv("LLM_API_KEY", ""),
        base_url=os.getenv("LLM_BASE_URL", "https://api.mimo.one/v1"),
        model=os.getenv("LLM_MODEL", "mimo-v2.5-pro"),
        memory_store=memory_store,
    )

    # 初始化 Orchestrator
    orchestrator = Orchestrator(
        api_key=os.getenv("LLM_API_KEY", ""),
        base_url=os.getenv("LLM_BASE_URL", "https://api.mimo.one/v1"),
        model=os.getenv("LLM_MODEL", "mimo-v2.5-pro"),
        memory_store=memory_store,
    )

    print("[Agent] 初始化完成（含 Orchestrator）")
    yield

    # 清理
    print("[Agent] 关闭中...")


app = FastAPI(
    title="Claudio Agent Service",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 路由 ──

@app.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "service": "claudio-agent",
        "agent_ready": agent is not None,
    }


@app.post("/agent/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Agent 对话入口"""
    if not agent:
        raise HTTPException(503, "Agent 未初始化")

    try:
        result = await agent.run(
            message=req.message,
            history=req.history or [],
            context=req.context or {},
        )
        return ChatResponse(
            reply=result["reply"],
            songs=result.get("songs", []),
            activity_log=result.get("activity_log", []),
            intent=result.get("intent", "chat"),
            memory_state=result.get("memory_state", ""),
        )
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/agent/memory")
async def get_memory(category: str = None):
    """获取用户记忆"""
    if not memory_store:
        raise HTTPException(503, "Memory 未初始化")
    memories = memory_store.get_all(category)
    return {"status": 200, "data": memories}


@app.post("/agent/memory")
async def save_memory(req: MemoryRequest):
    """保存用户记忆"""
    if not memory_store:
        raise HTTPException(503, "Memory 未初始化")
    memory_store.save(
        category=req.category,
        key=req.key,
        value=req.value,
        confidence=req.confidence or 0.5,
        source=req.source or "explicit",
    )
    return {"status": 200}


@app.get("/agent/memory/context")
async def get_memory_context():
    """获取记忆上下文（注入 prompt）"""
    if not memory_store:
        raise HTTPException(503, "Memory 未初始化")
    context = memory_store.get_context_string()
    return {"status": 200, "data": context}


@app.post("/orchestrate")
async def orchestrate(req: ChatRequest):
    """多 Agent 编排入口"""
    if not orchestrator:
        raise HTTPException(503, "Orchestrator 未初始化")

    try:
        result = await orchestrator.orchestrate(
            message=req.message,
            history=req.history or [],
            context=req.context or {},
            scenario=req.context.get("scenario", "auto") if req.context else "auto",
        )
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


def sse_event(event_type: str, data: dict) -> str:
    """格式化 SSE 事件"""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/orchestrate/stream")
async def orchestrate_stream(req: ChatRequest):
    """多 Agent 编排 SSE 流式入口"""
    if not orchestrator:
        raise HTTPException(503, "Orchestrator 未初始化")

    async def event_generator():
        """SSE 事件生成器"""
        event_queue = asyncio.Queue()

        # 事件回调：将事件放入队列
        async def on_event(event_type: str, data: dict):
            await event_queue.put((event_type, data))

        # 在后台运行编排
        scenario = req.context.get("scenario", "auto") if req.context else "auto"

        async def run_orchestration():
            try:
                result = await orchestrator.orchestrate(
                    message=req.message,
                    history=req.history or [],
                    context=req.context or {},
                    scenario=scenario,
                )
                await event_queue.put(("result", result))
            except Exception as e:
                await event_queue.put(("error", {"message": str(e)}))
            finally:
                await event_queue.put(("__done__", {}))

        # 启动编排任务
        task = asyncio.create_task(run_orchestration())

        # 发送初始事件
        yield sse_event("agent_start", {
            "agent": "Orchestrator",
            "task": scenario,
            "params": {"message": req.message[:50]},
        })

        # 消费事件队列
        while True:
            event_type, data = await event_queue.get()

            if event_type == "__done__":
                break
            elif event_type == "result":
                # 发送最终结果
                yield sse_event("reply", {"text": data.get("reply", "...")})
                yield sse_event("tracks", {
                    "songs": data.get("songs", []),
                    "activity_log": data.get("activity_log", []),
                })
                yield sse_event("agent_done", {
                    "agent": "Orchestrator",
                    "task": scenario,
                    "duration": data.get("orchestration_time", 0),
                })
            elif event_type == "error":
                yield sse_event("error", data)
            else:
                yield sse_event(event_type, data)

        yield sse_event("done", {})
        task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
