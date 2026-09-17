"""
Backend tests for the "11 requirements" iteration:
- Login /mof30
- /reports/dashboard (pos_debts + customer_debts excludes pos)
- /stock accepts start/end and returns per-category period {added, sold, ...}
- /cards accepts category_id
- /notifications/broadcast + /notifications/broadcast-log
- /admin/quick-recharge/list accepts {start, end}
"""
import datetime
import os

import pytest
import requests


def _load_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        with open(p) as fh:
            for line in fh:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    os.environ.setdefault(k, v)
_load_env()
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "Admin@12345"}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"no token in {data}"
    return tok


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


# ------------- Auth -------------
def test_login_ok():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "Admin@12345"}, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j.get("access_token") or j.get("token")


def test_login_bad():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong"}, timeout=30)
    assert r.status_code in (400, 401, 403)


# ------------- Dashboard -------------
def test_dashboard_has_pos_and_customer_debts(auth):
    r = auth.get(f"{API}/reports/dashboard", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "customer_debts" in d
    assert "pos_debts" in d
    assert isinstance(d["customer_debts"], (int, float))
    assert isinstance(d["pos_debts"], (int, float))
    # sales_today / sales_month expected
    assert "sales_today" in d
    assert "sales_month" in d


def test_dashboard_customer_debts_excludes_pos(auth):
    """customer_debts should NOT include pos customer balances.
    Compute expected from /customers and compare to dashboard fields.
    """
    r = auth.get(f"{API}/customers?limit=10000", timeout=30)
    if r.status_code != 200:
        r = auth.get(f"{API}/customers", timeout=30)
    assert r.status_code == 200
    body = r.json()
    customers = body if isinstance(body, list) else body.get("items", body.get("customers", []))
    expected_cust = sum(max(0, c.get("balance", 0)) for c in customers if c.get("customer_type") != "pos")
    expected_pos = sum(c.get("balance", 0) for c in customers if c.get("customer_type") == "pos")
    d = auth.get(f"{API}/reports/dashboard", timeout=30).json()
    assert abs(d["customer_debts"] - expected_cust) < 0.5, (d["customer_debts"], expected_cust)
    assert abs(d["pos_debts"] - expected_pos) < 0.5, (d["pos_debts"], expected_pos)


# ------------- Stock w/ period -------------
def test_stock_no_period(auth):
    r = auth.get(f"{API}/stock", timeout=30)
    assert r.status_code == 200
    lst = r.json()
    assert isinstance(lst, list)
    if lst:
        e = lst[0]
        assert "numbered" in e and "quantity" in e
        # No period key when no start/end
        assert "period" not in e or e.get("period") is None


def test_stock_with_period(auth):
    today = datetime.datetime.now(tz=datetime.timezone.utc).date()
    start = (today - datetime.timedelta(days=30)).isoformat()
    end = today.isoformat()
    r = auth.get(f"{API}/stock", params={"start": start, "end": end}, timeout=60)
    assert r.status_code == 200, r.text
    lst = r.json()
    assert isinstance(lst, list)
    if lst:
        e = lst[0]
        assert "period" in e, e
        p = e["period"]
        # expected keys
        for k in ("added", "sold"):
            assert k in p, p


# ------------- Cards category filter -------------
def test_cards_category_filter(auth):
    cats = auth.get(f"{API}/categories", timeout=30).json()
    if not cats:
        pytest.skip("no categories")
    cat_id = (cats[0].get("id") if isinstance(cats, list) else cats.get("items", [{}])[0].get("id"))
    if not cat_id:
        pytest.skip("no category id")
    r = auth.get(f"{API}/cards", params={"category_id": cat_id}, timeout=30)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    for c in items[:50]:
        assert c.get("category_id") == cat_id


def test_cards_status_filter(auth):
    r = auth.get(f"{API}/cards", params={"status_filter": "available"}, timeout=30)
    assert r.status_code == 200
    for c in r.json()[:20]:
        assert c.get("status") == "available"


# ------------- Notifications broadcast -------------
def test_notifications_broadcast_and_log(auth):
    payload = {"title": "TEST_notif", "message": "TEST_msg", "mode": "all"}
    r = auth.post(f"{API}/notifications/broadcast", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    # log
    r2 = auth.get(f"{API}/notifications/broadcast-log", timeout=30)
    assert r2.status_code == 200
    log = r2.json()
    items = log if isinstance(log, list) else log.get("items", [])
    assert any("TEST_notif" in (x.get("title") or "") for x in items[:50])


# ------------- Quick recharge list w/ period -------------
def test_quick_recharge_list_period(auth):
    today = datetime.datetime.now(tz=datetime.timezone.utc).date()
    r = auth.post(
        f"{API}/admin/quick-recharge/list",
        json={"start": (today - datetime.timedelta(days=30)).isoformat(), "end": today.isoformat()},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, (list, dict))


# ------------- Regression on balances -------------
def test_customer_balances_unchanged(auth):
    r = auth.get(f"{API}/customers?limit=10000", timeout=30)
    if r.status_code != 200:
        r = auth.get(f"{API}/customers", timeout=30)
    assert r.status_code == 200
    body = r.json()
    customers = body if isinstance(body, list) else body.get("items", body.get("customers", []))
    # Find بقالة الحمادي (pos) with balance 2000
    hammadi = [c for c in customers if "الحمادي" in (c.get("name") or "")]
    if hammadi:
        assert any(abs(c.get("balance", 0) - 2000) < 0.5 for c in hammadi), [(h.get("name"), h.get("balance"), h.get("customer_type")) for h in hammadi]
    # some customer with balance 1000
    assert any(abs(c.get("balance", 0) - 1000) < 0.5 for c in customers), "no customer with balance 1000"
