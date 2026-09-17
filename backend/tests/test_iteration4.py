"""
Iteration 4 tests:
- BUG FIX: POST /api/public/card-order/login rate-limit for phones NOT in customers (5 fails -> 429)
- NEW: POST /api/sales validation: customer_id required + sale_type in cash/credit
- REGRESSION: POST /api/sales with valid customer_id + sale_type='cash' still works
- NEW: PUT /api/purchases/{id} edit endpoint (discount/paid/notes + supplier balance auto-adjust)
- NEW: PUT /api/purchases/{id} on cancelled purchase returns 400
- NEW: PUT /api/purchases/{id} without edit_ops permission returns 403
"""
import os
import uuid
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


def _create_customer(H, credit_limit=10000, opening=0):
    phone = _phone()
    r = requests.post(f"{API}/customers", json={
        "name": f"TEST_IT4_{uuid.uuid4().hex[:5]}", "phone": phone,
        "password": "pwd123", "credit_limit": credit_limit, "opening_balance": opening,
    }, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _create_category(H):
    r = requests.post(f"{API}/categories", json={
        "name": "TEST_IT4_CAT_" + uuid.uuid4().hex[:5],
        "value": 100, "sale_price": 100, "purchase_price": 80,
    }, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _create_supplier(H):
    r = requests.post(f"{API}/suppliers", json={
        "name": "TEST_IT4_SUP_" + uuid.uuid4().hex[:5],
        "phone": _phone(), "opening_balance": 0,
    }, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _get_supplier(H, sid):
    r = requests.get(f"{API}/suppliers", headers=H)
    assert r.status_code == 200
    for s in r.json():
        if s.get("id") == sid:
            return s
    raise AssertionError("supplier not found")


# ============ BUG FIX: public login rate-limit for non-existent phones ============
class TestPublicLoginNonExistentRateLimit:
    def test_five_wrong_attempts_on_nonexistent_phone_returns_429_on_sixth(self):
        phone = _phone()
        # Clean any leftover
        db.public_blocks.delete_one({"phone": phone})

        # First 5 attempts: 404
        for i in range(5):
            r = requests.post(f"{API}/public/card-order/login",
                              json={"phone": phone, "password": "x"}, timeout=15)
            assert r.status_code == 404, f"attempt {i+1}: {r.status_code} {r.text}"

        # 6th attempt should be blocked (429)
        r = requests.post(f"{API}/public/card-order/login",
                         json={"phone": phone, "password": "x"}, timeout=15)
        assert r.status_code == 429, f"expected 429, got {r.status_code}: {r.text}"
        assert "تم حظر الإدخال" in r.json().get("detail", ""), r.text

        # DB: block record should exist with blocked_until set
        blk = db.public_blocks.find_one({"phone": phone})
        assert blk is not None
        assert blk.get("blocked_until"), "blocked_until must be set"

        # cleanup
        db.public_blocks.delete_one({"phone": phone})

    def test_valid_phone_still_returns_401_and_increments(self, H):
        cust = _create_customer(H)
        phone = cust["phone"]
        db.public_blocks.delete_one({"phone": phone})

        for i in range(2):
            r = requests.post(f"{API}/public/card-order/login",
                              json={"phone": phone, "password": "wrong"}, timeout=15)
            assert r.status_code == 401, f"attempt {i+1}: {r.status_code}"

        blk = db.public_blocks.find_one({"phone": phone})
        assert blk and blk.get("failed") == 2

        # Correct password succeeds and resets counter
        r = requests.post(f"{API}/public/card-order/login",
                          json={"phone": phone, "password": "pwd123"}, timeout=15)
        assert r.status_code == 200, r.text
        blk = db.public_blocks.find_one({"phone": phone})
        assert blk.get("failed") == 0

        db.public_blocks.delete_one({"phone": phone})


# ============ NEW: POST /api/sales validations ============
class TestSalesValidations:
    def test_sales_without_customer_id_returns_400(self, H):
        cat = _create_category(H)
        r = requests.post(f"{API}/sales", json={
            "customer_id": None, "customer_name": "Anonymous",
            "sale_type": "cash",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 1, "price": 100, "use_numbered": False}],
            "discount": 0, "paid": 100,
        }, headers=H)
        assert r.status_code == 400, r.text
        assert "يرجى اختيار العميل" in r.json().get("detail", ""), r.text

    def test_sales_with_missing_sale_type_returns_400(self, H):
        cust = _create_customer(H)
        cat = _create_category(H)
        # sale_type omitted / invalid
        r = requests.post(f"{API}/sales", json={
            "customer_id": cust["id"], "customer_name": cust["name"],
            "sale_type": "",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 1, "price": 100, "use_numbered": False}],
            "discount": 0, "paid": 0,
        }, headers=H)
        assert r.status_code == 400, r.text
        assert "نوع الفاتورة" in r.json().get("detail", ""), r.text

    def test_sales_with_invalid_sale_type_returns_400(self, H):
        cust = _create_customer(H)
        cat = _create_category(H)
        r = requests.post(f"{API}/sales", json={
            "customer_id": cust["id"], "customer_name": cust["name"],
            "sale_type": "installment",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 1, "price": 100, "use_numbered": False}],
            "discount": 0, "paid": 0,
        }, headers=H)
        assert r.status_code == 400, r.text
        assert "نوع الفاتورة" in r.json().get("detail", ""), r.text

    def test_sales_cash_valid_still_creates(self, H):
        cust = _create_customer(H)
        cat = _create_category(H)
        # seed stock
        requests.post(f"{API}/purchases", json={
            "supplier_id": None, "supplier_name": "SEED",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 5, "price": 80, "use_numbered": False}],
            "discount": 0, "paid": 0,
        }, headers=H)
        r = requests.post(f"{API}/sales", json={
            "customer_id": cust["id"], "customer_name": cust["name"],
            "sale_type": "cash",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 1, "price": 100, "use_numbered": False}],
            "discount": 0, "paid": 100,
        }, headers=H)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("total") == 100
        assert data.get("sale_type") == "cash"
        assert "id" in data


