"""
数据模型定义
"""
from typing import Optional
from pydantic import BaseModel


class ChatRequest(BaseModel):
    """聊天请求"""
    message: str
    history: Optional[list] = []
    context: Optional[dict] = {}


class ChatResponse(BaseModel):
    """聊天响应"""
    reply: str
    songs: list[str] = []
    activity_log: list[dict] = []
    intent: str = "chat"
    memory_state: str = ""


class MemoryRequest(BaseModel):
    """记忆保存请求"""
    category: str  # 'preference' | 'fact' | 'habit' | 'mood'
    key: str
    value: str
    confidence: Optional[float] = 0.5
    source: Optional[str] = "explicit"  # 'explicit' | 'inferred' | 'feedback'
