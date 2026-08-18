import sqlite3
import json
import time
from typing import List, Optional
from models.schemas import Ticket

class TicketManager:
    def __init__(self, db_path: str = "tickets.db"):
        self.db_path = db_path
        self.in_memory_tickets: List[Ticket] = []
        self._init_db()

    def _init_db(self):
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("PRAGMA table_info(tickets)")
                cols = cursor.fetchall()
                if cols and len(cols) < 18:
                    print("Migrating SQLite tickets table schema...")
                    conn.execute("DROP TABLE tickets")
                
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS tickets (
                        id TEXT PRIMARY KEY,
                        number TEXT,
                        timestamp REAL,
                        priority TEXT,
                        severity TEXT,
                        root_cause TEXT,
                        confidence TEXT,
                        evidence TEXT,
                        human_explanation TEXT,
                        recommended_fix TEXT,
                        remediation_steps TEXT,
                        raw_telemetry TEXT,
                        status TEXT,
                        pushed_to_isp INTEGER,
                        isp_request_id TEXT,
                        pushed_at REAL,
                        subscriber_notes TEXT,
                        isp_notes TEXT
                    )
                """)
        except Exception as e:
            print(f"DB init fallback: {e}")


    def create_ticket(self, t: Ticket):
        self.in_memory_tickets.insert(0, t)
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    """INSERT OR REPLACE INTO tickets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (t.id, t.number, t.timestamp, t.priority, t.severity, t.root_cause, t.confidence,
                     json.dumps(t.evidence), t.human_explanation, t.recommended_fix,
                     json.dumps(t.remediation_steps), json.dumps(t.raw_telemetry), t.status,
                     1 if t.pushed_to_isp else 0, t.isp_request_id, t.pushed_at,
                     t.subscriber_notes, t.isp_notes)
                )
        except Exception as e:
            print(f"Error saving ticket: {e}")

    def get_tickets(self) -> List[Ticket]:
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT * FROM tickets ORDER BY timestamp DESC").fetchall()
                if rows:
                    tickets = []
                    for r in rows:
                        tickets.append(Ticket(
                            id=r["id"], number=r["number"], timestamp=r["timestamp"],
                            priority=r["priority"], severity=r["severity"] if "severity" in r.keys() else "Warning",
                            root_cause=r["root_cause"], confidence=r["confidence"],
                            evidence=json.loads(r["evidence"]) if r["evidence"] else [],
                            human_explanation=r["human_explanation"],
                            recommended_fix=r["recommended_fix"],
                            remediation_steps=json.loads(r["remediation_steps"]) if "remediation_steps" in r.keys() and r["remediation_steps"] else [],
                            raw_telemetry=json.loads(r["raw_telemetry"]) if r["raw_telemetry"] else {},
                            status=r["status"],
                            pushed_to_isp=bool(r["pushed_to_isp"]) if "pushed_to_isp" in r.keys() and r["pushed_to_isp"] else False,
                            isp_request_id=r["isp_request_id"] if "isp_request_id" in r.keys() else None,
                            pushed_at=r["pushed_at"] if "pushed_at" in r.keys() else None,
                            subscriber_notes=r["subscriber_notes"] if "subscriber_notes" in r.keys() else None,
                            isp_notes=r["isp_notes"] if "isp_notes" in r.keys() else None
                        ))
                    return tickets
        except Exception as e:
            print(f"Error loading tickets from DB: {e}")
        return self.in_memory_tickets

    def push_to_isp(self, ticket_id: str, subscriber_notes: str = "") -> Optional[Ticket]:
        tickets = self.get_tickets()
        for t in tickets:
            if t.id == ticket_id:
                t.pushed_to_isp = True
                t.pushed_at = time.time()
                t.status = "pushed_to_isp"
                t.isp_request_id = f"ISP-REQ-{int(time.time()) % 10000:04d}"
                t.subscriber_notes = subscriber_notes
                self.create_ticket(t)
                return t
        return None

    def update_status(self, ticket_id: str, status: str, isp_notes: str = None):
        tickets = self.get_tickets()
        for t in tickets:
            if t.id == ticket_id:
                t.status = status
                if isp_notes:
                    t.isp_notes = isp_notes
                self.create_ticket(t)
                break

    def clear_all_tickets(self):
        self.in_memory_tickets.clear()
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("DELETE FROM tickets")
        except Exception:
            pass

