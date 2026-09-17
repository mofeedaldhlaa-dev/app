import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://gwd-sales-hub.preview.emergentagent.com").rstrip("/")
EP = f"{BASE_URL}/api/public/customer/register-request"


def _unique_phone():
    # unique 10-digit phone
    return "9" + str(int(time.time() * 1000))[-9:]


def test_register_request_success():
    payload = {"full_name": "عميل اختبار TEST", "phone": _unique_phone(), "address": "صنعاء"}
    r = requests.post(EP, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True


def test_register_request_short_phone():
    r = requests.post(EP, json={"full_name": "عميل اختبار", "phone": "12345", "address": ""}, timeout=15)
    assert r.status_code == 400
    assert "رقم الهاتف غير صحيح" in r.text


def test_register_request_short_name():
    r = requests.post(EP, json={"full_name": "ا", "phone": _unique_phone(), "address": ""}, timeout=15)
    assert r.status_code == 400
    assert "الاسم غير صحيح" in r.text


def test_register_request_existing_phone():
    r = requests.post(EP, json={"full_name": "عميل موجود", "phone": "777777777", "address": ""}, timeout=15)
    assert r.status_code == 400
    assert "رقم الهاتف مرتبط بحساب عميل آخر" in r.text


def test_old_path_returns_404():
    r = requests.post(f"{BASE_URL}/api/public/customer/register", json={"full_name": "x", "phone": "1"}, timeout=15)
    assert r.status_code == 404
