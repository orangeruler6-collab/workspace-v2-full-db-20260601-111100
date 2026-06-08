# -*- coding: utf-8 -*-
"""Compatibility wrapper for vector list/search routes."""
import json
import sys

from vector_store import main_from_file, run_action, write_json


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '-':
        payload = json.loads(sys.stdin.read() or '{}')
        action = payload.get('action') or 'search'
        params = payload.get('params') or payload
        return run_action(action, params)
    if len(sys.argv) > 1:
        return main_from_file(sys.argv[1])
    return {'error': 'payload required'}


if __name__ == '__main__':
    try:
        write_json(main())
    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))
