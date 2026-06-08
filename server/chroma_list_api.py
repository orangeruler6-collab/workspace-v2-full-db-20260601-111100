# -*- coding: utf-8 -*-
import chromadb
import json
import sys

DB_PATH = r"C:\Users\Administrator\.openclaw\workspace\vector_db\anythingllm"
COLLECTION_NAME = "anythingllm_md_v2"

try:
    client = chromadb.PersistentClient(path=DB_PATH)
    collection = client.get_collection(COLLECTION_NAME)
    all_data = collection.get(include=["documents", "metadatas"])

    items = []
    for i, (id_, doc, meta) in enumerate(zip(
        all_data['ids'],
        all_data['documents'],
        all_data['metadatas']
    )):
        items.append({
            "id": str(id_),
            "content": doc,
            "account": (meta.get("account") or "通用") if meta else "通用",
            "scene": (meta.get("scene") or "素材") if meta else "素材",
            "type": (meta.get("type") or "template") if meta else "template",
            "date": (meta.get("date") or "") if meta else "",
            "hook": (meta.get("hook") or "") if meta else "",
            "golden_line": (meta.get("golden_line") or "") if meta else "",
            "progression": (meta.get("progression") or "") if meta else "",
        })

    result = {"data": items, "total": len(items)}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))

except Exception as exc:
    err = {"data": [], "error": str(exc)}
    sys.stdout.buffer.write(json.dumps(err, ensure_ascii=False).encode("utf-8"))
