# -*- coding: utf-8 -*-
"""Compatibility wrapper for the local vector store.

The old implementation required ChromaDB and a Windows-only data path. The
current app keeps the same API contract but stores records in SQLite so the
feature works on macOS without extra Python packages.
"""
import json
import sys

from vector_store import main_from_file, write_json


if __name__ == '__main__':
    try:
        if len(sys.argv) < 2:
            write_json({'error': 'payload file required'})
        else:
            write_json(main_from_file(sys.argv[1]))
    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))
