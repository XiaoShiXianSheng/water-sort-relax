#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉取飞书群最新消息（**只读，绝不发送**）。

为什么要这个脚本：feishu_bot.py 的 listen 走「长连接」（WebSocket），
本机握手必然 timed out（handoff.log 里 connect failed）。
但 HTTP REST 完全通，所以用「拉历史」代替「等推送」——
这就是跨窗口协作的可靠通道：飞书群当消息总线，本地磁盘当共享状态。

用法：
    python feishu_pull.py                 # 拉最近 20 条
    python feishu_pull.py --n 50
    python feishu_pull.py --json          # 输出结构化 JSON（给自动化消费）
    python feishu_pull.py --since "2026-09-28 09:00:00"

依赖：只用标准库；复用 feishu_bot.py 的凭据读取与富文本解析（无需 lark-oapi）。
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

FEISHU_BOT_DIR = Path(r"C:\Users\Administrator\WorkBuddy\2026-09-27-02-23-29\outputs\feishu-bot")
CHAT_ID = "oc_6a38e5381598cda751e1299f40b088dc"   # 机器人所在的唯一群
MSG_URL = "https://open.feishu.cn/open-apis/im/v1/messages"

# 群里三类发言人（从 bot_state.json / messages.jsonl 实测得出）
BOSS_ID = "ou_4a627267442413af2460140ae7fb0969"    # 石先生本人
SELF_ID = "ou_94b28fa1a77bc60f6aeea425e3c425eb"    # 这个机器人自己

sys.path.insert(0, str(FEISHU_BOT_DIR))
try:
    import feishu_bot as fb
except ImportError as exc:                          # noqa: BLE001
    print("找不到 feishu_bot.py（%s）：%s" % (FEISHU_BOT_DIR, exc))
    sys.exit(2)


def fetch(token, chat_id, page_size):
    url = ("%s?container_id_type=chat&container_id=%s"
           "&sort_type=ByCreateTimeDesc&page_size=%d" % (MSG_URL, chat_id, page_size))
    req = urllib.request.Request(url, headers={"Authorization": "Bearer %s" % token})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as exc:
        return None, "HTTP %s: %s" % (exc.code, exc.read().decode("utf-8", "ignore")[:500])
    except Exception as exc:                        # noqa: BLE001
        return None, "%s: %s" % (type(exc).__name__, exc)
    data = json.loads(raw)
    if data.get("code") not in (0, None):
        return None, "code=%s msg=%s" % (data.get("code"), data.get("msg"))
    return (data.get("data") or {}).get("items") or [], None


def normalize(item):
    sender = item.get("sender") or {}
    ts = item.get("create_time") or "0"
    try:
        when = datetime.fromtimestamp(int(ts) / 1000.0).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        when = str(ts)
    return {
        "id": item.get("message_id") or "",
        "time": when,
        "sender_type": sender.get("sender_type") or "",
        "sender_id": sender.get("id") or "",
        "msg_type": item.get("msg_type") or "",
        "text": fb.extract_text((item.get("body") or {}).get("content") or ""),
    }


def who(m):
    sid = m["sender_id"]
    if sid == SELF_ID:
        return "WorkBuddy机器人"
    if "由豆包发送" in m["text"]:
        return "豆包"
    if sid == BOSS_ID:
        return "石先生"
    return (sid[:16] or "?")


def main(argv=None):
    ap = argparse.ArgumentParser(description="拉取飞书群最新消息（只读）")
    ap.add_argument("--n", type=int, default=20, help="拉最近多少条（默认 20）")
    ap.add_argument("--chat", default=CHAT_ID, help="chat_id，默认本群")
    ap.add_argument("--json", action="store_true", help="输出 JSON（给自动化消费）")
    ap.add_argument("--since", default=None, help="只看该时间之后，格式 2026-09-28 09:00:00")
    args = ap.parse_args(argv)

    app_id, app_secret = fb.require_creds()
    token, err = fb.get_token(app_id, app_secret)
    if err:
        print("拿不到 tenant_access_token：%s" % err)
        return 1

    items, err = fetch(token, args.chat, args.n)
    if err:
        print("拉取失败：%s" % err)
        print("\n若是权限类错误，到开放平台给应用加 im:message:readonly 或 im:message，")
        print("重新发布版本后再跑一次。")
        return 1

    msgs = [normalize(i) for i in items]
    msgs.reverse()                                   # 按时间正序
    if args.since:
        msgs = [m for m in msgs if m["time"] >= args.since]

    if args.json:
        print(json.dumps(msgs, ensure_ascii=False, indent=2))
        return 0

    print("群 %s：取回 %d 条，展示 %d 条\n" % (args.chat, len(items), len(msgs)))
    for m in msgs:
        print("[%s] %s : %s" % (m["time"], who(m), m["text"].replace("\n", " ⏎ ")[:400]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
