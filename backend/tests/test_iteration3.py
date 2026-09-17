"""
Iteration 3 tests:
- PUT /api/sales/{id} - edit sale (discount/paid/notes) with credit-limit re-check + balance adjust + audit
- PUT /api/receipts/{id} - edit receipt (amount/description) with balance auto-adjust + audit
- GET /api/customers/blocked/list - list active blocks (excludes expired)
- REGRESSION: /api/public-blocks/{phone}/unblock resets failed/blocked_until
- REGRESSION: Public login for a customer whose blocked_until has passed should NOT be blocked
"""
import os
import uuid
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/").strip('"')
API = f"{BASE_URL}/api"

# Direct DB access for time manipulation
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "jawad_net_db"
with open("/app/backend/.env") as f:
    for line in f:
        if line.startswith("MONGO_URL="):
            MONGO_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
        elif line.startswith("DB_NAME="):
            DB_NAME = line.split("=", 1)[1].strip().strip('"').strip("'")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


# --------- Fixtures ---------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _phone():
    return f"7{uuid.uuid4().int % 10**8:08d}"


def _create_customer(H, credit_limit=10000, opening=0, name="TEST_IT3"):
    phone = _phone()
    r = requests.post(f"{API}/customers", json={
        "name": f"{name}_{uuid.uuid4().hex[:4]}",
        "phone": phone,
        "password": "pwd123",
        "credit_limit": credit_limit,
        "opening_balance": opening,
    }, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _create_category(H, value=100, sale_price=100):
    r = requests.post(f"{API}/categories", json={
        "name": "TEST_IT3_CAT_" + uuid.uuid4().hex[:5],
        "value": value, "sale_price": sale_price, "purchase_price": 80,
    }, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _seed_stock_quantity(H, category_id, qty):
    # Add stock through a supplier purchase (uses quantity path)
    r = requests.post(f"{API}/purchases", json={
        "supplier_id": None, "supplier_name": "TEST_SEED_SUP",
        "items": [{"category_id": category_id, "category_name": "x",
                   "quantity": qty, "price": 80, "use_numbered": False}],
        "discount": 0, "paid": 0,
    }, headers=H)
    assert r.status_code == 200, r.text


def _create_sale(H, customer, category, quantity=1, price=100, paid=0, discount=0):
    _seed_stock_quantity(H, category["id"], quantity + 5)
    r = requests.post(f"{API}/sales", json={
        "customer_id": customer["id"], "customer_name": customer["name"],
        "sale_type": "credit",
        "items": [{"category_id": category["id"], "category_name": category["name"],
                   "quantity": quantity, "price": price, "use_numbered": False}],
        "discount": discount, "paid": paid,
    }, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _get_customer(H, cid):
    # GET /customers/{id} not implemented in server; fetch via list and filter
    r = requests.get(f"{API}/customers", headers=H)
    assert r.status_code == 200, r.text
    for c in r.json():
        if c.get("id") == cid:
            return c
    raise AssertionError(f"customer {cid} not found")


# ============ EDIT SALE ============
class TestEditSale:
    def test_edit_sale_adjusts_balance(self, H):
        cust = _create_customer(H, credit_limit=10000)
        cat = _create_category(H)
        sale = _create_sale(H, cust, cat, quantity=1, price=100, paid=0)
        # Initially balance += 100 (remaining=100)
        after_create = _get_customer(H, cust["id"])
        assert after_create["balance"] == 100, f"expected 100 got {after_create['balance']}"

        # Edit: paid=30 -> remaining becomes 70 -> customer balance should drop by 30 => 70
        r = requests.put(f"{API}/sales/{sale['id']}", json={"paid": 30}, headers=H)
        assert r.status_code == 200, r.text

        after_edit = _get_customer(H, cust["id"])
        assert after_edit["balance"] == 70, f"expected 70 got {after_edit['balance']}"

        # Verify sale updated
        s = requests.get(f"{API}/sales/{sale['id']}", headers=H).json()
        assert s["paid"] == 30
        assert s["remaining"] == 70
        assert s.get("edited_by") == "admin"

    def test_edit_sale_credit_limit_exceeded(self, H):
        # customer with credit_limit=100, existing sale paid=100 (remaining=0, bal=0)
        cust = _create_customer(H, credit_limit=100)
        cat = _create_category(H, sale_price=100)
        sale = _create_sale(H, cust, cat, quantity=1, price=100, paid=100)
        assert _get_customer(H, cust["id"])["balance"] == 0

        # Now try to edit: paid=0 -> remaining=100 -> balance would go to 100 (== limit, ok)
        # Try paid= -50 - invalid; use discount instead. Actually increase would need remaining > limit.
        # Bring remaining to 150 (increase discount? no, that reduces total)
        # Better: paid=0 -> new remaining=100 -> new bal=100 -> equals limit (not > so ok)
        # To exceed: subtotal 100 - discount 0 - paid=-100? paid must be number.
        # Simpler: create sale price=200, paid=200 (remaining=0), limit=100. Edit paid=0 -> remaining=200 > 100 => 400.
        cust2 = _create_customer(H, credit_limit=100)
        cat2 = _create_category(H, sale_price=200)
        sale2 = _create_sale(H, cust2, cat2, quantity=1, price=200, paid=200)
        assert _get_customer(H, cust2["id"])["balance"] == 0

        r = requests.put(f"{API}/sales/{sale2['id']}", json={"paid": 0}, headers=H)
        assert r.status_code == 400, r.text
        assert "التعديل يتجاوز سقف حساب العميل" in r.text
        # Balance must remain 0
        assert _get_customer(H, cust2["id"])["balance"] == 0

    def test_edit_cancelled_sale_400(self, H):
        cust = _create_customer(H)
        cat = _create_category(H)
        sale = _create_sale(H, cust, cat, quantity=1, price=100, paid=0)
        # Cancel
        c = requests.post(f"{API}/sales/{sale['id']}/cancel", headers=H)
        assert c.status_code == 200, c.text
        # Try to edit
        r = requests.put(f"{API}/sales/{sale['id']}", json={"paid": 50}, headers=H)
        assert r.status_code == 400, r.text
        assert "لا يمكن تعديل فاتورة ملغاة" in r.text

    def test_edit_sale_notes_only(self, H):
        cust = _create_customer(H)
        cat = _create_category(H)
        sale = _create_sale(H, cust, cat, quantity=1, price=50, paid=0)
        bal_before = _get_customer(H, cust["id"])["balance"]
        r = requests.put(f"{API}/sales/{sale['id']}", json={"notes": "ملاحظة تعديل"}, headers=H)
        assert r.status_code == 200
        # balance unchanged
        assert _get_customer(H, cust["id"])["balance"] == bal_before
        s = requests.get(f"{API}/sales/{sale['id']}", headers=H).json()
        assert s["notes"] == "ملاحظة تعديل"


# ============ EDIT RECEIPT ============
class TestEditReceipt:
    def test_edit_receipt_amount_adjusts_balance(self, H):
        # customer with debt=200
        cust = _create_customer(H)
        cat = _create_category(H)
        _create_sale(H, cust, cat, quantity=2, price=100, paid=0)
        assert _get_customer(H, cust["id"])["balance"] == 200

        # Create receipt for 50 -> balance = 150
        rc = requests.post(f"{API}/receipts", json={
            "kind": "receipt", "party_type": "customer",
            "party_id": cust["id"], "party_name": cust["name"],
            "amount": 50, "description": "دفعة 1",
        }, headers=H)
        assert rc.status_code == 200, rc.text
        rec = rc.json()
        assert _get_customer(H, cust["id"])["balance"] == 150

        # Edit receipt amount to 80 -> balance decreases 30 more -> 120
        e = requests.put(f"{API}/receipts/{rec['id']}", json={"amount": 80}, headers=H)
        assert e.status_code == 200, e.text
        assert _get_customer(H, cust["id"])["balance"] == 120

        # Decrease amount to 20 -> balance increases by 60 -> 180
        e2 = requests.put(f"{API}/receipts/{rec['id']}", json={"amount": 20}, headers=H)
        assert e2.status_code == 200
        assert _get_customer(H, cust["id"])["balance"] == 180

    def test_edit_receipt_audit_log(self, H):
        cust = _create_customer(H)
        cat = _create_category(H)
        _create_sale(H, cust, cat, quantity=1, price=100, paid=0)
        rc = requests.post(f"{API}/receipts", json={
            "kind": "receipt", "party_type": "customer",
            "party_id": cust["id"], "party_name": cust["name"],
            "amount": 40, "description": "orig",
        }, headers=H).json()
        e = requests.put(f"{API}/receipts/{rc['id']}",
                        json={"amount": 55, "description": "updated"}, headers=H)
        assert e.status_code == 200

        # Verify audit
        audit = requests.get(f"{API}/audit", headers=H)
        assert audit.status_code == 200
        entries = [a for a in audit.json()
                   if a.get("action") == "edit" and a.get("entity") == "receipt"
                   and a.get("entity_id") == rc["id"]]
        assert entries, "No audit entry for edited receipt"
        entry = entries[0]
        # old/new amount stored in old_value/new_value
        ov = entry.get("old_value") or {}
        nv = entry.get("new_value") or {}
        assert ov.get("old_amount") == 40, f"old_value={ov}"
        assert nv.get("new_amount") == 55, f"new_value={nv}"

    def test_edit_receipt_description_only(self, H):
        cust = _create_customer(H)
        cat = _create_category(H)
        _create_sale(H, cust, cat, quantity=1, price=100, paid=0)
        rc = requests.post(f"{API}/receipts", json={
            "kind": "receipt", "party_type": "customer",
            "party_id": cust["id"], "party_name": cust["name"],
            "amount": 30, "description": "d1",
        }, headers=H).json()
        bal = _get_customer(H, cust["id"])["balance"]
        e = requests.put(f"{API}/receipts/{rc['id']}",
                        json={"description": "d2 updated"}, headers=H)
        assert e.status_code == 200
        # No balance change
        assert _get_customer(H, cust["id"])["balance"] == bal


# ============ BLOCKED LIST ============
class TestBlockedList:
    def test_requires_auth(self):
        r = requests.get(f"{API}/customers/blocked/list")
        assert r.status_code in (401, 403)

    def test_lists_active_and_excludes_expired(self, H):
        # Active block: create customer and trigger 5 failed logins
        active_phone = _phone()
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_BL_ACTIVE", "phone": active_phone, "password": "correct",
            "credit_limit": 0,
        }, headers=H).json()
        for _ in range(5):
            requests.post(f"{API}/public/card-order/login",
                          json={"phone": active_phone, "password": "wrong"})
        # trigger 6th to ensure block
        requests.post(f"{API}/public/card-order/login",
                      json={"phone": active_phone, "password": "correct"})

        # Expired block: insert directly with past date
        expired_phone = _phone()
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        db.public_blocks.delete_many({"phone": expired_phone})
        db.public_blocks.insert_one({
            "id": str(uuid.uuid4()),
            "phone": expired_phone,
            "failed": 5,
            "blocked_at": (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat(),
            "blocked_until": past,
        })

        r = requests.get(f"{API}/customers/blocked/list", headers=H)
        assert r.status_code == 200, r.text
        data = r.json()
        phones = [b["phone"] for b in data]
        assert active_phone in phones, f"active {active_phone} missing from {phones}"
        assert expired_phone not in phones, "expired phone should be excluded"

        entry = next(b for b in data if b["phone"] == active_phone)
        for key in ("phone", "customer_name", "customer_id", "blocked_at",
                    "blocked_until", "failed_before_block"):
            assert key in entry, f"missing key {key}"
        assert entry["failed_before_block"] == 5
        assert entry["customer_name"] == cust["name"]
        assert entry["customer_id"] == cust["id"]


# ============ REGRESSION ============
class TestRegressionUnblock:
    def test_unblock_resets_failed_and_blocked_until(self, H):
        phone = _phone()
        requests.post(f"{API}/customers", json={
            "name": "TEST_UB", "phone": phone, "password": "correct", "credit_limit": 0,
        }, headers=H)
        for _ in range(5):
            requests.post(f"{API}/public/card-order/login",
                          json={"phone": phone, "password": "wrong"})
        u = requests.post(f"{API}/public-blocks/{phone}/unblock", headers=H)
        assert u.status_code == 200

        # Verify DB state
        rec = db.public_blocks.find_one({"phone": phone})
        assert rec is not None
        assert rec.get("failed") == 0
        assert rec.get("blocked_until") is None

    def test_expired_block_allows_login(self, H):
        phone = _phone()
        requests.post(f"{API}/customers", json={
            "name": "TEST_EXP", "phone": phone, "password": "correctpwd", "credit_limit": 0,
        }, headers=H)
        # Manually set an expired block
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        db.public_blocks.update_one(
            {"phone": phone},
            {"$set": {
                "phone": phone, "failed": 5,
                "blocked_at": (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat(),
                "blocked_until": past,
            }},
            upsert=True,
        )
        # Login with correct password should succeed (not 429)
        r = requests.post(f"{API}/public/card-order/login",
                          json={"phone": phone, "password": "correctpwd"})
        assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text}"
