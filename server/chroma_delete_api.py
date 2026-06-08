# -*- coding: utf-8 -*-
import chromadb
import json
import sys

DB_PATH = r"C:\Users\Administrator\.openclaw\workspace\vector_db\anythingllm"
COLLECTION_NAME = "anythingllm_md_v2"

try:
    client = chromadb.PersistentClient(path=DB_PATH)
    collection = client.get_collection(COLLECTION_NAME)

    id_to_delete = sys.argv[1] if len(sys.argv) > 1 else ""
    if not id_to_delete:
        result = {"success": False, "error": "id required"}
    else:
        try:
            collection.delete(ids=[id_to_delete])
            result = {"success": True, "id": id_to_delete}
        except Exception as del_err:
            result = {"success": False, "error": str(del_err)}

    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))

except Exception as exc:
    err = {"success": False, "error": str(exc)}
    sys.stdout.buffer.write(json.dumps(err, ensure_ascii=False).encode("utf-8"))
