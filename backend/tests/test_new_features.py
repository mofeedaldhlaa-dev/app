"""
Tests for new features added in iteration 2:
- Rate limiting on public card-order login (5 failed => 24h block)
- Block management endpoints
- Register requests (list/approve/reject)
- customer_type field on customers
- Customer password reveal
- Categories with dual pricing + low stock fields
- Purchases with numbered cards (use_numbered)
- Backup export/restore
- Reset-data endpoint (guardrail tests only)
- Dashboard pending_register_requests
- Change-password creates notification
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


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


# --------- Rate limit on public card-order login ---------
class TestRateLimit:
    def test_5_failures_block_and_unblock(self, H):
        # Create a customer first
        phone = _phone()
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_RL", "phone": phone, "password": "correctpwd",
            "credit_limit": 100, "opening_balance": 0,
        }, headers=H).json()

        # 5 failed logins (wrong password) => customer exists, so returns 401
        for i in range(5):
            r = requests.post(f"{API}/public/card-order/login",
                              json={"phone": phone, "password": "wrong"})
            assert r.status_code == 401, f"attempt {i} got {r.status_code}: {r.text}"

        # 6th attempt should be blocked (429)
        r = requests.post(f"{API}/public/card-order/login",
                          json={"phone": phone, "password": "correctpwd"})
        assert r.status_code == 429, r.text
        assert "تم حظر الإدخال" in r.text
        assert "24 ساعة" in r.text

        # List blocks
        blocks = requests.get(f"{API}/public-blocks", headers=H)
        assert blocks.status_code == 200
        assert any(b.get("phone") == phone for b in blocks.json())

        # Unblock
        u = requests.post(f"{API}/public-blocks/{phone}/unblock", headers=H)
        assert u.status_code == 200
        assert u.json()["ok"] is True

        # Now login again should work with correct pwd
        r2 = requests.post(f"{API}/public/card-order/login",
                           json={"phone": phone, "password": "correctpwd"})
        assert r2.status_code == 200, r2.text

    def test_unblock_requires_auth(self):
        r = requests.post(f"{API}/public-blocks/0000000/unblock")
        assert r.status_code in (401, 403)


# --------- Register Requests ---------
class TestRegisterRequests:
    def test_full_flow_approve(self, H):
        phone = _phone()
        # public creates request
        r = requests.post(f"{API}/public/customer/register-request", json={
            "full_name": "طالب TEST", "phone": phone, "address": "Sanaa"
        })
        assert r.status_code == 200 and r.json()["ok"] is True

        # admin list
        lst = requests.get(f"{API}/register-requests", headers=H)
        assert lst.status_code == 200
        match = [x for x in lst.json() if x.get("phone") == phone]
        assert match, "register request not found"
        rid = match[0]["id"]

        # approve with customer_type=pos
        ap = requests.post(f"{API}/register-requests/{rid}/approve",
                           json={"credit_limit": 5000, "customer_type": "pos", "password": "mypwd"},
                           headers=H)
        assert ap.status_code == 200, ap.text
        cust = ap.json()["customer"]
        assert cust["phone"] == phone
        assert cust["customer_type"] == "pos"
        assert cust["credit_limit"] == 5000

        # verify status flipped
        lst2 = requests.get(f"{API}/register-requests", headers=H).json()
        entry = next(x for x in lst2 if x["id"] == rid)
        assert entry["status"] == "approved"

    def test_approve_duplicate_phone(self, H):
        # Existing customer
        phone = _phone()
        requests.post(f"{API}/customers", json={
            "name": "TEST_DUP", "phone": phone, "password": "p", "credit_limit": 0,
        }, headers=H)
        # Now create register request with same phone
        r = requests.post(f"{API}/public/customer/register-request", json={
            "full_name": "طالب DUP", "phone": phone,
        })
        assert r.status_code == 200
        rid = [x for x in requests.get(f"{API}/register-requests", headers=H).json()
               if x["phone"] == phone and x["status"] == "pending"][0]["id"]
        # try approve
        ap = requests.post(f"{API}/register-requests/{rid}/approve",
                           json={"credit_limit": 0}, headers=H)
        assert ap.status_code == 400
        assert "يوجد عميل بنفس الرقم" in ap.text

    def test_reject(self, H):
        phone = _phone()
        requests.post(f"{API}/public/customer/register-request",
                      json={"full_name": "طالب REJ", "phone": phone})
        rid = [x for x in requests.get(f"{API}/register-requests", headers=H).json()
               if x["phone"] == phone][0]["id"]
        r = requests.post(f"{API}/register-requests/{rid}/reject", headers=H)
        assert r.status_code == 200
        lst = requests.get(f"{API}/register-requests", headers=H).json()
        assert next(x for x in lst if x["id"] == rid)["status"] == "rejected"


# --------- Customer type + password reveal ---------
class TestCustomerTypeAndPwdReveal:
    def test_create_pos_and_reveal(self, H):
        phone = _phone()
        r = requests.post(f"{API}/customers", json={
            "name": "TEST_POS", "phone": phone, "password": "secret42",
            "credit_limit": 200, "customer_type": "pos",
        }, headers=H)
        assert r.status_code == 200
        cid = r.json()["id"]
        assert r.json().get("customer_type") == "pos"

        # Update customer_type back to customer
        upd = requests.put(f"{API}/customers/{cid}", json={
            "name": "TEST_POS", "phone": phone, "credit_limit": 200,
            "customer_type": "customer",
        }, headers=H)
        assert upd.status_code == 200
        assert upd.json().get("customer_type") == "customer"

        # Reveal password
        p = requests.get(f"{API}/customers/{cid}/password", headers=H)
        assert p.status_code == 200
        assert p.json()["password"] == "secret42"

    def test_pwd_reveal_requires_auth(self):
        r = requests.get(f"{API}/customers/nonexistent/password")
        assert r.status_code in (401, 403)


# --------- Categories new fields ---------
class TestCategoriesNew:
    def test_create_with_dual_pricing_and_low_stock(self, H):
        payload = {
            "name": "TEST_CAT_" + uuid.uuid4().hex[:5],
            "value": 100, "sale_price": 100, "purchase_price": 80,
            "sale_price_customer": 110, "sale_price_pos": 95,
            "low_stock_numbered": 3, "low_stock_quantity": 7,
            "validity_days": 30, "data_size": "1GB",
        }
        r = requests.post(f"{API}/categories", json=payload, headers=H)
        assert r.status_code == 200
        d = r.json()
        assert d.get("sale_price_customer") == 110
        assert d.get("sale_price_pos") == 95
        assert d.get("low_stock_numbered") == 3
        assert d.get("low_stock_quantity") == 7


# --------- Purchases with numbered cards ---------
class TestPurchasesNumbered:
    def test_use_numbered_creates_available_cards_no_stock_bump(self, H):
        # Create category
        cat = requests.post(f"{API}/categories", json={
            "name": "TEST_PCAT_" + uuid.uuid4().hex[:5],
            "value": 500, "sale_price": 500, "purchase_price": 400,
        }, headers=H).json()

        # Baseline stock
        stock_before = requests.get(f"{API}/stock", headers=H).json()
        row = next((s for s in stock_before if s.get("category_id") == cat["id"]), None)
        qty_before = (row or {}).get("quantity", 0)

        nums = [f"PN{uuid.uuid4().hex[:8].upper()}" for _ in range(3)]
        r = requests.post(f"{API}/purchases", json={
            "supplier_id": None, "supplier_name": "TEST_SUP",
            "items": [{
                "category_id": cat["id"], "category_name": cat["name"],
                "quantity": 3, "price": 400,
                "use_numbered": True, "card_numbers": nums,
            }],
            "discount": 0, "paid": 0,
        }, headers=H)
        assert r.status_code == 200, r.text

        # Each numbered card should exist as available
        for n in nums:
            c = requests.get(f"{API}/cards/search/{n}", headers=H)
            assert c.status_code == 200, f"card {n} missing"
            assert c.json()["status"] == "available"

        # Stock quantity should NOT have been incremented
        stock_after = requests.get(f"{API}/stock", headers=H).json()
        row2 = next((s for s in stock_after if s.get("category_id") == cat["id"]), None)
        qty_after = (row2 or {}).get("quantity", 0)
        assert qty_after == qty_before, f"Stock qty changed: {qty_before} -> {qty_after}"


# --------- Backup export/restore ---------
class TestBackup:
    def test_export(self, H):
        r = requests.get(f"{API}/backup/export", headers=H, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "customers" in d and isinstance(d["customers"], list)
        assert "sales" in d
        assert "_exported_at" in d
        # No _id keys should leak
        def has_id(v):
            if isinstance(v, dict):
                if "_id" in v: return True
                return any(has_id(x) for x in v.values())
            if isinstance(v, list):
                return any(has_id(x) for x in v)
            return False
        assert not has_id(d), "backup contains raw _id keys"

    def test_restore_creates_snapshot(self, H):
        # Export minimal data & restore-in with an empty subset (safe)
        # Use a payload that only contains one key so we don't wipe much
        payload = {"data": {"notifications": []}}
        # capture current notifications count via export
        exp = requests.get(f"{API}/backup/export", headers=H).json()
        notif_before = len(exp.get("notifications", []))
        r = requests.post(f"{API}/backup/restore", json=payload, headers=H, timeout=60)
        assert r.status_code == 200, r.text
        assert "snapshot_id" in r.json()
        # after restore notifications should be empty (payload replaced)
        exp2 = requests.get(f"{API}/backup/export", headers=H).json()
        assert len(exp2.get("notifications", [])) == 0
        # And snapshot was created (we can't hit collection directly, but response contains id)
        assert r.json()["snapshot_id"]


# --------- Reset data guardrails ---------
class TestResetDataGuardrails:
    def test_reset_wrong_credentials_401(self, H):
        r = requests.post(f"{API}/settings/reset-data", json={
            "username": "admin", "password": "WRONG_PWD", "confirm": True,
        }, headers=H)
        assert r.status_code == 401
        assert "بيانات الاعتماد غير صحيحة" in r.text

    def test_reset_no_confirm_400(self, H):
        r = requests.post(f"{API}/settings/reset-data", json={
            "username": "admin", "password": "admin123", "confirm": False,
        }, headers=H)
        assert r.status_code == 400
        assert "يجب التأكيد" in r.text

    def test_reset_no_auth(self):
        r = requests.post(f"{API}/settings/reset-data", json={
            "username": "admin", "password": "admin123", "confirm": True,
        })
        assert r.status_code in (401, 403)


# --------- Dashboard pending_register_requests ---------
class TestDashboardExt:
    def test_dashboard_includes_pending(self, H):
        r = requests.get(f"{API}/reports/dashboard", headers=H)
        assert r.status_code == 200
        assert "pending_register_requests" in r.json()
        assert isinstance(r.json()["pending_register_requests"], int)


# --------- Change password creates notification ---------
class TestChangePwdNotification:
    def test_change_pwd_notification(self, H):
        phone = _phone()
        requests.post(f"{API}/customers", json={
            "name": "TEST_ChgNotif", "phone": phone, "password": "old99",
            "credit_limit": 0,
        }, headers=H)
        r = requests.post(f"{API}/public/customer/change-password", json={
            "phone": phone, "current_password": "old99", "new_password": "new88",
        })
        assert r.status_code == 200
        # Notifications endpoint
        notifs = requests.get(f"{API}/notifications", headers=H)
        if notifs.status_code == 200:
            found = any(
                n.get("title") == "تغيير كلمة المرور" and phone in (n.get("message") or "")
                for n in notifs.json()
            )
            assert found, "notification for password change missing"


# --------- Regression: idempotency on sales ---------
class TestRegressionIdempotency:
    def test_sales_idempotency_key(self, H):
        # Create a customer + category + stock
        phone = _phone()
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_IDEM", "phone": phone, "password": "p", "credit_limit": 100000,
        }, headers=H).json()
        cat = requests.post(f"{API}/categories", json={
            "name": "TEST_IDCAT_" + uuid.uuid4().hex[:5],
            "value": 50, "sale_price": 50, "purchase_price": 40,
        }, headers=H).json()
        requests.post(f"{API}/cards/add-quantity",
                      json={"category_id": cat["id"], "quantity": 5}, headers=H)
        key = str(uuid.uuid4())
        body = {
            "customer_id": cust["id"], "customer_name": cust["name"], "sale_type": "credit",
            "items": [{"category_id": cat["id"], "category_name": cat["name"],
                       "quantity": 1, "price": 50, "card_numbers": [], "use_numbered": False}],
            "idempotency_key": key,
        }
        r1 = requests.post(f"{API}/sales", json=body, headers=H)
        r2 = requests.post(f"{API}/sales", json=body, headers=H)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"]
