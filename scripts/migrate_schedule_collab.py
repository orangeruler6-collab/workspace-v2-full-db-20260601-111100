import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "schedule.db"
JSON_PATH = ROOT / "data" / "schedule.json"
CURRENT_WEEK_START = "2026-05-18"
CURRENT_WEEK_END = "2026-05-24"

GROUP3 = "\u5185\u5bb9\u4e09\u7ec4"
GROUP4 = "\u5185\u5bb9\u56db\u7ec4"


def backup():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = ROOT / "data" / f"backup-{stamp}-collab-migration"
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DB_PATH, target / "schedule.db")
    if JSON_PATH.exists():
        shutil.copy2(JSON_PATH, target / "schedule.json")
    return target


def ensure_columns(conn):
    existing = {row[1] for row in conn.execute("PRAGMA table_info(schedules)")}
    text_columns = {
        "workflow_stage": "'文案'",
        "participants_json": "'[]'",
    }
    for column, default in text_columns.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE schedules ADD COLUMN {column} TEXT DEFAULT {default}")
    if "schedule_hidden" not in existing:
        conn.execute("ALTER TABLE schedules ADD COLUMN schedule_hidden INTEGER DEFAULT 0")
    if "linked_parent_id" not in existing:
        conn.execute("ALTER TABLE schedules ADD COLUMN linked_parent_id INTEGER DEFAULT NULL")


def participants(rows):
    cleaned = []
    seen = set()
    for person, roles in rows:
        person = str(person or "").strip()
        if not person or person in seen:
            continue
        seen.add(person)
        role_list = []
        for role in roles:
            role = str(role or "").strip()
            if role and role not in role_list:
                role_list.append(role)
        cleaned.append({"person": person, "roles": role_list or ["文案"]})
    return json.dumps(cleaned, ensure_ascii=False)


def row_role(row):
    group = row["group_name"]
    person = row["person"]
    account = row["account"] or ""
    task_type = row["type"] or ""
    content = row["content"] or ""
    material_like = task_type == "素材代做" or account == "素材" or "素材" in content

    if group == GROUP3:
        return "文案" if person in {"曹媛", "陈泓睿"} and not material_like else "后期"

    if group == GROUP4:
        if person == "陈健伊":
            return "文案"
        if person == "林宇辰":
            return "后期" if material_like else "文案"
        return "后期"

    return "后期" if material_like else "文案"


def workflow_stage(row, role):
    if row["status"] == "done":
        return "已发布"
    if row["status"] == "delayed":
        return "延期"
    return "后期" if role == "后期" else "文案"


def normalize_active_rows(conn):
    rows = conn.execute(
        """
        SELECT * FROM schedules
        WHERE group_name IN (?, ?)
          AND date BETWEEN ? AND ?
        ORDER BY id
        """,
        (GROUP3, GROUP4, CURRENT_WEEK_START, CURRENT_WEEK_END),
    ).fetchall()
    for row in rows:
        role = row_role(row)
        conn.execute(
            """
            UPDATE schedules
               SET workflow_stage = ?,
                   participants_json = ?,
                   schedule_hidden = 0,
                   linked_parent_id = NULL
             WHERE id = ?
            """,
            (workflow_stage(row, role), participants([(row["person"], [role])]), row["id"]),
        )


def hide_group4_outside_current_week(conn):
    conn.execute(
        """
        UPDATE schedules
           SET schedule_hidden = 1,
               linked_parent_id = NULL
         WHERE group_name = ?
           AND (date < ? OR date > ?)
        """,
        (GROUP4, CURRENT_WEEK_START, CURRENT_WEEK_END),
    )


def set_collab(conn, master_id, hidden_ids, date):
    key = f"collab-piaoliu-{date.replace('-', '')}"
    people = participants(
        [
            ("陈泓睿", ["文案"]),
            ("刘佳琳", ["后期"]),
            ("肖子璇", ["后期"]),
        ]
    )
    conn.execute(
        """
        UPDATE schedules
           SET person = '陈泓睿',
               account = '中二探长',
               type = '商单',
               content = '飘流幻境新世界',
               workflow_stage = '后期',
               participants_json = ?,
               parallel_key = ?,
               schedule_hidden = 0,
               linked_parent_id = NULL
         WHERE id = ?
        """,
        (people, key, master_id),
    )
    for hidden_id in hidden_ids:
        conn.execute(
            """
            UPDATE schedules
               SET workflow_stage = '后期',
                   participants_json = ?,
                   parallel_key = ?,
                   schedule_hidden = 1,
                   linked_parent_id = ?
             WHERE id = ?
            """,
            (people, key, master_id, hidden_id),
        )


def migrate():
    backup_dir = backup()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        ensure_columns(conn)
        normalize_active_rows(conn)
        hide_group4_outside_current_week(conn)
        set_collab(conn, 6563, [6564, 6567], "2026-05-21")
        set_collab(conn, 6576, [6578], "2026-05-22")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(f"backup={backup_dir}")


if __name__ == "__main__":
    migrate()
