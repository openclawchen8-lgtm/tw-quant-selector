
import threading
import time
import duckdb
from pathlib import Path
from tw_quant_selector.data.database import Database

def test_ro_connection_caching_and_invalidation():
    db_path = "/tmp/test_cache_invalidation.duckdb"
    if Path(db_path).exists(): Path(db_path).unlink()
    
    db = Database(db_path)
    db.init_db()
    
    # Get a RO connection in this thread
    conn1 = db.connect(read_only=True)
    conn1.execute("SELECT 1")
    
    # Verify it's cached
    conn2 = db.connect(read_only=True)
    assert conn1 is conn2
    
    # Now simulate a writer closing RO connections
    db.connect(read_only=False) # This calls _close_all_ro()
    
    # Get a new RO connection - should be different and valid
    conn3 = db.connect(read_only=True)
    assert conn3 is not conn1
    conn3.execute("SELECT 1")
    
    # Verify that conn1 is actually closed
    try:
        conn1.execute("SELECT 1")
        assert False, "conn1 should have been closed"
    except Exception as e:
        assert "closed" in str(e).lower()

    if Path(db_path).exists(): Path(db_path).unlink()

if __name__ == "__main__":
    test_ro_connection_caching_and_invalidation()
