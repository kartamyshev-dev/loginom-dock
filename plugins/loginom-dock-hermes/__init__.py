"""Native Hermes adapter. Shared capture and delivery belong to the Dock runtime."""

import json
import os
import subprocess
from pathlib import Path

ADAPTER_REVISION = "0.1.0-dev.0"


def register(ctx):
    root = Path(__file__).resolve().parent
    ctx.register_skill(
        "loginom", root / "skills/loginom/SKILL.md", description="Работа в Loginom через Dock"
    )
    ctx.register_system_prompt_section(
        "loginom-dock.bootstrap",
        "Для задачи в Loginom прочитай skill loginom-dock:loginom и вызови dock_prepare "
        "из MCP loginom-dock. Инструкции придут в текущий контекст. Используй его локальный "
        "браузер и общий clipboard transfer. Для Tool Search используй tool_describe, "
        "затем tool_call(name=имя_инструмента, arguments={параметры}); параметры не "
        "передаются на верхнем уровне tool_call. Личный memory.provider не меняется.",
        max_chars=800,
    )

    def forward(event, **kwargs):
        dock_root = Path(os.environ.get("LOGINOM_DOCK_HOME", str(Path.home() / ".loginom-dock")))
        launcher = dock_root / "bin/loginom-dock"
        if not launcher.is_file():
            return
        # No environment, model prompt, reasoning or binary content is forwarded.
        payload = {
            key: kwargs[key]
            for key in (
                "session_id",
                "turn_id",
                "tool_call_id",
                "tool_name",
                "args",
                "result",
                "status",
                "duration_ms",
                "completed",
                "interrupted",
                "failed",
                "turn_exit_reason",
                "reason",
            )
            if key in kwargs
        }
        payload["hook_event_name"] = event
        from hermes_constants import get_hermes_home

        payload["hermes_home"] = str(get_hermes_home())
        try:
            subprocess.run(
                [str(launcher), "hook", "hermes", ADAPTER_REVISION],
                input=json.dumps(payload),
                text=True,
                timeout=10,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            # Never include raw hook payloads or exception bodies in host logs.
            return

    for event in ("post_tool_call", "on_session_end", "on_session_finalize"):
        ctx.register_hook(event, lambda _event=event, **kwargs: forward(_event, **kwargs))
