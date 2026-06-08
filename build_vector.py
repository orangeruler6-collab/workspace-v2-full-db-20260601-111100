# -*- coding: utf-8 -*-
"""Write VectorModule.vue via JSON intermediary to avoid encoding truncation."""
import json, os

content = {
    "template": open("C:/Users/Administrator/.openclaw/workspace/workspace-v2/vector_tmpl.txt", encoding="utf-8").read(),
    "script": open("C:/Users/Administrator/.openclaw/workspace/workspace-v2/vector_script.txt", encoding="utf-8").read(),
}
# Merge
vue = content["template"] + "\n<script setup>\n" + content["script"] + "\n</script>\n"
out = "C:/Users/Administrator/.openclaw/workspace/workspace-v2/src/modules/VectorModule.vue"
with open(out, "w", encoding="utf-8") as f:
    f.write(vue)
print(f"Written {os.path.getsize(out)} bytes")
