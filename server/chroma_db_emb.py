# -*- coding: utf-8 -*-
# Receives pre-computed embedding, searches ChromaDB directly
# Input: JSON file with {embedding, collection, account, scene, limit}
# Output: JSON {results:[...], collection:...}
import sys, json, os, chromadb

DB_PATH = r"C:\Users\Administrator\.openclaw\workspace\vector_db\anythingllm"
COLLECTIONS = {
    'wenan': 'anythingllm_md_v2',
    'bf': 'bf_library_v1',
    'cases': 'cases_library_v1',
}

def get_col(key):
    os.makedirs(DB_PATH, exist_ok=True)
    client = chromadb.PersistentClient(path=DB_PATH)
    name = COLLECTIONS.get(key, key)
    try:
        return client.get_collection(name)
    except Exception:
        try:
            return client.get_or_create_collection(name=name)
        except Exception:
            return client.get_or_create_collection(name=name+'_v1')

def search_by_embedding(embedding, key, account_filter, scene_filter, limit):
    try:
        col = get_col(key)
        raw = col.query(query_embeddings=[embedding], n_results=limit*3, include=["documents","metadatas"])
        raw_docs = raw.get('documents', [[]])
        raw_metas = raw.get('metadatas', [[]])
        docs = raw_docs[0] if raw_docs and raw_docs else []
        metas = raw_metas[0] if raw_metas and raw_metas else []
        results = []
        for doc, meta in zip(docs, metas):
            m = meta if isinstance(meta, dict) else {}
            acc = m.get('account', '')
            sc = m.get('scene', '')
            if account_filter and account_filter != acc and account_filter != '通用':
                continue
            results.append({
                'content': doc or '',
                'text': doc or '',
                'account': acc,
                'scene': sc,
                'type': m.get('type', 'template'),
            })
            if len(results) >= limit:
                break
        return {'results': results, 'collection': key}
    except Exception as e:
        return {'results': [], 'error': str(e), 'collection': key}

if __name__ == '__main__':
    try:
        params = json.load(open(sys.argv[1], encoding='utf-8-sig'))
        embedding = params.get('embedding', [])
        key = params.get('collection', 'wenan')
        account_filter = params.get('account', '')
        scene_filter = params.get('scene', '')
        limit = params.get('limit', 6)
        result = search_by_embedding(embedding, key, account_filter, scene_filter, limit)
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))
    except Exception as e:
        sys.stdout.buffer.write(json.dumps({'error': str(e)}, ensure_ascii=False).encode('utf-8'))
