import os
os.environ["DUCKDB_PATH"] = "/tmp/test_tw_quant_api.duckdb"

from tw_quant_selector.api.app import app
from tw_quant_selector.data.database import Database
from fastapi.testclient import TestClient

client = TestClient(app)
db = Database()


def setup_module():
    db.init_db()


def teardown_module():
    db.close()
    if os.path.exists("/tmp/test_tw_quant_api.duckdb"):
        os.remove("/tmp/test_tw_quant_api.duckdb")


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


def test_latest_signals_no_data():
    resp = client.get("/api/v1/signals/latest")
    assert resp.status_code == 404


def test_data_status():
    resp = client.get("/api/v1/data/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "last_price_update" in data
