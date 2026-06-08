# -*- coding: utf-8 -*-
"""
向量库图谱 API — 返回节点和边用于力导向图
"""
import chromadb
import json
import sys

DB_PATH = r"C:\Users\Administrator\.openclaw\workspace\vector_db\anythingllm"
COLLECTION_NAME = "anythingllm_md_v2"

try:
    client = chromadb.PersistentClient(path=DB_PATH)
    collection = client.get_collection(COLLECTION_NAME)
    all_data = collection.get(include=["documents", "metadatas"])

    # 节点：账号 + 场景
    account_nodes = {}
    scene_nodes = {}
    content_nodes = []

    # 建立账号-场景关系
    account_scene_edges = {}

    for i, (id_, doc, meta) in enumerate(zip(
        all_data['ids'],
        all_data['documents'],
        all_data['metadatas']
    )):
        acc = meta.get("account", "通用") if meta else "通用"
        scene = meta.get("scene", "素材") if meta else "素材"
        ctype = meta.get("type", "template") if meta else "template"

        # 账号节点
        if acc not in account_nodes:
            account_nodes[acc] = {"id": f"acc_{acc}", "name": acc, "group": "account", "count": 0}
        account_nodes[acc]["count"] += 1

        # 场景节点
        if scene not in scene_nodes:
            scene_nodes[scene] = {"id": f"scene_{scene}", "name": scene, "group": "scene", "count": 0}
        scene_nodes[scene]["count"] += 1

        # 账号-场景 边
        edge_key = f"{acc}|{scene}"
        if edge_key not in account_scene_edges:
            account_scene_edges[edge_key] = {"source": f"acc_{acc}", "target": f"scene_{scene}", "weight": 0}
        account_scene_edges[edge_key]["weight"] += 1

        # 内容节点（随机分布在账号和场景之间）
        content_nodes.append({
            "id": f"content_{i}",
            "name": doc[:30] + "..." if len(doc) > 30 else doc,
            "full_content": doc,
            "account": acc,
            "scene": scene,
            "type": ctype,
            "group": "content"
        })

    nodes = list(account_nodes.values()) + list(scene_nodes.values()) + content_nodes[:100]
    edges = list(account_scene_edges.values())

    result = {"nodes": nodes, "edges": edges, "total": len(content_nodes)}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))

except Exception as e:
    err = {"nodes": [], "edges": [], "error": str(e)}
    sys.stdout.buffer.write(json.dumps(err, ensure_ascii=False).encode('utf-8'))
