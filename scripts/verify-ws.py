#!/usr/bin/env python3
"""
Logexus AI Browser — WebSocket 直连验证脚本

验证 daemon 通信的三步：
  1. Agent 连接认证
  2. Ping/Pong 心跳
  3. 无 Extension 时的错误响应
"""

import json
import websocket

DAEMON = "ws://127.0.0.1:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent"

def test():
    print("=" * 50)
    print("Logexus AI Browser — WebSocket 直连验证")
    print("=" * 50)

    # 1. 连接
    print("\n[1/3] 连接 daemon...")
    ws = websocket.create_connection(DAEMON, timeout=5)
    print("       ✅ 已连接")

    # 2. Ping/Pong
    print("\n[2/3] Ping/Pong 测试...")
    ws.send(json.dumps({"type": "ping", "task_id": "verify_1"}))
    resp = json.loads(ws.recv())
    assert resp["type"] == "pong", f"Expected pong, got {resp}"
    print(f"       ✅ Pong received (timestamp: {resp['timestamp']})")

    # 3. 无 Extension 时的错误处理
    print("\n[3/3] AGENT_REQUEST（无扩展连接）...")
    ws.send(json.dumps({
        "type": "AGENT_REQUEST",
        "task_id": "verify_2",
        "action": "observe",
        "payload": {"reasoning": "验证错误响应"}
    }))
    resp = json.loads(ws.recv())
    assert resp["type"] == "AGENT_RESPONSE", f"Expected AGENT_RESPONSE"
    assert resp["status"] == "error", f"Expected error"
    assert "No extension connected" in resp["data"]["error"]
    print(f"       ✅ 正确返回错误: {resp['data']['error']}")

    ws.close()

    print("\n" + "=" * 50)
    print("✅ 全部 3 项验证通过！")
    print("=" * 50)
    print()
    print("WebSocket 直连已打通。下一步：")
    print("  1. 在 Chrome 中加载扩展 (chrome://extensions → 加载 dist/)")
    print("  2. 打开任意网页")
    print("  3. 重新运行此脚本 → observe 将返回页面元素列表")
    print()

if __name__ == "__main__":
    test()
