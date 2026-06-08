# -*- coding: utf-8 -*-
"""重新导入 BF 原文到向量库，确保存储完整内容而非摘要"""
import glob
import os
import sqlite3
import sys
import urllib.parse

# Add server dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def get_db():
    ROOT = r'D:\workspace-v2'
    DATA_DIR = os.path.join(ROOT, 'data')
    DB_PATH = os.path.join(DATA_DIR, 'vector_store.db')
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('''
        CREATE TABLE IF NOT EXISTS vector_items (
            id          TEXT PRIMARY KEY,
            collection  TEXT NOT NULL,
            text        TEXT NOT NULL,
            account     TEXT DEFAULT '通用',
            scene       TEXT DEFAULT '素材',
            type        TEXT DEFAULT 'template',
            hook        TEXT DEFAULT '',
            golden_line TEXT DEFAULT '',
            progression TEXT DEFAULT '',
            source      TEXT DEFAULT '',
            created_at  INTEGER DEFAULT 0,
            updated_at  INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_vector_items_collection ON vector_items(collection)')
    conn.commit()
    return conn

def get_source_to_id_map(db):
    """获取 source 路径到 id 的映射"""
    rows = db.execute('SELECT id, source FROM vector_items WHERE source != ""').fetchall()
    return {row['source']: row['id'] for row in rows}

def update_vector_text(db, id_, full_text):
    """更新 vector_items 的 text 字段"""
    db.execute(
        'UPDATE vector_items SET text = ?, updated_at = ? WHERE id = ?',
        (full_text, int(os.path.getmtime(__file__)), id_)
    )

def main():
    # BF 原文目录
    raw_dir = r'C:\Users\Administrator\.openclaw\workspace\bf_raw_docs'

    if not os.path.exists(raw_dir):
        print(f'Error: Directory not found: {raw_dir}')
        return

    db = get_db()
    source_map = get_source_to_id_map(db)

    print(f'Found {len(source_map)} items with source')
    print(f'Scanning directory: {raw_dir}')

    updated = 0
    not_found = []

    for filepath in glob.glob(os.path.join(raw_dir, '*.md')):
        filename = os.path.basename(filepath)
        source_url = '/raw_bf/' + filename
        encoded_url = '/raw_bf/' + urllib.parse.quote(filename)

        # 尝试匹配
        item_id = source_map.get(source_url) or source_map.get(encoded_url)

        if not item_id:
            # 尝试部分匹配（比较 URL 编码后的文件名）
            for src, id_ in source_map.items():
                db_filename = urllib.parse.unquote(src).replace('/raw_bf/', '')
                if filename == db_filename or urllib.parse.quote(filename) == urllib.parse.unquote(src).replace('/raw_bf/', ''):
                    item_id = id_
                    break

        if not item_id:
            not_found.append(filename)
            continue

        # 读取完整原文
        with open(filepath, 'r', encoding='utf-8') as f:
            full_text = f.read()

        print(f'Updating {filename} ({len(full_text)} chars)...')
        update_vector_text(db, item_id, full_text)
        updated += 1

    db.commit()
    db.close()

    print(f'\nDone! Updated {updated} items.')
    if not_found:
        print(f'Not found in DB: {len(not_found)} items')
        for f in not_found[:5]:
            print(f'  - {f}')

if __name__ == '__main__':
    main()
