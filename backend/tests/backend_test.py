"""
Comprehensive backend tests for شبكة جواد نت اللاسلكية (Jawad Net ERP).
Covers: auth, customers, categories, cards, sales (credit limit + idempotency),
public order flows (login/request/register/forgot/change-password), reports,
stock, suppliers, receipts, audit.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read from frontend .env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

API = f"{BASE_URL}/api"

# --------- Fixtures ---------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def test_customer(auth_headers):
    """Create a test customer with password + credit_limit."""
    phone = f"7{uuid.uuid4().int % 10**8:08d}"
    payload = {
        "name": "TEST_Customer_" + phone[-4:],
        "phone": phone,
        "password": "pass1234",
        "credit_limit": 10000,
        "opening_balance": 0,
        "address": "Sanaa",
    }
    r = requests.post(f"{API}/customers", json=payload, headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["phone"] == phone
    return doc


@pytest.fixture(scope="session")
def test_category(auth_headers):
    payload = {
        "name": "TEST_Cat_" + uuid.uuid4().hex[:6],
        "value": 100, "sale_price": 100, "purchase_price": 90,
        "validity_days": 30, "data_size": "1GB", "low_stock_threshold": 5,
    }
    r = requests.post(f"{API}/categories", json=payload, headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# --------- Auth ---------
class TestAuth:
    def test_login_success(self):
        r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        d = r.json()
        assert "token" in d and isinstance(d["token"], str)
        assert d["user"]["username"] == "admin"

    def test_login_bad_password(self):
        r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401

    def test_me(self, auth_headers):
        r = requests.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_me_no_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code in (401, 403)


# --------- Customers ---------
class TestCustomers:
    def test_create_and_list(self, auth_headers, test_customer):
        r = requests.get(f"{API}/customers", headers=auth_headers)
        assert r.status_code == 200
        ids = [c["id"] for c in r.json()]
        assert test_customer["id"] in ids

    def test_admin_reset_customer_password(self, auth_headers, test_customer):
        r = requests.post(f"{API}/customers/{test_customer['id']}/password",
                          json={"password": "newpass1"}, headers=auth_headers)
        assert r.status_code == 200
        # verify by public login
        r2 = requests.post(f"{API}/public/card-order/login",
                           json={"phone": test_customer["phone"], "password": "newpass1"})
        assert r2.status_code == 200
        # restore
        requests.post(f"{API}/customers/{test_customer['id']}/password",
                      json={"password": "pass1234"}, headers=auth_headers)

    def test_admin_reset_short_pwd(self, auth_headers, test_customer):
        r = requests.post(f"{API}/customers/{test_customer['id']}/password",
                          json={"password": "1"}, headers=auth_headers)
        assert r.status_code == 400


# --------- Categories ---------
class TestCategories:
    def test_list(self, auth_headers):
        r = requests.get(f"{API}/categories", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_update(self, auth_headers, test_category):
        payload = {**test_category, "sale_price": 150}
        payload.pop("id", None); payload.pop("created_at", None)
        r = requests.put(f"{API}/categories/{test_category['id']}", json=payload, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["sale_price"] == 150

    def test_delete_unused(self, auth_headers):
        # create then delete
        r = requests.post(f"{API}/categories", json={
            "name": "TEST_DelCat_" + uuid.uuid4().hex[:5],
            "value": 50, "sale_price": 50, "purchase_price": 40,
        }, headers=auth_headers)
        cid = r.json()["id"]
        d = requests.delete(f"{API}/categories/{cid}", headers=auth_headers)
        assert d.status_code == 200
        assert d.json()["action"] == "deleted"


# --------- Cards ---------
class TestCards:
    def test_add_numbers_dedup_invalid(self, auth_headers, test_category):
        nums = [f"1000{uuid.uuid4().int % 10000:04d}" for _ in range(3)]
        payload = {"category_id": test_category["id"], "numbers": nums + [nums[0], "ab", ""]}
        r = requests.post(f"{API}/cards/add-numbers", json=payload, headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        assert d["added"] == 3
        assert nums[0] in d["duplicates"]
        assert "ab" in d["invalid"]

    def test_add_quantity(self, auth_headers, test_category):
        r = requests.post(f"{API}/cards/add-quantity",
                          json={"category_id": test_category["id"], "quantity": 20},
                          headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["added"] == 20

    def test_edit_and_delete_card(self, auth_headers, test_category):
        n = f"9999{uuid.uuid4().int % 10000:04d}"
        requests.post(f"{API}/cards/add-numbers",
                      json={"category_id": test_category["id"], "numbers": [n]},
                      headers=auth_headers)
        card = requests.get(f"{API}/cards/search/{n}", headers=auth_headers).json()
        # edit notes
        r = requests.put(f"{API}/cards/{card['id']}", json={"notes": "edited"}, headers=auth_headers)
        assert r.status_code == 200
        # delete available card -> deleted
        d = requests.delete(f"{API}/cards/{card['id']}", headers=auth_headers)
        assert d.status_code == 200
        assert d.json()["action"] == "deleted"


# --------- Sales ---------
class TestSales:
    def test_sale_with_numbered_and_balance(self, auth_headers, test_customer, test_category):
        # add 2 cards
        nums = [f"8100{uuid.uuid4().int % 100000:05d}" for _ in range(2)]
        requests.post(f"{API}/cards/add-numbers",
                      json={"category_id": test_category["id"], "numbers": nums},
                      headers=auth_headers)
        payload = {
            "customer_id": test_customer["id"],
            "customer_name": test_customer["name"],
            "sale_type": "credit",
            "items": [{
                "category_id": test_category["id"],
                "category_name": test_category["name"],
                "quantity": 2, "price": 100,
                "card_numbers": nums, "use_numbered": True,
            }],
            "discount": 0, "paid": 0,
        }
        r = requests.post(f"{API}/sales", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        sale = r.json()
        assert sale["total"] == 200
        assert sale["number"].startswith("GWD")
        # verify cards sold
        c = requests.get(f"{API}/cards/search/{nums[0]}", headers=auth_headers).json()
        assert c["status"] == "sold"
        # verify customer balance increased
        cust = requests.get(f"{API}/customers", headers=auth_headers).json()
        found = next(x for x in cust if x["id"] == test_customer["id"])
        assert found["balance"] >= 200

    def test_credit_limit_rejection(self, auth_headers, test_category):
        # Create customer with tiny credit limit
        phone = f"7{uuid.uuid4().int % 10**8:08d}"
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_Limited", "phone": phone, "password": "p1234",
            "credit_limit": 50, "opening_balance": 0,
        }, headers=auth_headers).json()
        requests.post(f"{API}/cards/add-quantity",
                      json={"category_id": test_category["id"], "quantity": 10},
                      headers=auth_headers)
        r = requests.post(f"{API}/sales", json={
            "customer_id": cust["id"], "customer_name": cust["name"], "sale_type": "credit",
            "items": [{"category_id": test_category["id"], "category_name": test_category["name"],
                       "quantity": 5, "price": 100, "card_numbers": [], "use_numbered": False}],
        }, headers=auth_headers)
        assert r.status_code == 400
        assert "سقف" in r.text

    def test_idempotency(self, auth_headers, test_customer, test_category):
        key = str(uuid.uuid4())
        requests.post(f"{API}/cards/add-quantity",
                      json={"category_id": test_category["id"], "quantity": 10},
                      headers=auth_headers)
        payload = {
            "customer_id": test_customer["id"], "customer_name": test_customer["name"],
            "sale_type": "credit",
            "items": [{"category_id": test_category["id"], "category_name": test_category["name"],
                       "quantity": 1, "price": 100, "card_numbers": [], "use_numbered": False}],
            "idempotency_key": key,
        }
        r1 = requests.post(f"{API}/sales", json=payload, headers=auth_headers)
        r2 = requests.post(f"{API}/sales", json=payload, headers=auth_headers)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"]
        assert r1.json()["number"] == r2.json()["number"]


# --------- Public endpoints ---------
class TestPublic:
    def test_public_login_not_found_logs(self):
        phone = f"0000{uuid.uuid4().int % 10000:04d}"
        r = requests.post(f"{API}/public/card-order/login",
                          json={"phone": phone, "password": "x"})
        assert r.status_code == 404
        assert "لاتمتلك حساب بهذا الرقم" in r.text
        # verify log recorded (via admin)
        h = {"Authorization": f"Bearer {requests.post(f'{API}/auth/login', json={'username':'admin','password':'admin123'}).json()['token']}"}
        logs = requests.get(f"{API}/reports/card-order-log", headers=h).json()
        assert any(l.get("phone") == phone and l.get("status") == "rejected_not_found" for l in logs)

    def test_public_order_over_limit_logs(self, auth_headers, test_category):
        phone = f"7{uuid.uuid4().int % 10**8:08d}"
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_OverLimit", "phone": phone, "password": "p1234",
            "credit_limit": 50, "opening_balance": 0,
        }, headers=auth_headers).json()
        requests.post(f"{API}/cards/add-quantity",
                      json={"category_id": test_category["id"], "quantity": 20},
                      headers=auth_headers)
        r = requests.post(f"{API}/public/card-order/request", json={
            "phone": phone, "password": "p1234",
            "category_id": test_category["id"], "quantity": 5,
        })
        assert r.status_code == 400
        assert "عذراً، لا يمكن تنفيذ الطلب تم تجاوز السقف المسموح" in r.text
        logs = requests.get(f"{API}/reports/card-order-log", headers=auth_headers).json()
        assert any(l.get("phone") == phone and l.get("status") == "rejected_over_limit" for l in logs)

    def test_public_order_success(self, auth_headers, test_category):
        phone = f"7{uuid.uuid4().int % 10**8:08d}"
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_OrderOK", "phone": phone, "password": "p1234",
            "credit_limit": 100000, "opening_balance": 0,
        }, headers=auth_headers).json()
        requests.post(f"{API}/cards/add-quantity",
                      json={"category_id": test_category["id"], "quantity": 20},
                      headers=auth_headers)
        r = requests.post(f"{API}/public/card-order/request", json={
            "phone": phone, "password": "p1234",
            "category_id": test_category["id"], "quantity": 2,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["success"] is True
        assert d["total"] > 0
        # verify appears in electronic-sales report
        es = requests.get(f"{API}/reports/electronic-sales", headers=auth_headers).json()
        assert any(s.get("customer_id") == cust["id"] for s in es)

    def test_register_request(self):
        phone = f"7{uuid.uuid4().int % 10**8:08d}"
        r = requests.post(f"{API}/public/customer/register-request", json={
            "full_name": "طالب حساب تجريبي", "phone": phone, "address": "Sanaa",
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_forgot_password(self, test_customer):
        r = requests.post(f"{API}/public/customer/forgot-password",
                          json={"phone": test_customer["phone"]})
        assert r.status_code == 200
        d = r.json()
        assert d["name"] == test_customer["name"]
        assert d["phone"] == test_customer["phone"]

    def test_forgot_password_missing(self):
        r = requests.post(f"{API}/public/customer/forgot-password",
                          json={"phone": "0000000000"})
        assert r.status_code == 404
        assert "لاتمتلك حساب" in r.text

    def test_change_password_flow(self, auth_headers):
        phone = f"7{uuid.uuid4().int % 10**8:08d}"
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_ChgPwd", "phone": phone, "password": "old1", "credit_limit": 0,
        }, headers=auth_headers).json()
        # wrong current
        r = requests.post(f"{API}/public/customer/change-password", json={
            "phone": phone, "current_password": "wrong", "new_password": "new1",
        })
        assert r.status_code == 401
        # too short
        r = requests.post(f"{API}/public/customer/change-password", json={
            "phone": phone, "current_password": "old1", "new_password": "ab",
        })
        assert r.status_code == 400
        # success
        r = requests.post(f"{API}/public/customer/change-password", json={
            "phone": phone, "current_password": "old1", "new_password": "new12",
        })
        assert r.status_code == 200


# --------- Reports / Stock / Suppliers / Receipts / Audit ---------
class TestOther:
    def test_stock(self, auth_headers):
        r = requests.get(f"{API}/stock", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        if r.json():
            item = r.json()[0]
            assert "available_total" in item and "low_stock" in item
            assert "numbered" in item and "quantity" in item

    def test_suppliers_crud(self, auth_headers):
        r = requests.post(f"{API}/suppliers", json={
            "name": "TEST_Supplier_" + uuid.uuid4().hex[:5],
            "phone": "700000000", "credit_limit": 0, "opening_balance": 0,
        }, headers=auth_headers)
        assert r.status_code == 200
        sid = r.json()["id"]
        r2 = requests.get(f"{API}/suppliers", headers=auth_headers)
        assert any(s["id"] == sid for s in r2.json())
        r3 = requests.delete(f"{API}/suppliers/{sid}", headers=auth_headers)
        assert r3.status_code == 200

    def test_receipt_updates_ledger(self, auth_headers, test_customer):
        before = next(c for c in requests.get(f"{API}/customers", headers=auth_headers).json()
                      if c["id"] == test_customer["id"])
        b0 = before.get("balance", 0)
        r = requests.post(f"{API}/receipts", json={
            "kind": "receipt", "party_type": "customer",
            "party_id": test_customer["id"], "party_name": test_customer["name"],
            "amount": 50, "description": "test",
        }, headers=auth_headers)
        assert r.status_code == 200
        after = next(c for c in requests.get(f"{API}/customers", headers=auth_headers).json()
                     if c["id"] == test_customer["id"])
        assert after.get("balance", 0) == b0 - 50

    def test_audit(self, auth_headers):
        r = requests.get(f"{API}/audit", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_reports_electronic_sales(self, auth_headers):
        r = requests.get(f"{API}/reports/electronic-sales", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_reports_card_order_log(self, auth_headers):
        r = requests.get(f"{API}/reports/card-order-log", headers=auth_headers)
        assert r.status_code == 200
