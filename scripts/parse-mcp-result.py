#!/usr/bin/env python3
"""Extract the JSON payload from a Supabase MCP overflow file.

Usage: parse-mcp-result.py <input-file> <output-json-file>

The MCP wraps query output as:
  {"result": "Below is the result ... <untrusted-data-UUID>\n<payload>\n</untrusted-data-UUID> ..."}
where <payload> is the actual SQL result. We strip the wrapper and write
the parsed JSON (assumed to be [{"rows": [...]}]) to the output file.
"""
import json, re, sys

src, dst = sys.argv[1], sys.argv[2]
wrapper = json.load(open(src))
text = wrapper["result"]
opens = list(re.finditer(r'<untrusted-data-[a-f0-9-]+>', text))
closes = list(re.finditer(r'</untrusted-data-[a-f0-9-]+>', text))
# First open is part of the warning preamble; real payload sits between
# the second open and the first close.
inner = text[opens[1].end():closes[0].start()].strip()
data = json.loads(inner)
rows = data[0]["rows"] if isinstance(data, list) and data and "rows" in data[0] else data
with open(dst, "w") as f:
    json.dump(rows, f, indent=2)
print(f"{dst}: {len(rows)} rows")