# ============ NEW: PUT /api/purchases/{id} ============
class TestEditPurchase:
    def _make_purchase(self, H, supplier_id, subtotal_qty=10, price=80, paid=0, discount=0):
        cat = _create_category(H)
        r = requests.post(f"{API}/purchases", json={
            "supplier_id": supplier_id, "supplier_name": "S",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": subtotal_qty, "price": price, "use_numbered": False}],
            "discount": discount, "paid": paid,
        }, headers=H)
        assert r.status_code == 200, r.text
        return r.json()

    def test_edit_purchase_adjusts_supplier_balance(self, H):
        sup = _create_supplier(H)
        # Create purchase: subtotal=800, discount=0, paid=0, remaining=800 -> supplier balance += 800
        p = self._make_purchase(H, sup["id"], subtotal_qty=10, price=80, paid=0)
        assert p["remaining"] == 800
        sup_after = _get_supplier(H, sup["id"])
        bal_before_edit = sup_after.get("balance", 0)
        assert bal_before_edit == 800

        # Edit: paid=300 -> new_remaining=500. diff=-300 -> supplier balance -= 300
        r = requests.put(f"{API}/purchases/{p['id']}",
                         json={"paid": 300, "discount": 0, "notes": "partial"}, headers=H)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify purchase updated
        gp = requests.get(f"{API}/purchases/{p['id']}", headers=H)
        assert gp.status_code == 200
        pdoc = gp.json()
        assert pdoc["paid"] == 300
        assert pdoc["remaining"] == 500
        assert pdoc["notes"] == "partial"

        # Verify supplier balance adjusted by diff (-300)
        sup_after2 = _get_supplier(H, sup["id"])
        assert sup_after2["balance"] == bal_before_edit - 300, sup_after2

    def test_edit_purchase_with_discount(self, H):
        sup = _create_supplier(H)
        p = self._make_purchase(H, sup["id"], subtotal_qty=10, price=80, paid=0)
        # subtotal=800, remaining=800
        # Edit discount=100 -> new_total=700, new_remaining=700, diff=-100
        r = requests.put(f"{API}/purchases/{p['id']}",
                         json={"discount": 100}, headers=H)
        assert r.status_code == 200, r.text
        gp = requests.get(f"{API}/purchases/{p['id']}", headers=H).json()
        assert gp["discount"] == 100
        assert gp["total"] == 700
        assert gp["remaining"] == 700

    def test_edit_cancelled_purchase_returns_400(self, H):
        sup = _create_supplier(H)
        p = self._make_purchase(H, sup["id"], subtotal_qty=5, price=80, paid=0)
        # Cancel it via DB (no cancel endpoint for purchases in current server?)
        # Check if endpoint exists first
        c = requests.post(f"{API}/purchases/{p['id']}/cancel", headers=H)
        if c.status_code == 404:
            # fallback: set status directly in DB
            db.purchases.update_one({"id": p["id"]}, {"$set": {"status": "cancelled"}})
        else:
            assert c.status_code == 200, c.text

        r = requests.put(f"{API}/purchases/{p['id']}",
                         json={"paid": 100}, headers=H)
        assert r.status_code == 400, r.text
        assert "ملغاة" in r.json().get("detail", ""), r.text

    def test_edit_purchase_without_edit_ops_returns_403(self, H):
        sup = _create_supplier(H)
        p = self._make_purchase(H, sup["id"], subtotal_qty=3, price=80, paid=0)

        # Create a user without edit_ops
        uname = "TEST_IT4_U_" + uuid.uuid4().hex[:5]
        pw = "pw12345"
        cu = requests.post(f"{API}/users", json={
            "username": uname, "password": pw, "name": uname, "role": "employee",
            "permissions": ["sales", "purchases"],  # NO edit_ops
        }, headers=H)
        assert cu.status_code == 200, cu.text

        lg = requests.post(f"{API}/auth/login", json={"username": uname, "password": pw})
        assert lg.status_code == 200, lg.text
        tok = lg.json()["token"]
        H2 = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

        r = requests.put(f"{API}/purchases/{p['id']}",
                        json={"paid": 50}, headers=H2)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
