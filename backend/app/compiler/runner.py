"""Direct local execution of code snippets per language.

WARNING: runs arbitrary generated code on the host without sandboxing. The user
chose this trade-off explicitly. Do not point this at untrusted input from the
public internet.
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv

from ..schemas import CompileResult, Language

load_dotenv()

PYTHON_BIN = os.getenv("PYTHON_BIN", "python3")
NODE_BIN = os.getenv("NODE_BIN", "node")
JAVAC_BIN = os.getenv("JAVAC_BIN", "javac")
JAVA_BIN = os.getenv("JAVA_BIN", "java")
CPP_BIN = os.getenv("CPP_BIN", "g++")
TIMEOUT = int(os.getenv("CODE_RUN_TIMEOUT", "8"))


async def _run(cmd: list[str], cwd: str, stdin: str | None = None) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdin=asyncio.subprocess.PIPE if stdin else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(
            proc.communicate(stdin.encode() if stdin else None),
            timeout=TIMEOUT,
        )
        return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, "", f"timeout after {TIMEOUT}s"


def _extract_public_class(java_src: str) -> str:
    m = re.search(r"public\s+class\s+(\w+)", java_src)
    return m.group(1) if m else "Main"


async def run_code(language: Language, code: str, stdin: str | None = None) -> CompileResult:
    start = time.time()
    with tempfile.TemporaryDirectory(prefix="mcq_run_") as tmp:
        try:
            if language == "python":
                src = Path(tmp) / "main.py"
                src.write_text(code)
                rc, out, err = await _run([PYTHON_BIN, str(src)], tmp, stdin)

            elif language == "javascript":
                src = Path(tmp) / "main.js"
                src.write_text(code)
                rc, out, err = await _run([NODE_BIN, str(src)], tmp, stdin)

            elif language == "cpp":
                src = Path(tmp) / "main.cpp"
                bin_ = Path(tmp) / "main.out"
                src.write_text(code)
                rc, out, err = await _run([CPP_BIN, "-std=c++17", "-O0", str(src), "-o", str(bin_)], tmp)
                if rc == 0:
                    rc, out, err = await _run([str(bin_)], tmp, stdin)

            elif language == "c":
                src = Path(tmp) / "main.c"
                bin_ = Path(tmp) / "main.out"
                src.write_text(code)
                rc, out, err = await _run([CPP_BIN, "-x", "c", "-std=c11", "-O0", str(src), "-o", str(bin_)], tmp)
                if rc == 0:
                    rc, out, err = await _run([str(bin_)], tmp, stdin)

            elif language == "java":
                cls = _extract_public_class(code)
                src = Path(tmp) / f"{cls}.java"
                src.write_text(code)
                rc, out, err = await _run([JAVAC_BIN, str(src)], tmp)
                if rc == 0:
                    rc, out, err = await _run([JAVA_BIN, "-cp", tmp, cls], tmp, stdin)

            elif language == "html":
                # Run as DOM-evaluated JS: extract <script> tags and console.log output
                # via a Node + jsdom-like shim. For simplicity, just execute inline
                # <script> blocks in Node without DOM. The generator should write
                # snippets that don't depend on a real browser.
                scripts = re.findall(r"<script[^>]*>(.*?)</script>", code, re.S | re.I)
                joined = "\n;\n".join(scripts) if scripts else code
                src = Path(tmp) / "main.js"
                src.write_text(joined)
                rc, out, err = await _run([NODE_BIN, str(src)], tmp, stdin)

            elif language in ("csharp", "css"):
                return CompileResult(
                    ok=False, stdout="",
                    stderr=f"language '{language}' has no host toolchain wired up — verification skipped",
                    exit_code=2, duration_ms=int((time.time() - start) * 1000),
                )

            else:
                return CompileResult(
                    ok=False, stdout="", stderr=f"unsupported language: {language}",
                    exit_code=2, duration_ms=int((time.time() - start) * 1000),
                )

            return CompileResult(
                ok=(rc == 0),
                stdout=out,
                stderr=err,
                exit_code=rc,
                duration_ms=int((time.time() - start) * 1000),
            )
        except FileNotFoundError as e:
            return CompileResult(
                ok=False, stdout="", stderr=f"toolchain missing: {e}",
                exit_code=127, duration_ms=int((time.time() - start) * 1000),
            )


def check_toolchains() -> dict[str, bool]:
    have_cpp = shutil.which(CPP_BIN) is not None
    return {
        "python": shutil.which(PYTHON_BIN) is not None,
        "javascript": shutil.which(NODE_BIN) is not None,
        "java": shutil.which(JAVAC_BIN) is not None and shutil.which(JAVA_BIN) is not None,
        "cpp": have_cpp,
        "c": have_cpp,
        "html": shutil.which(NODE_BIN) is not None,
        "csharp": False,
        "css": False,
    }
