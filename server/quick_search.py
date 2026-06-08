# -*- coding: utf-8 -*-
import requests
import chromadb
import json
import os

DB = r"C:\Users\Administrator\openclaw\vector_db\anythingllm"
try:
    from env import load_env
    load_env()
except Exception:
    pass
KEY = os.environ.get("SILICONFLOW_API_KEY") or os.environ.get("SF_KEY") or ""
EMB_URL = "https://api.siliconflow.cn/v1/embeddings"

client = chromadb.PersistentClient(path=DB)
col = client.get_collection("anythingllm_md_v2")
query = "逆战"
r = requests.post(EMB_URL, headers={"Authorization": "Bearer " + KEY}, json={"model": "BAAI/bge-large-zh-v1.5", "input": query})
data = r.json()
embedding = data.get("data", [{}])[0].get("embedding", [])
print("emb_dim:", len(embedding))
res = col.query(query_embeddings=[embedding], n_results=3, include=["documents", "metadatas"])
docs = res.get("documents", [[]])[0]
metas = res.get("metadatas", [{}])
for d, m in zip(docs, metas):
    print("DOC:", (d or "")[:60])
    print("META:", m)
    print("---")
