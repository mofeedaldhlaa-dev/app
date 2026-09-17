from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import bcrypt
import jwt
import secrets
import string
import logging
import requests
import gzip
import json
import hmac
import re as _re
import ipaddress
import asyncio
import httpx
from html import escape as _html_escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any, Dict, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, status, UploadFile, File, Query, Header, BackgroundTasks
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field, ConfigDict

# ================= CONFIG =================
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@example.com')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
COMPANY_NAME = os.environ.get('COMPANY_NAME', 'شبكة جواد نت اللاسلكية')
COMPANY_PHONE = os.environ.get('COMPANY_PHONE', '784225716')

# ============ Object storage (Emergent integration) ============
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "jawad-net"

# ============ Email (Emergent managed Resend) ============
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", COMPANY_NAME)
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO") or None
PUBLIC_BASE_URL = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
WEBHOOK_CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")
_storage_key: Optional[str] = None

def init_storage(force: bool = False) -> Optional[str]:
    """Called once at startup and lazily on cache miss. Returns storage_key or None on failure."""
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    if not EMERGENT_KEY:
        return None
    try:
        resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        resp.raise_for_status()
        _storage_key = resp.json().get("storage_key")
        return _storage_key
    except Exception as e:
        logging.getLogger("jawad").error(f"Storage init failed: {e}")
        return None

def _put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key: raise HTTPException(status_code=503, detail="خدمة التخزين غير متوفرة")
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type},
                        data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type},
                            data=data, timeout=120)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"فشل الرفع: {resp.text[:120]}")
    return resp.json()

def _get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    if not key: raise HTTPException(status_code=503, detail="خدمة التخزين غير متوفرة")
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        # Try refresh once for stale key; if still 404, it's truly missing
        key2 = init_storage(force=True)
        if key2 and key2 != key:
            resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key2}, timeout=60)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail="الملف غير موجود")
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ============ Email guardrail gate (structural G2 + G3 defense-in-depth) ============
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = _re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", _re.I)

def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)

def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)

class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []
    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []
    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []

def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")

async def send_email(*, to: str, subject: str, html: str, reply_to: Optional[str] = None) -> Optional[str]:
    if not EMAIL_KEY:
        raise HTTPException(status_code=503, detail="خدمة البريد غير مهيأة")
    _assert_safe_email(subject, html)
    payload: Dict[str, Any] = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    rt = reply_to or EMAIL_REPLY_TO
    if rt:
        payload["contact_email"] = rt
    try:
        async with httpx.AsyncClient(timeout=30) as client_h:
            resp = await client_h.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logging.getLogger("jawad").error(f"Email send failed: {e.response.status_code} {e.response.text[:300]}")
        raise HTTPException(status_code=502, detail="فشل إرسال البريد")
    except Exception as e:
        logging.getLogger("jawad").error(f"Email send error: {e}")
        raise HTTPException(status_code=500, detail="فشل إرسال البريد")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Jawad Net ERP")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jawad")


# ================= HELPERS =================
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), hashed.encode())
    except Exception:
        return False

def create_token(user_id: str, username: str) -> str:
    payload = {"sub": user_id, "username": username, "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def random_password(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "JWD" + "".join(secrets.choice(alphabet) for _ in range(length - 3))

def clean_doc(doc: dict) -> dict:
    if not doc: return doc
    def _strip(v):
        if isinstance(v, dict):
            return {k: _strip(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_strip(x) for x in v]
        return v
    return _strip(dict(doc))

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="غير مصرح")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="المستخدم غير موجود")
        if user.get("status") == "disabled":
            raise HTTPException(status_code=403, detail="الحساب معطل")
        return clean_doc(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="انتهت صلاحية الجلسة")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="جلسة غير صالحة")

def require_perm(*perms: str):
    async def checker(user=Depends(get_current_user)):
        if user.get("role") == "admin":
            return user
        user_perms = set(user.get("permissions", []))
        if not any(p in user_perms for p in perms):
            raise HTTPException(status_code=403, detail="لا تملك الصلاحية")
        return user
    return checker

async def next_gwd_number() -> str:
    seq_doc = await db.settings.find_one_and_update(
        {"key": "gwd_sequence"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    val = seq_doc.get("value", 1)
    return f"GWD{val:04d}"

async def audit_log(user: dict, action: str, entity: str, entity_id: str = "", old: Any = None, new: Any = None):
    def _sanitize(v):
        if v is None: return None
        if isinstance(v, dict):
            return {k: _sanitize(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_sanitize(x) for x in v]
        try:
            import json
            json.dumps(v)
            return v
        except Exception:
            return str(v)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user.get("id"),
        "username": user.get("username"),
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "old_value": _sanitize(old),
        "new_value": _sanitize(new),
        "created_at": now_iso(),
    })

async def notify(title: str, message: str, ntype: str = "info", user_id: Optional[str] = None):
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "title": title,
        "message": message,
        "type": ntype,
        "user_id": user_id,
        "read": False,
        "created_at": now_iso(),
    })

# ================= MODELS =================
ALL_PERMS = [
    "dashboard","sales","purchases","customers","suppliers","stock","categories",
    "receipts","reports","print_reports","users","settings","card_orders",
    "delete_ops","edit_ops","cards","backup","expenses",
]

class LoginIn(BaseModel):
    username: str  # accepts username OR email address
    password: str
    device_id: Optional[str] = None

class UserIn(BaseModel):
    name: str
    username: str
    password: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str = "user"
    status: str = "active"
    permissions: List[str] = []

class SpecialPrice(BaseModel):
    category_id: str
    price: float

class CustomerIn(BaseModel):
    name: str
    phone: Optional[str] = ""
    password: Optional[str] = None
    credit_limit: float = 500
    opening_balance: float = 0
    address: Optional[str] = ""
    notes: Optional[str] = ""
    status: str = "active"
    customer_type: str = "customer"  # customer / pos
    special_prices_enabled: Optional[bool] = False
    special_prices: Optional[List[SpecialPrice]] = []
    incentives_visible: Optional[bool] = True
    opening_balance: float = 0

class SupplierIn(BaseModel):
    name: str
    phone: Optional[str] = ""
    credit_limit: float = 0
    opening_balance: float = 0
    address: Optional[str] = ""
    notes: Optional[str] = ""
    status: str = "active"

class CategoryIn(BaseModel):
    name: str
    value: float
    sale_price: float
    purchase_price: float
    validity_days: Optional[int] = 0
    data_size: Optional[str] = ""
    status: str = "active"
    notes: Optional[str] = ""
    low_stock_threshold: int = 20
    sale_price_customer: Optional[float] = None
    sale_price_pos: Optional[float] = None
    low_stock_numbered: Optional[int] = None
    low_stock_quantity: Optional[int] = None
    show_in_public: Optional[bool] = True

class CardsAddNumbersIn(BaseModel):
    category_id: str
    numbers: List[str]

class CardsAddQtyIn(BaseModel):
    category_id: str
    quantity: int

class SaleItemIn(BaseModel):
    category_id: str
    category_name: Optional[str] = ""
    quantity: int
    price: float
    card_numbers: List[str] = []  # if selling numbered cards
    use_numbered: bool = False

class PurchaseItemIn(BaseModel):
    category_id: str
    category_name: Optional[str] = ""
    quantity: int
    price: float
    card_numbers: List[str] = []
    use_numbered: bool = False

class SaleIn(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = ""
    sale_type: str = ""  # cash / credit - required
    items: List[SaleItemIn]
    discount: float = 0
    paid: float = 0
    notes: Optional[str] = ""
    idempotency_key: Optional[str] = None
    local_id: Optional[str] = None
    device_id: Optional[str] = None

class PurchaseIn(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = ""
    purchase_type: str = "credit"  # cash / credit
    items: List[SaleItemIn]
    discount: float = 0
    paid: float = 0
    notes: Optional[str] = ""
    idempotency_key: Optional[str] = None
    local_id: Optional[str] = None
    device_id: Optional[str] = None

class ReceiptIn(BaseModel):
    kind: str  # "receipt" (قبض) or "payment" (صرف)
    party_type: str  # customer / supplier
    party_id: str
    party_name: Optional[str] = ""
    amount: float
    description: Optional[str] = ""
    idempotency_key: Optional[str] = None

class ExpenseAccountIn(BaseModel):
    name: str
    notes: Optional[str] = ""

class ExpenseIn(BaseModel):
    account_id: str
    amount: float
    description: Optional[str] = ""
    date: Optional[str] = None  # YYYY-MM-DD; defaults to today
    idempotency_key: Optional[str] = None

class TransferIn(BaseModel):
    source_type: str  # customer / supplier / cash
    source_id: Optional[str] = None
    source_name: Optional[str] = ""
    dest_type: str    # customer / supplier / cash
    dest_id: Optional[str] = None
    dest_name: Optional[str] = ""
    amount: float
    description: Optional[str] = ""
    block_negative: bool = False
    date: Optional[str] = None
    idempotency_key: Optional[str] = None

class CardOrderPublicLogin(BaseModel):
    phone: str
    password: str
    device_id: Optional[str] = None

class CardOrderRequest(BaseModel):
    phone: str
    password: str
    category_id: str
    quantity: int = 1
    recipient_phone: Optional[str] = None  # optional: send the card to another number

class CardOrderHistoryIn(BaseModel):
    phone: str
    password: str
    start: Optional[str] = None  # YYYY-MM-DD
    end: Optional[str] = None    # YYYY-MM-DD

class SettingsIn(BaseModel):
    low_stock_default: Optional[int] = None
    currency: Optional[str] = None
    logo_url: Optional[str] = None
    backup_email: Optional[str] = None
    backup_time: Optional[str] = None
    backup_auto: Optional[bool] = None
    install_allowed_emails: Optional[List[str]] = None


# ================= AUTH =================
MAX_FAILED_ATTEMPTS = 5

# Unified over-credit-limit user message (shown in card orders and transfers).
OVER_LIMIT_MSG = (
    "عذراً رصيدك لا يسمح لتنفيذ العملية\n"
    "يمكنك إضافة رصيد إلى حسابك بسهولة من أقرب نقطة بيع. "
    "توجّه إلى أقرب بقالة أو نقطة بيع، وأعطِ موظف نقطة البيع رقم حسابك (رقم الهاتف) لتحويل رصيد إلى حسابك. مجاناً"
)

@api.post("/auth/login")
async def login(data: LoginIn):
    ident = (data.username or "").strip()
    incoming_device = (data.device_id or "").strip()
    # Accept username OR email. Email lookup is case-insensitive and tries
    # every matching user (admins first) so shared-email accounts still work.
    candidates: List[Dict[str, Any]] = []
    if "@" in ident:
        cursor = db.users.find({"email": {"$regex": f"^{_re.escape(ident)}$", "$options": "i"}})
        candidates = await cursor.to_list(20)
        candidates.sort(key=lambda u: (0 if u.get("role") == "admin" else 1, -(len(u.get("last_login") or ""))))
    if not candidates:
        one = await db.users.find_one({"username": ident})
        if one:
            candidates = [one]
    # If we found ANY user matching identifier, and they're locked, deny early
    for cand in candidates:
        if cand.get("locked_until") and cand["locked_until"] > now_iso():
            raise HTTPException(status_code=423, detail=f"تم حظر الحساب بسبب تجاوز {MAX_FAILED_ATTEMPTS} محاولات دخول فاشلة. الرجاء التواصل مع مدير النظام لفك الحظر.")
    user = None
    for cand in candidates:
        if verify_password(data.password, cand.get("password_hash", "")):
            user = cand
            break
    if not user:
        # Increment failed attempts on the FIRST matching candidate (or all if email)
        for cand in candidates:
            failed = (cand.get("failed_attempts") or 0) + 1
            update = {"failed_attempts": failed, "last_failed_at": now_iso()}
            if failed >= MAX_FAILED_ATTEMPTS:
                update["locked_until"] = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
                update["locked_at"] = now_iso()
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()), "title": "تم حظر حساب مستخدم",
                    "message": f"تم حظر حساب المستخدم {cand.get('username','')} بسبب تجاوز {MAX_FAILED_ATTEMPTS} محاولات دخول فاشلة.",
                    "type": "warning", "category": "user_lock", "read": False, "created_at": now_iso(),
                })
            await db.users.update_one({"id": cand["id"]}, {"$set": update})
        raise HTTPException(status_code=401, detail="بيانات الدخول غير صحيحة")
    if user.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")
    # Device binding: first successful login binds; later logins must match.
    # EXCEPTION: admin role is NEVER device-bound so a super-admin can always
    # log in from any device (owner recovery, fallback laptop, etc.).
    is_admin = user.get("role") == "admin"
    bound = user.get("bound_device")
    if not is_admin and bound and incoming_device and bound != incoming_device:
        raise HTTPException(
            status_code=403,
            detail="هذا الحساب مرتبط بجهاز آخر. يرجى استخدام الجهاز المرتبط أو التواصل مع مدير النظام لفك الربط.",
        )
    bind_update: Dict[str, Any] = {"last_login": now_iso(), "failed_attempts": 0, "locked_until": None}
    if not is_admin and not bound and incoming_device:
        bind_update["bound_device"] = incoming_device
        bind_update["bound_device_at"] = now_iso()
    await db.users.update_one({"id": user["id"]}, {"$set": bind_update})
    token = create_token(user["id"], user["username"])
    return {"token": token, "user": clean_doc({**user, "password_hash": None})}

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    user.pop("password_hash", None)
    return user

@api.post("/auth/logout")
async def logout(user=Depends(get_current_user)):
    return {"ok": True}


# ================= USERS =================
@api.get("/users")
async def list_users(user=Depends(require_perm("users"))):
    users = await db.users.find({}, {"password_hash": 0}).to_list(1000)
    return [clean_doc(u) for u in users]

@api.post("/users")
async def create_user(data: UserIn, user=Depends(require_perm("users"))):
    if not data.password:
        raise HTTPException(status_code=400, detail="كلمة المرور مطلوبة")
    existing = await db.users.find_one({"username": data.username})
    if existing:
        raise HTTPException(status_code=400, detail="اسم المستخدم موجود مسبقاً")
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["password_hash"] = hash_password(data.password)
    doc.pop("password", None)
    doc["created_at"] = now_iso()
    doc["last_login"] = None
    await db.users.insert_one(doc)
    await audit_log(user, "create", "user", doc["id"], None, {"username": data.username})
    doc.pop("password_hash", None)
    return clean_doc(doc)

@api.put("/users/{uid}")
async def update_user(uid: str, data: UserIn, user=Depends(require_perm("users"))):
    update = data.model_dump()
    if data.password:
        update["password_hash"] = hash_password(data.password)
    update.pop("password", None)
    await db.users.update_one({"id": uid}, {"$set": update})
    await audit_log(user, "update", "user", uid, None, {"username": data.username})
    doc = await db.users.find_one({"id": uid}, {"password_hash": 0})
    return clean_doc(doc)

@api.delete("/users/{uid}")
async def disable_user(uid: str, user=Depends(require_perm("users"))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="لا يمكن تعطيل حسابك")
    await db.users.update_one({"id": uid}, {"$set": {"status": "disabled"}})
    await audit_log(user, "disable", "user", uid)
    return {"ok": True}

@api.delete("/users/{uid}/permanent")
async def hard_delete_user(uid: str, user=Depends(require_perm("users"))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="لا يمكن حذف حسابك")
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    # Safety: don't leave the system without an active admin
    if target.get("role") == "admin":
        other_admins = await db.users.count_documents({
            "role": "admin", "status": "active", "id": {"$ne": uid}
        })
        if other_admins == 0:
            raise HTTPException(status_code=400, detail="لا يمكن حذف آخر مدير نشط. أنشئ حساب مدير آخر أولاً.")
    await db.users.delete_one({"id": uid})
    await audit_log(user, "hard_delete", "user", uid, {"username": target.get("username"), "role": target.get("role")})
    return {"ok": True}

@api.post("/users/{uid}/toggle-status")
async def toggle_user_status(uid: str, user=Depends(require_perm("users"))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="لا يمكن تعطيل حسابك")
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    new_status = "disabled" if target.get("status") == "active" else "active"
    await db.users.update_one({"id": uid}, {"$set": {"status": new_status}})
    await audit_log(user, f"set_status:{new_status}", "user", uid)
    return {"ok": True, "status": new_status}

@api.get("/users/permissions/list")
async def perms_list(user=Depends(get_current_user)):
    return ALL_PERMS


# ================= CUSTOMERS =================
@api.get("/customers")
async def list_customers(user=Depends(require_perm("customers"))):
    items = await db.customers.find().to_list(5000)
    return [clean_doc(c) for c in items]

@api.post("/customers")
async def create_customer(data: CustomerIn, user=Depends(require_perm("customers"))):
    if (data.phone or "").strip():
        exists = await db.customers.find_one({"phone": data.phone.strip()}, {"_id": 1})
        if exists:
            raise HTTPException(status_code=400, detail="رقم الهاتف مرتبط بحساب عميل آخر.")
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["password"] = data.password or random_password()
    doc["balance"] = data.opening_balance or 0
    doc["created_at"] = now_iso()
    doc["created_by"] = user.get("username")
    await db.customers.insert_one(doc)
    # Opening balance ledger entry
    if doc["balance"] != 0:
        await db.ledger.insert_one({
            "id": str(uuid.uuid4()), "party_type": "customer", "party_id": doc["id"],
            "op_number": "", "description": "رصيد افتتاحي",
            "debit": doc["balance"] if doc["balance"] > 0 else 0,
            "credit": abs(doc["balance"]) if doc["balance"] < 0 else 0,
            "balance": doc["balance"], "created_at": now_iso(),
        })
    await audit_log(user, "create", "customer", doc["id"], None, {"name": data.name})
    return clean_doc(doc)

@api.put("/customers/{cid}")
async def update_customer(cid: str, data: CustomerIn, user=Depends(require_perm("customers"))):
    if (data.phone or "").strip():
        clash = await db.customers.find_one(
            {"phone": data.phone.strip(), "id": {"$ne": cid}}, {"_id": 1}
        )
        if clash:
            raise HTTPException(status_code=400, detail="رقم الهاتف مرتبط بحساب عميل آخر.")
    update = data.model_dump()
    if not data.password:
        update.pop("password", None)
    await db.customers.update_one({"id": cid}, {"$set": update})
    await audit_log(user, "update", "customer", cid)
    doc = await db.customers.find_one({"id": cid})
    return clean_doc(doc)

@api.delete("/customers/{cid}")
async def delete_customer(cid: str, user=Depends(require_perm("delete_ops"))):
    """Hard-delete a customer safely.
    Refuses if the customer has any financial history (sales/receipts/ledger).
    Cleans the opening-balance ledger entry then removes the customer document."""
    doc = await db.customers.find_one({"id": cid})
    if not doc:
        raise HTTPException(status_code=404, detail="العميل غير موجود")
    sales_count = await db.sales.count_documents({"customer_id": cid})
    recs_count = await db.receipts.count_documents({"party_type": "customer", "party_id": cid})
    ledger_count = await db.ledger.count_documents({"party_type": "customer", "party_id": cid, "description": {"$ne": "رصيد افتتاحي"}})
    orders_count = await db.orders.count_documents({"customer_id": cid})
    if sales_count or recs_count or ledger_count or orders_count or float(doc.get("balance", 0) or 0) != 0:
        raise HTTPException(
            status_code=400,
            detail="لا يمكن حذف هذا العميل لوجود عمليات مالية مرتبطة (فواتير/سندات/رصيد). يمكنك تعطيل الحساب بدلاً من الحذف."
        )
    await db.ledger.delete_many({"party_type": "customer", "party_id": cid})
    await db.customers.delete_one({"id": cid})
    await audit_log(user, f"حذف العميل: {doc.get('name','')}", "customer", cid, {"name": doc.get("name"), "phone": doc.get("phone")}, None)
    return {"ok": True}

@api.post("/customers/{cid}/toggle-status")
async def toggle_customer_status(cid: str, user=Depends(require_perm("customers"))):
    target = await db.customers.find_one({"id": cid})
    if not target:
        raise HTTPException(status_code=404, detail="العميل غير موجود")
    new_status = "disabled" if target.get("status") == "active" else "active"
    await db.customers.update_one({"id": cid}, {"$set": {"status": new_status}})
    await audit_log(user, f"set_status:{new_status}", "customer", cid)
    return {"ok": True, "status": new_status}

@api.get("/customers/{cid}/statement")
async def customer_statement(cid: str, user=Depends(require_perm("customers"))):
    customer = await db.customers.find_one({"id": cid})
    if not customer:
        raise HTTPException(status_code=404, detail="غير موجود")
    entries = await db.ledger.find({"party_type": "customer", "party_id": cid}).sort("created_at", 1).to_list(10000)
    return {"customer": clean_doc(customer), "entries": [clean_doc(e) for e in entries]}


# ================= BANK ACCOUNTS =================
class BankAccountIn(BaseModel):
    bank_name: str
    holder_name: str
    account_number: str
    details: Optional[str] = ""
    active: Optional[bool] = True
    show_in: Optional[List[str]] = []  # ["invoices","receipts","payment_requests","over_limit"]

@api.get("/bank-accounts")
async def list_bank_accounts(show_in: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if show_in:
        q["show_in"] = show_in
        q["active"] = True
    items = await db.bank_accounts.find(q).sort("created_at", 1).to_list(500)
    return [clean_doc(b) for b in items]

@api.post("/bank-accounts")
async def create_bank_account(data: BankAccountIn, user=Depends(require_perm("settings"))):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.bank_accounts.insert_one(doc)
    await audit_log(user, f"إنشاء حساب بنكي: {data.bank_name}", "bank_account", doc["id"])
    return clean_doc(doc)

@api.put("/bank-accounts/{bid}")
async def update_bank_account(bid: str, data: BankAccountIn, user=Depends(require_perm("settings"))):
    r = await db.bank_accounts.update_one({"id": bid}, {"$set": data.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="غير موجود")
    await audit_log(user, f"تعديل حساب بنكي: {data.bank_name}", "bank_account", bid)
    doc = await db.bank_accounts.find_one({"id": bid})
    return clean_doc(doc)

@api.delete("/bank-accounts/{bid}")
async def delete_bank_account(bid: str, user=Depends(require_perm("settings"))):
    doc = await db.bank_accounts.find_one({"id": bid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    await db.bank_accounts.delete_one({"id": bid})
    await audit_log(user, f"حذف حساب بنكي: {doc.get('bank_name','')}", "bank_account", bid)
    return {"ok": True}


# ================= SUPPLIERS =================
@api.get("/suppliers")
async def list_suppliers(user=Depends(require_perm("suppliers"))):
    items = await db.suppliers.find().to_list(5000)
    return [clean_doc(s) for s in items]

@api.post("/suppliers")
async def create_supplier(data: SupplierIn, user=Depends(require_perm("suppliers"))):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["balance"] = data.opening_balance or 0
    doc["created_at"] = now_iso()
    await db.suppliers.insert_one(doc)
    if doc["balance"] != 0:
        await db.ledger.insert_one({
            "id": str(uuid.uuid4()), "party_type": "supplier", "party_id": doc["id"],
            "op_number": "", "description": "رصيد افتتاحي",
            "debit": doc["balance"] if doc["balance"] > 0 else 0,
            "credit": abs(doc["balance"]) if doc["balance"] < 0 else 0,
            "balance": doc["balance"], "created_at": now_iso(),
        })
    await audit_log(user, "create", "supplier", doc["id"])
    return clean_doc(doc)

@api.put("/suppliers/{sid}")
async def update_supplier(sid: str, data: SupplierIn, user=Depends(require_perm("suppliers"))):
    await db.suppliers.update_one({"id": sid}, {"$set": data.model_dump()})
    doc = await db.suppliers.find_one({"id": sid})
    return clean_doc(doc)

@api.delete("/suppliers/{sid}")
async def delete_supplier(sid: str, user=Depends(require_perm("delete_ops"))):
    """Hard-delete a supplier safely.
    Refuses if the supplier has any financial history (purchases/receipts/ledger)."""
    doc = await db.suppliers.find_one({"id": sid})
    if not doc:
        raise HTTPException(status_code=404, detail="المورد غير موجود")
    purch_count = await db.purchases.count_documents({"supplier_id": sid})
    recs_count = await db.receipts.count_documents({"party_type": "supplier", "party_id": sid})
    ledger_count = await db.ledger.count_documents({"party_type": "supplier", "party_id": sid, "description": {"$ne": "رصيد افتتاحي"}})
    if purch_count or recs_count or ledger_count or float(doc.get("balance", 0) or 0) != 0:
        raise HTTPException(
            status_code=400,
            detail="لا يمكن حذف هذا المورد لوجود عمليات مالية مرتبطة (فواتير/سندات/رصيد). يمكنك تعطيل الحساب بدلاً من الحذف."
        )
    await db.ledger.delete_many({"party_type": "supplier", "party_id": sid})
    await db.suppliers.delete_one({"id": sid})
    await audit_log(user, f"حذف المورد: {doc.get('name','')}", "supplier", sid, {"name": doc.get("name"), "phone": doc.get("phone")}, None)
    return {"ok": True}

@api.get("/suppliers/{sid}/statement")
async def supplier_statement(sid: str, user=Depends(require_perm("suppliers"))):
    supplier = await db.suppliers.find_one({"id": sid})
    if not supplier:
        raise HTTPException(status_code=404, detail="غير موجود")
    entries = await db.ledger.find({"party_type": "supplier", "party_id": sid}).sort("created_at", 1).to_list(10000)
    return {"supplier": clean_doc(supplier), "entries": [clean_doc(e) for e in entries]}


# ================= CATEGORIES =================
@api.get("/categories")
async def list_categories(user=Depends(get_current_user)):
    items = await db.card_categories.find().to_list(500)
    return [clean_doc(c) for c in items]

@api.post("/categories")
async def create_category(data: CategoryIn, user=Depends(require_perm("categories"))):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.card_categories.insert_one(doc)
    return clean_doc(doc)

@api.put("/categories/{cid}")
async def update_category(cid: str, data: CategoryIn, user=Depends(require_perm("categories"))):
    await db.card_categories.update_one({"id": cid}, {"$set": data.model_dump()})
    doc = await db.card_categories.find_one({"id": cid})
    return clean_doc(doc)

@api.delete("/categories/{cid}")
async def delete_category(cid: str, user=Depends(require_perm("categories"))):
    # FK safety: check usage
    cards_count = await db.cards.count_documents({"category_id": cid})
    stock_doc = await db.stock.find_one({"category_id": cid})
    sales_use = await db.sales.count_documents({"items.category_id": cid})
    if cards_count > 0 or (stock_doc and stock_doc.get("total", 0) > 0) or sales_use > 0:
        # Soft-disable
        await db.card_categories.update_one({"id": cid}, {"$set": {"status": "disabled"}})
        await audit_log(user, "disable", "category", cid)
        return {"ok": True, "action": "disabled", "reason": "الفئة مرتبطة ببيانات سابقة، تم تعطيلها بدلاً من الحذف"}
    await db.card_categories.delete_one({"id": cid})
    await audit_log(user, "delete", "category", cid)
    return {"ok": True, "action": "deleted"}

@api.post("/categories/{cid}/toggle-public")
async def toggle_category_public(cid: str, user=Depends(require_perm("categories"))):
    """Flip 'show_in_public' (visibility in the public card-order screen) without
    altering any other category data. Hiding does NOT delete or disable the category."""
    cat = await db.card_categories.find_one({"id": cid})
    if not cat:
        raise HTTPException(status_code=404, detail="الفئة غير موجودة")
    new_val = not bool(cat.get("show_in_public", True))
    await db.card_categories.update_one({"id": cid}, {"$set": {"show_in_public": new_val}})
    await audit_log(user, "toggle_public", "category", cid, {"show_in_public": new_val})
    return {"ok": True, "show_in_public": new_val}


# ================= CARDS =================
@api.get("/cards")
async def list_cards(status_filter: Optional[str] = None, category_id: Optional[str] = None, q: Optional[str] = None, user=Depends(require_perm("cards","stock"))):
    query: Dict[str, Any] = {}
    if status_filter: query["status"] = status_filter
    if category_id: query["category_id"] = category_id
    if q: query["number"] = {"$regex": q, "$options": "i"}
    items = await db.cards.find(query).limit(2000).to_list(2000)
    return [clean_doc(c) for c in items]

@api.post("/cards/add-numbers")
async def add_cards_numbers(data: CardsAddNumbersIn, user=Depends(require_perm("cards"))):
    cat = await db.card_categories.find_one({"id": data.category_id})
    if not cat:
        raise HTTPException(status_code=404, detail="الفئة غير موجودة")
    # normalize
    seen = set()
    valid = []
    duplicates = []
    invalid = []
    for raw in data.numbers:
        n = (raw or "").strip()
        if not n: continue
        if not n.replace("-", "").replace(" ", "").isdigit() or len(n) < 4:
            invalid.append(n); continue
        if n in seen:
            duplicates.append(n); continue
        seen.add(n)
        # check DB
        exists = await db.cards.find_one({"number": n})
        if exists:
            duplicates.append(n); continue
        valid.append(n)
    docs = []
    op_ts = now_iso()
    for n in valid:
        docs.append({
            "id": str(uuid.uuid4()),
            "number": n,
            "category_id": data.category_id,
            "category_name": cat.get("name"),
            "status": "available",
            "type": "numbered",
            "created_at": op_ts,
            "created_by": user.get("username"),
        })
    if docs:
        await db.cards.insert_many(docs)
        await db.stock_ops.insert_one({
            "id": str(uuid.uuid4()),
            "category_id": data.category_id,
            "category_name": cat.get("name"),
            "kind": "add_numbered",
            "quantity": len(docs),
            "description": f"إضافة {len(docs)} كرت مرقم بدون فاتورة مشتريات",
            "user_id": user.get("id"),
            "username": user.get("username"),
            "created_at": op_ts,
        })
    await audit_log(user, "add_cards", "cards", data.category_id, None, {"added": len(docs)})
    return {"added": len(docs), "duplicates": duplicates, "invalid": invalid}

@api.post("/cards/add-quantity")
async def add_cards_qty(data: CardsAddQtyIn, user=Depends(require_perm("cards"))):
    cat = await db.card_categories.find_one({"id": data.category_id})
    if not cat:
        raise HTTPException(status_code=404, detail="الفئة غير موجودة")
    doc = await db.stock.find_one({"category_id": data.category_id})
    if doc:
        await db.stock.update_one({"category_id": data.category_id}, {"$inc": {"total": data.quantity}})
    else:
        await db.stock.insert_one({
            "id": str(uuid.uuid4()),
            "category_id": data.category_id,
            "category_name": cat.get("name"),
            "total": data.quantity,
            "sold": 0,
            "used": 0,
            "created_at": now_iso(),
        })
    await db.stock_ops.insert_one({
        "id": str(uuid.uuid4()),
        "category_id": data.category_id,
        "category_name": cat.get("name"),
        "kind": "add_quantity",
        "quantity": int(data.quantity),
        "description": f"إضافة {data.quantity} كرت (كمية) بدون فاتورة مشتريات",
        "user_id": user.get("id"),
        "username": user.get("username"),
        "created_at": now_iso(),
    })
    return {"ok": True, "added": data.quantity}

@api.get("/cards/search/{number}")
async def find_card(number: str, user=Depends(require_perm("cards"))):
    card = await db.cards.find_one({"number": number})
    if not card:
        raise HTTPException(status_code=404, detail="الكرت غير موجود")
    return clean_doc(card)

@api.put("/cards/{card_id}/status")
async def update_card_status(card_id: str, new_status: str, user=Depends(require_perm("cards"))):
    await db.cards.update_one({"id": card_id}, {"$set": {"status": new_status}})
    return {"ok": True}

class CardEditIn(BaseModel):
    number: Optional[str] = None
    category_id: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

@api.put("/cards/{card_id}")
async def edit_card(card_id: str, data: CardEditIn, user=Depends(require_perm("cards"))):
    card = await db.cards.find_one({"id": card_id})
    if not card:
        raise HTTPException(status_code=404, detail="غير موجود")
    if card.get("status") in ("sold", "used") and (data.number or data.category_id):
        raise HTTPException(status_code=400, detail="لا يمكن تعديل رقم/فئة كرت مباع")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if data.number and data.number != card.get("number"):
        exists = await db.cards.find_one({"number": data.number, "id": {"$ne": card_id}})
        if exists:
            raise HTTPException(status_code=400, detail="رقم الكرت مكرر")
    if data.category_id:
        cat = await db.card_categories.find_one({"id": data.category_id})
        if cat: update["category_name"] = cat.get("name")
    await db.cards.update_one({"id": card_id}, {"$set": update})
    await audit_log(user, "update", "card", card_id, card, update)
    return {"ok": True}

@api.delete("/cards/{card_id}")
async def delete_card(card_id: str, user=Depends(require_perm("cards"))):
    card = await db.cards.find_one({"id": card_id})
    if not card:
        raise HTTPException(status_code=404, detail="غير موجود")
    if card.get("status") == "sold":
        await db.cards.update_one({"id": card_id}, {"$set": {"status": "cancelled"}})
        await audit_log(user, "cancel", "card", card_id)
        return {"ok": True, "action": "cancelled"}
    await db.cards.delete_one({"id": card_id})
    await audit_log(user, "delete", "card", card_id)
    return {"ok": True, "action": "deleted"}


# Change customer password (admin)
class PasswordIn(BaseModel):
    password: str

@api.post("/customers/{cid}/password")
async def admin_set_customer_password(cid: str, data: PasswordIn, user=Depends(require_perm("customers"))):
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="كلمة المرور قصيرة جداً")
    cust = await db.customers.find_one({"id": cid})
    if not cust:
        raise HTTPException(status_code=404, detail="غير موجود")
    await db.customers.update_one({"id": cid}, {"$set": {"password": data.password}})
    await audit_log(user, "reset_customer_password", "customer", cid, None, {"name": cust.get("name","")})
    # WhatsApp URL for admin to click and notify the customer
    from urllib.parse import quote
    wa_phone = "".join(ch for ch in (cust.get("phone") or "") if ch.isdigit()).lstrip("0")
    if wa_phone and not wa_phone.startswith("967"):
        wa_phone = "967" + wa_phone
    body = (
        f"مرحباً {cust.get('name','')} 👋\n\n"
        f"تم تعديل كلمة المرور الخاصة بحسابك في شبكة جواد نت اللاسلكية.\n\n"
        f"📱 رقم الهاتف: {cust.get('phone','')}\n"
        f"🔑 كلمة المرور الجديدة: {data.password}\n\n"
        f"يرجى تسجيل الدخول باستخدام البيانات الجديدة.\n"
        f"إذا لم تطلب هذا التعديل تواصل معنا فوراً."
    )
    wa_url = f"https://wa.me/{wa_phone}?text={quote(body)}" if wa_phone else ""
    return {"ok": True, "whatsapp_url": wa_url}


# Customer self-service password change
class CustomerChangePwd(BaseModel):
    phone: str
    current_password: str
    new_password: str

@api.post("/public/customer/change-password")
async def customer_change_password(data: CustomerChangePwd):
    if len(data.new_password) < 4:
        raise HTTPException(status_code=400, detail="كلمة المرور الجديدة قصيرة جداً (4 أحرف على الأقل)")
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم، عليك بانشاء حساب أولاً")
    if customer.get("password") != data.current_password:
        raise HTTPException(status_code=401, detail="كلمة المرور الحالية غير صحيحة")
    await db.customers.update_one({"id": customer["id"]}, {"$set": {"password": data.new_password}})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": customer["id"], "username": customer["name"],
        "action": "self_change_password", "entity": "customer", "entity_id": customer["id"],
        "created_at": now_iso(),
    })
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "title": "تغيير كلمة المرور",
        "message": f"قام العميل {customer.get('name','')} بتغيير كلمة المرور الخاصة به. الهاتف: {customer.get('phone','')}",
        "type": "info", "read": False, "created_at": now_iso(),
    })
    return {"ok": True}


# Forgot password - lookup and return WhatsApp payload
class ForgotIn(BaseModel):
    phone: str

@api.post("/public/customer/forgot-password")
async def customer_forgot(data: ForgotIn):
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم، عليك بانشاء حساب أولاً")
    return {
        "name": customer.get("name"), "phone": customer.get("phone"),
        "address": customer.get("address", ""),
    }


# Public account registration request - only creates a pending request record
class RegisterRequest(BaseModel):
    full_name: str
    phone: str
    address: str

@api.post("/public/customer/register-request")
async def register_request(data: RegisterRequest):
    name = (data.full_name or "").strip()
    phone = (data.phone or "").strip()
    address = (data.address or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="الاسم الرباعي مطلوب (3 أحرف على الأقل)")
    if len(name.split()) < 2:
        raise HTTPException(status_code=400, detail="الرجاء إدخال الاسم الرباعي كاملاً")
    if not phone or len(phone) < 7 or not phone.replace("+","").isdigit():
        raise HTTPException(status_code=400, detail="رقم الهاتف غير صحيح")
    if len(address) < 2:
        raise HTTPException(status_code=400, detail="العنوان مطلوب")
    existing = await db.customers.find_one({"phone": phone}, {"_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="رقم الهاتف مرتبط بحساب عميل آخر.")
    doc = {
        "id": str(uuid.uuid4()), "full_name": name, "phone": phone,
        "address": address, "status": "pending", "created_at": now_iso(),
    }
    await db.register_requests.insert_one(doc)
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "title": "طلب حساب جديد",
        "message": f"{name} ({phone}) — {address} — يطلب إنشاء حساب",
        "type": "info", "category": "account_request", "ref_id": doc["id"],
        "read": False, "created_at": now_iso(),
    })
    return {"ok": True}


# Card order attempts log
@api.get("/reports/card-order-log")
async def card_order_log(user=Depends(require_perm("reports"))):
    items = await db.card_order_attempts.find().sort("created_at", -1).limit(2000).to_list(2000)
    return [clean_doc(a) for a in items]

# Electronic sales report (public order source)
@api.get("/reports/electronic-sales")
async def electronic_sales(user=Depends(require_perm("reports"))):
    items = await db.sales.find({"source": "public_order", "status": "active"}).sort("created_at", -1).limit(2000).to_list(2000)
    return [clean_doc(s) for s in items]


# ================= STOCK =================
@api.get("/stock")
async def stock_report(start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_perm("stock"))):
    cats = await db.card_categories.find().to_list(500)
    start_iso = f"{start}T00:00:00+03:00" if start else None
    end_iso = f"{end}T23:59:59+03:00" if end else None
    period_active = bool(start_iso or end_iso)
    def _rng():
        r: Dict[str, Any] = {}
        if start_iso: r["$gte"] = start_iso
        if end_iso: r["$lte"] = end_iso
        return r
    def _in_range(ts):
        if not ts: return False
        if start_iso and ts < start_iso: return False
        if end_iso and ts > end_iso: return False
        return True
    # Preload sales in period once for quantity-sold movement (non-numbered items).
    sales_in_period = []
    if period_active:
        sales_in_period = await db.sales.find({"status": "active", "created_at": _rng()}).to_list(20000)
    result = []
    for cat in cats:
        cat = clean_doc(cat)
        # numbered cards
        avail = await db.cards.count_documents({"category_id": cat["id"], "status": "available"})
        sold = await db.cards.count_documents({"category_id": cat["id"], "status": "sold"})
        used = await db.cards.count_documents({"category_id": cat["id"], "status": "used"})
        total_num = await db.cards.count_documents({"category_id": cat["id"]})
        # qty stock
        qs = await db.stock.find_one({"category_id": cat["id"]})
        qty_total = (qs or {}).get("total", 0)
        qty_sold = (qs or {}).get("sold", 0)
        threshold = cat.get("low_stock_threshold", 20)
        available_total = avail + max(0, qty_total - qty_sold)
        entry = {
            "category_id": cat["id"],
            "category_name": cat["name"],
            "sale_price": cat.get("sale_price", 0),
            "numbered": {"total": total_num, "available": avail, "sold": sold, "used": used},
            "quantity": {"total": qty_total, "sold": qty_sold, "available": max(0, qty_total - qty_sold)},
            "available_total": available_total,
            "low_stock": available_total <= threshold,
            "threshold": threshold,
        }
        if period_active:
            added_numbered = await db.cards.count_documents({"category_id": cat["id"], "created_at": _rng()})
            sold_numbered = await db.cards.count_documents({"category_id": cat["id"], "status": {"$in": ["sold", "used"]}, "sold_at": _rng()})
            qadd_ops = await db.stock_ops.find({"category_id": cat["id"], "kind": {"$in": ["add_quantity"]}}).to_list(5000)
            qty_added = sum(o.get("quantity", 0) for o in qadd_ops if _in_range(o.get("created_at")))
            qty_sold_period = 0
            for s in sales_in_period:
                for it in (s.get("items") or []):
                    if it.get("category_id") == cat["id"] and not it.get("use_numbered"):
                        qty_sold_period += it.get("quantity", 0)
            entry["period"] = {
                "added": added_numbered + qty_added,
                "sold": sold_numbered + qty_sold_period,
                "added_numbered": added_numbered,
                "sold_numbered": sold_numbered,
                "added_quantity": qty_added,
                "sold_quantity": qty_sold_period,
            }
        result.append(entry)
    return result


# ================= SALES =================
async def _adjust_party_balance(party_type: str, party_id: str, amount: float, op_number: str, description: str):
    """Positive amount = increase debt to us (sale). Negative = decrease debt (receipt)."""
    collection = db.customers if party_type == "customer" else db.suppliers
    updated = await collection.find_one_and_update(
        {"id": party_id},
        {"$inc": {"balance": float(amount)}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        return None
    new_balance = float(updated.get("balance", 0) or 0)
    await db.ledger.insert_one({
        "id": str(uuid.uuid4()),
        "party_type": party_type, "party_id": party_id,
        "op_number": op_number, "description": description,
        "debit": amount if amount > 0 else 0,
        "credit": abs(amount) if amount < 0 else 0,
        "balance": new_balance,
        "created_at": now_iso(),
    })
    return new_balance


async def _remove_ledger_by_op(party_type: str, party_id: str, op_number: str):
    """Delete ALL ledger entries linked to an operation (used on edit/delete).
    Keeps the statement clean of 'تعديل/حذف/عكس' entries. Returns the net delta removed
    so the caller can update the party balance accordingly."""
    if not op_number: return 0.0
    entries = await db.ledger.find({"party_type": party_type, "party_id": party_id, "op_number": op_number}).to_list(500)
    delta = sum(float(e.get("debit", 0) or 0) - float(e.get("credit", 0) or 0) for e in entries)
    if entries:
        await db.ledger.delete_many({"party_type": party_type, "party_id": party_id, "op_number": op_number})
    collection = db.customers if party_type == "customer" else db.suppliers
    if delta:
        await collection.update_one({"id": party_id}, {"$inc": {"balance": -delta}})
    return delta


async def _validate_sale_inventory(items: list, old_items: Optional[list] = None):
    """Validate the complete sale before mutating stock; old items are treated as releasable on edit."""
    old_items = old_items or []
    old_numbered = set()
    old_numbered_by_cat: Dict[str, int] = {}
    old_qty_by_cat: Dict[str, int] = {}
    for item in old_items:
        cat_id = item.get("category_id")
        numbers = set(item.get("card_numbers") or [])
        old_numbered.update(numbers)
        old_numbered_by_cat[cat_id] = old_numbered_by_cat.get(cat_id, 0) + len(numbers)
        residual = max(int(item.get("quantity", 0) or 0) - len(numbers), 0)
        old_qty_by_cat[cat_id] = old_qty_by_cat.get(cat_id, 0) + residual

    reserved_numbers = set()
    reserved_by_cat: Dict[str, int] = {}
    quantity_by_cat: Dict[str, int] = {}
    for item in items:
        if item.use_numbered and item.card_numbers:
            for number in item.card_numbers:
                if number in reserved_numbers:
                    raise HTTPException(status_code=400, detail=f"الكرت {number} مكرر في الفاتورة")
                card = await db.cards.find_one({"number": number})
                if not card or (card.get("status") != "available" and number not in old_numbered):
                    raise HTTPException(status_code=400, detail=f"الكرت {number} غير متوفر")
                reserved_numbers.add(number)
                cat_id = card.get("category_id") or item.category_id
                reserved_by_cat[cat_id] = reserved_by_cat.get(cat_id, 0) + 1
        else:
            quantity_by_cat[item.category_id] = quantity_by_cat.get(item.category_id, 0) + int(item.quantity)

    for cat_id, required in quantity_by_cat.items():
        stock = await db.stock.find_one({"category_id": cat_id})
        quantity_available = max((stock or {}).get("total", 0) - (stock or {}).get("sold", 0), 0)
        quantity_available += old_qty_by_cat.get(cat_id, 0)
        numbered_available = await db.cards.count_documents({"category_id": cat_id, "status": "available"})
        numbered_available += old_numbered_by_cat.get(cat_id, 0)
        numbered_available -= reserved_by_cat.get(cat_id, 0)
        if quantity_available + max(numbered_available, 0) < required:
            raise HTTPException(status_code=400, detail="الكمية غير متوفرة للفئة")


# ================= WALLET TRANSFERS (public) =================
class TransferLookupIn(BaseModel):
    phone: str
    password: str
    recipient_phone: str
    amount: float

class TransferConfirmIn(TransferLookupIn):
    idempotency_key: str

def _transfer_commission(sender: dict, amount: float) -> float:
    """POS accounts pay 10% commission on top of the transfer amount (deducted from their side).
    Regular customers pay 0%."""
    if (sender or {}).get("customer_type") == "pos":
        return round(float(amount) * 0.10, 2)
    return 0.0

@api.post("/public/card-order/transfer/lookup")
async def public_transfer_lookup(data: TransferLookupIn):
    sender = await _verify_public_customer(data.phone, data.password)
    if data.amount <= 0: raise HTTPException(status_code=400, detail="المبلغ غير صحيح")
    recipient = await db.customers.find_one({"phone": data.recipient_phone})
    if not recipient: raise HTTPException(status_code=404, detail="الحساب غير موجود")
    if recipient.get("id") == sender.get("id"): raise HTTPException(status_code=400, detail="لا يمكن التحويل لنفس الحساب")
    commission = _transfer_commission(sender, data.amount)
    total_debit = data.amount + commission if commission > 0 else data.amount
    # For POS-sender flow: deducted from sender = amount - commission (per requirement: 1000 send, 100 comm, deduct 900)
    if (sender or {}).get("customer_type") == "pos":
        total_debit = data.amount - commission
    # Credit-limit check
    limit = float(sender.get("credit_limit") or 0)
    new_balance = float(sender.get("balance") or 0) + total_debit
    if limit > 0 and new_balance > limit:
        raise HTTPException(status_code=400, detail=OVER_LIMIT_MSG)
    return {
        "sender_id": sender["id"], "sender_type": sender.get("customer_type", "customer"),
        "recipient_id": recipient["id"], "recipient_name": recipient.get("name",""),
        "recipient_phone": recipient.get("phone",""), "recipient_type": recipient.get("customer_type","customer"),
        "amount": float(data.amount), "commission": commission,
        "sender_debit": total_debit, "recipient_credit": float(data.amount),
    }

@api.post("/public/card-order/transfer/confirm")
async def public_transfer_confirm(data: TransferConfirmIn):
    if not data.idempotency_key: raise HTTPException(status_code=400, detail="مفتاح الحماية مطلوب")
    existing = await db.transfers.find_one({"idempotency_key": data.idempotency_key})
    if existing: return clean_doc(existing)
    sender = await _verify_public_customer(data.phone, data.password)
    recipient = await db.customers.find_one({"phone": data.recipient_phone})
    if not recipient: raise HTTPException(status_code=404, detail="الحساب غير موجود")
    if recipient.get("id") == sender.get("id"): raise HTTPException(status_code=400, detail="لا يمكن التحويل لنفس الحساب")
    if data.amount <= 0: raise HTTPException(status_code=400, detail="المبلغ غير صحيح")
    commission = _transfer_commission(sender, data.amount)
    sender_debit = (data.amount - commission) if sender.get("customer_type") == "pos" else (data.amount + commission)
    # Credit-limit final check
    limit = float(sender.get("credit_limit") or 0)
    if limit > 0 and float(sender.get("balance") or 0) + sender_debit > limit:
        raise HTTPException(status_code=400, detail=OVER_LIMIT_MSG)
    number = await next_gwd_number()
    doc = {
        "id": str(uuid.uuid4()), "number": number, "idempotency_key": data.idempotency_key,
        "sender_id": sender["id"], "sender_name": sender.get("name",""), "sender_phone": sender.get("phone",""),
        "sender_type": sender.get("customer_type", "customer"),
        "recipient_id": recipient["id"], "recipient_name": recipient.get("name",""),
        "recipient_phone": recipient.get("phone",""),
        "amount": float(data.amount), "commission": commission, "sender_debit": sender_debit,
        "status": "done", "created_at": now_iso(),
    }
    # 1) debit sender
    await _adjust_party_balance("customer", sender["id"], sender_debit, number, f"تحويل رصيد إلى {recipient.get('name','')} ({recipient.get('phone','')})")
    # 2) credit recipient (full amount)
    await _adjust_party_balance("customer", recipient["id"], -float(data.amount), number, f"استلام تحويل من {sender.get('name','')} ({sender.get('phone','')})")
    await db.transfers.insert_one(doc)
    # 3) notify recipient
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "title": "استلام تحويل رصيد",
        "message": f"تم استلام {float(data.amount):,.0f} من {sender.get('name','')} — عملية {number}.",
        "type": "success", "read": False, "created_at": now_iso(),
        "customer_id": recipient["id"], "kind": "transfer",
    })
    return clean_doc(doc)


# ================= ADMIN QUICK RECHARGE (from company cash — no commission) =================
class AdminQuickTransferIn(BaseModel):
    recipient_phone: str
    amount: float
    idempotency_key: Optional[str] = None

@api.post("/admin/quick-recharge/lookup")
async def admin_quick_recharge_lookup(data: AdminQuickTransferIn, user=Depends(require_perm("receipts"))):
    if data.amount <= 0: raise HTTPException(status_code=400, detail="المبلغ غير صحيح")
    recipient = await db.customers.find_one({"phone": data.recipient_phone})
    if not recipient: raise HTTPException(status_code=404, detail="حساب المستلم غير موجود")
    return {
        "sender_name": "شبكة جواد نت اللاسلكية",
        "source": "cash",
        "recipient_id": recipient["id"], "recipient_name": recipient.get("name",""),
        "recipient_phone": recipient.get("phone",""), "recipient_type": recipient.get("customer_type","customer"),
        "recipient_balance": float(recipient.get("balance") or 0),
        "amount": float(data.amount), "commission": 0.0,
        "cash_debit": float(data.amount), "recipient_credit": float(data.amount),
    }

@api.post("/admin/quick-recharge/confirm")
async def admin_quick_recharge_confirm(data: AdminQuickTransferIn, user=Depends(require_perm("receipts"))):
    if not data.idempotency_key: raise HTTPException(status_code=400, detail="مفتاح الحماية مطلوب")
    existing = await db.receipts.find_one({"idempotency_key": data.idempotency_key})
    if existing: return clean_doc(existing)
    if data.amount <= 0: raise HTTPException(status_code=400, detail="المبلغ غير صحيح")
    recipient = await db.customers.find_one({"phone": data.recipient_phone})
    if not recipient: raise HTTPException(status_code=404, detail="حساب المستلم غير موجود")
    number = await next_gwd_number()
    desc = "شحن سريع من شبكة جواد نت اللاسلكية"
    # Behave exactly like a receipt (سند قبض): credit customer + cash goes UP (income).
    balance_after = await _adjust_party_balance(
        "customer", recipient["id"], -float(data.amount), number, desc
    )
    doc = {
        "id": str(uuid.uuid4()), "number": number, "idempotency_key": data.idempotency_key,
        "type": "receipt_voucher", "kind": "receipt",
        "party_type": "customer", "party_id": recipient["id"], "party_name": recipient.get("name", ""),
        "amount": float(data.amount), "description": desc,
        "user_id": user["id"], "username": user.get("username"),
        "status": "active",
        "balance_after": balance_after,
        "channel": "admin_quick_recharge",
        "created_at": now_iso(),
    }
    await db.receipts.insert_one(doc)
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "title": "استلام شحن",
        "message": f"تم استلام {float(data.amount):,.0f} من شبكة جواد نت اللاسلكية — عملية {number}.",
        "type": "success", "read": False, "created_at": now_iso(),
        "customer_id": recipient["id"], "kind": "quick_recharge",
    })
    await audit_log(user, "create", "quick_recharge", doc["id"], None, {"amount": data.amount, "recipient": recipient.get("phone")})
    return clean_doc(doc)


# ================= NOTIFICATIONS (admin broadcast + customer read) =================
class BroadcastIn(BaseModel):
    title: str
    message: str
    recipients: Optional[List[str]] = None  # customer ids; None or [] = all customers

@api.post("/notifications/broadcast")
async def broadcast_notification(data: BroadcastIn, user=Depends(require_perm("settings"))):
    if not data.title or not data.message: raise HTTPException(status_code=400, detail="العنوان والنص إلزاميان")
    if data.recipients:
        ids = data.recipients
    else:
        customers = await db.customers.find({"status": {"$ne": "disabled"}}, {"id": 1}).to_list(10000)
        ids = [c["id"] for c in customers]
    now = now_iso()
    group_id = str(uuid.uuid4())
    docs = [{
        "id": str(uuid.uuid4()), "group_id": group_id,
        "title": data.title, "message": data.message,
        "type": "info", "read": False, "created_at": now,
        "customer_id": cid, "kind": "admin_broadcast",
        "sender_username": user.get("username"),
    } for cid in ids]
    if docs: await db.notifications.insert_many(docs)
    return {"ok": True, "count": len(docs), "group_id": group_id}

@api.get("/notifications/broadcast-log")
async def broadcast_log(user=Depends(require_perm("settings"))):
    rows = await db.notifications.aggregate([
        {"$match": {"kind": "admin_broadcast"}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$group_id", "title": {"$first": "$title"}, "message": {"$first": "$message"},
                    "created_at": {"$first": "$created_at"}, "sender_username": {"$first": "$sender_username"},
                    "count": {"$sum": 1}, "read_count": {"$sum": {"$cond": ["$read", 1, 0]}}}},
        {"$sort": {"created_at": -1}}, {"$limit": 200}
    ]).to_list(200)
    return rows

class PublicNotifIn(BaseModel):
    phone: str
    password: str

@api.post("/public/card-order/notifications")
async def public_notifications(data: PublicNotifIn):
    c = await _verify_public_customer(data.phone, data.password)
    items = await db.notifications.find({"customer_id": c["id"]}).sort("created_at", -1).limit(200).to_list(200)
    unread = await db.notifications.count_documents({"customer_id": c["id"], "read": False})
    return {"items": [clean_doc(x) for x in items], "unread": unread}

class PublicNotifReadIn(PublicNotifIn):
    notif_id: str

@api.post("/public/card-order/notifications/mark-read")
async def public_notif_mark_read(data: PublicNotifReadIn):
    c = await _verify_public_customer(data.phone, data.password)
    await db.notifications.update_one({"id": data.notif_id, "customer_id": c["id"]}, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True}


# ================= INCENTIVES =================
async def _get_incentive_settings():
    doc = await db.settings.find_one({"_key": "incentives"}) or {}
    return {
        "customer_enabled": bool(doc.get("customer_enabled", False)),
        "pos_enabled": bool(doc.get("pos_enabled", False)),
        "exclude_special_price": bool(doc.get("exclude_special_price", False)),
    }

async def _apply_incentive_on_sale(sale_doc: dict, customer: Optional[dict]):
    """Deprecated: pending earnings are now computed dynamically from cumulative sales.
    Kept as a no-op to avoid changing the create_sale call site."""
    return

async def _sum_bought_by_category(customer_id: str) -> Dict[str, int]:
    """Sum quantity per category from all active sales of this customer."""
    pipeline = [
        {"$match": {"customer_id": customer_id, "status": {"$ne": "cancelled"}}},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.category_id", "qty": {"$sum": "$items.quantity"}}}
    ]
    out: Dict[str, int] = {}
    async for row in db.sales.aggregate(pipeline):
        out[row["_id"]] = int(row.get("qty") or 0)
    return out

async def _customer_incentive_summary(customer: dict) -> Dict[str, Any]:
    """Cumulative per-category incentive state for one customer.
    Returns categories with rule + bought + earned + redeemed + pending + status text."""
    settings = await _get_incentive_settings()
    ctype = customer.get("customer_type", "customer")
    enabled = settings["pos_enabled"] if ctype == "pos" else settings["customer_enabled"]
    if settings.get("exclude_special_price") and customer.get("special_prices_enabled"):
        enabled = False
    if customer.get("incentives_visible") is False:
        enabled = False
    rules = await db.incentive_rules.find({"account_type": ctype, "active": True}).to_list(500)
    if not enabled or not rules:
        return {"enabled": bool(enabled), "categories": [], "history": []}
    bought_map = await _sum_bought_by_category(customer["id"])
    result = []
    # Cumulative buys minus baseline (baseline set on each incentive card-redemption)
    baseline_map: Dict[str, int] = {}
    for b in (customer.get("incentive_baseline") or []):
        cid_key = b.get("category_id"); qval = int(b.get("bought_at_redeem") or 0)
        if cid_key: baseline_map[cid_key] = qval
    for r in rules:
        cid = r.get("category_id"); buy = int(r.get("buy_qty") or 0); reward = int(r.get("reward_qty") or 0)
        if not cid or buy <= 0 or reward <= 0: continue
        cat = await db.card_categories.find_one({"id": cid}) or {}
        raw_bought = int(bought_map.get(cid, 0))
        baseline = int(baseline_map.get(cid, 0))
        bought = max(0, raw_bought - baseline)
        # earnings from THIS cycle only
        total_earned_ever = (bought // buy) * reward
        red_docs = await db.incentive_earnings.find({
            "customer_id": customer["id"], "category_id": cid,
            "status": {"$in": ["redeemed_card", "redeemed_credit"]},
            "cycle_start_bought": {"$gte": baseline},
        }).to_list(1000)
        redeemed_qty = sum(int(x.get("qty") or 0) for x in red_docs)
        pending_qty = max(0, total_earned_ever - redeemed_qty)
        used_towards_earned = (total_earned_ever // reward) * buy if reward else 0
        remaining_for_next = max(0, buy - (bought - used_towards_earned))
        if pending_qty > 0:
            status_text = f"حافز مستحق ({pending_qty} كرت)" + (f" — متبقي {remaining_for_next} للحافز القادم" if remaining_for_next < buy else "")
        elif bought == 0:
            status_text = f"لم يبدأ الشراء من هذه الفئة"
        else:
            status_text = f"تبقى {remaining_for_next} كرت للحصول على الحافز"
        result.append({
            "rule_id": r.get("id"),
            "category_id": cid,
            "category_name": cat.get("name", ""),
            "unit_value": cat.get("sale_price_customer") or cat.get("sale_price", 0),
            "bought": bought,
            "buy_qty": buy,
            "reward_qty": reward,
            "earned_total": total_earned_ever,
            "redeemed": redeemed_qty,
            "pending_qty": pending_qty,
            "remaining_for_next": remaining_for_next,
            "status_text": status_text,
        })
    # history (redeemed only)
    history = await db.incentive_earnings.find({
        "customer_id": customer["id"],
        "status": {"$in": ["redeemed_card", "redeemed_credit"]}
    }).sort("redeemed_at", -1).limit(200).to_list(200)
    return {"enabled": True, "categories": result, "history": [clean_doc(h) for h in history]}


class PublicAuth(BaseModel):
    phone: str
    password: str

class IncentiveRedeemIn(PublicAuth):
    mode: str  # "card" | "credit"
    category_id: Optional[str] = None
    qty: Optional[int] = None  # partial redeem; defaults to all pending

async def _verify_public_customer(phone: str, password: str):
    c = await db.customers.find_one({"phone": phone})
    if not c or c.get("password") != password:
        raise HTTPException(status_code=401, detail="بيانات غير صحيحة")
    if c.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")
    return c

async def _redeem_incentive(customer: dict, category_id: str, mode: str, qty_req: Optional[int], acting_user: Optional[dict]):
    summary = await _customer_incentive_summary(customer)
    row = next((x for x in summary["categories"] if x["category_id"] == category_id), None)
    if not row or row["pending_qty"] <= 0:
        raise HTTPException(status_code=400, detail="لا يوجد حافز مستحق لهذه الفئة")
    qty = int(qty_req or row["pending_qty"])
    if qty <= 0 or qty > row["pending_qty"]:
        raise HTTPException(status_code=400, detail="الكمية المطلوبة غير صحيحة")
    now = now_iso()
    rec_id = str(uuid.uuid4())
    base_rec = {
        "id": rec_id,
        "customer_id": customer["id"],
        "customer_name": customer.get("name", ""),
        "customer_type": customer.get("customer_type", "customer"),
        "category_id": category_id,
        "category_name": row["category_name"],
        "unit_value": row["unit_value"],
        "qty": qty,
        "buy_qty": row["buy_qty"],
        "reward_qty": row["reward_qty"],
        "created_at": now,
        "redeemed_at": now,
        "redeemed_by": (acting_user or {}).get("username", "public"),
    }
    base_rec["cycle_start_bought"] = 0  # not used for credit
    if mode == "credit":
        value = float(row["unit_value"] or 0) * qty
        await _adjust_party_balance("customer", customer["id"], -value, f"INC-{rec_id[:8]}", f"حافز {row['category_name']} × {qty}")
        base_rec.update({"status": "redeemed_credit", "redeemed_value": value})
        await db.incentive_earnings.insert_one(base_rec)
        return {"ok": True, "mode": "credit", "value": value}
    # cards
    avail_num = await db.cards.count_documents({"category_id": category_id, "status": "available"})
    stock = await db.stock.find_one({"category_id": category_id})
    avail_qty = (stock or {}).get("total", 0) - (stock or {}).get("sold", 0) if stock else 0
    if avail_num + avail_qty < qty:
        raise HTTPException(status_code=400, detail="لا يوجد رصيد كافٍ من الكروت لتسليم الحافز")
    take_num = min(qty, avail_num)
    cards_delivered = []
    if take_num > 0:
        picks = await db.cards.find({"category_id": category_id, "status": "available"}).limit(take_num).to_list(take_num)
        ids = [x["id"] for x in picks]
        cards_delivered = [x["number"] for x in picks]
        await db.cards.update_many({"id": {"$in": ids}}, {"$set": {"status": "sold", "sold_at": now, "sold_to": customer["id"]}})
    take_qty = qty - take_num
    if take_qty > 0:
        await db.stock.update_one({"category_id": category_id}, {"$inc": {"sold": take_qty}})
    base_rec.update({"status": "redeemed_card", "cards": cards_delivered})
    await db.incentive_earnings.insert_one(base_rec)
    # Reset baseline for this category so the display counter starts from 0
    raw = await _sum_bought_by_category(customer["id"])
    new_baseline = int(raw.get(category_id, 0))
    existing = [b for b in (customer.get("incentive_baseline") or []) if b.get("category_id") != category_id]
    existing.append({"category_id": category_id, "bought_at_redeem": new_baseline, "reset_at": now})
    await db.customers.update_one({"id": customer["id"]}, {"$set": {"incentive_baseline": existing}})
    # Create a notification the customer can see
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "title": "استلام حافز",
        "message": f"تم استلام {qty} كرت من فئة {row['category_name']} كحافز.",
        "type": "success", "read": False, "created_at": now,
        "customer_id": customer["id"], "kind": "incentive",
    })
    return {"ok": True, "mode": "card", "cards": cards_delivered, "qty": qty}


@api.get("/customers/{cid}/incentives")
async def admin_customer_incentives(cid: str, user=Depends(require_perm("customers"))):
    c = await db.customers.find_one({"id": cid})
    if not c: raise HTTPException(status_code=404, detail="غير موجود")
    return await _customer_incentive_summary(c)

@api.post("/customers/{cid}/incentives/redeem")
async def admin_redeem_customer_incentive(cid: str, category_id: str, mode: str, qty: Optional[int] = None, user=Depends(require_perm("sales"))):
    c = await db.customers.find_one({"id": cid})
    if not c: raise HTTPException(status_code=404, detail="غير موجود")
    if mode not in ("card","credit"): raise HTTPException(status_code=400, detail="نوع الصرف غير صالح")
    return await _redeem_incentive(c, category_id, mode, qty, user)

@api.post("/public/card-order/incentives")
async def public_list_incentives(data: PublicAuth):
    c = await _verify_public_customer(data.phone, data.password)
    return await _customer_incentive_summary(c)

@api.post("/public/card-order/incentives/redeem")
async def public_redeem_incentive(data: IncentiveRedeemIn):
    if not data.category_id or data.mode not in ("card","credit"):
        raise HTTPException(status_code=400, detail="بيانات غير صحيحة")
    c = await _verify_public_customer(data.phone, data.password)
    return await _redeem_incentive(c, data.category_id, data.mode, data.qty, None)

# Public banks (safe subset for card-order screen)
@api.get("/public/card-order/banks")
async def public_banks(show_in: str = "over_limit"):
    if show_in not in ("invoices","receipts","payment_requests","over_limit"):
        raise HTTPException(status_code=400, detail="مكان غير صالح")
    items = await db.bank_accounts.find({"active": True, "show_in": show_in}).sort("created_at", 1).to_list(50)
    return [{
        "id": b.get("id"),
        "bank_name": b.get("bank_name"),
        "holder_name": b.get("holder_name"),
        "account_number": b.get("account_number"),
        "details": b.get("details") or "",
    } for b in items]


class IncentiveRuleIn(BaseModel):
    account_type: str  # customer / pos
    category_id: str
    buy_qty: int
    reward_qty: int
    active: Optional[bool] = True

class IncentiveSettingsIn(BaseModel):
    customer_enabled: Optional[bool] = False
    pos_enabled: Optional[bool] = False
    exclude_special_price: Optional[bool] = False

@api.get("/incentive-settings")
async def get_incentive_settings(user=Depends(get_current_user)):
    return await _get_incentive_settings()

@api.put("/incentive-settings")
async def set_incentive_settings(data: IncentiveSettingsIn, user=Depends(require_perm("settings"))):
    payload = data.model_dump()
    payload["_key"] = "incentives"
    await db.settings.update_one({"_key": "incentives"}, {"$set": payload}, upsert=True)
    return await _get_incentive_settings()

@api.get("/incentive-rules")
async def list_incentive_rules(user=Depends(get_current_user)):
    items = await db.incentive_rules.find().sort("created_at", -1).to_list(500)
    return [clean_doc(r) for r in items]

@api.post("/incentive-rules")
async def create_incentive_rule(data: IncentiveRuleIn, user=Depends(require_perm("settings"))):
    if data.account_type not in ("customer", "pos"):
        raise HTTPException(status_code=400, detail="نوع الحساب غير صالح")
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.incentive_rules.insert_one(doc)
    return clean_doc(doc)

@api.put("/incentive-rules/{rid}")
async def update_incentive_rule(rid: str, data: IncentiveRuleIn, user=Depends(require_perm("settings"))):
    r = await db.incentive_rules.update_one({"id": rid}, {"$set": data.model_dump()})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="غير موجود")
    doc = await db.incentive_rules.find_one({"id": rid})
    return clean_doc(doc)

@api.delete("/incentive-rules/{rid}")
async def delete_incentive_rule(rid: str, user=Depends(require_perm("settings"))):
    await db.incentive_rules.delete_one({"id": rid})
    return {"ok": True}


@api.get("/reports/incentives")
async def incentive_report(start: Optional[str] = None, end: Optional[str] = None,
                            customer_id: Optional[str] = None, category_id: Optional[str] = None,
                            status_filter: Optional[str] = None, kind: Optional[str] = "redeemed",
                            user=Depends(require_perm("reports"))):
    """kind = redeemed | pending"""
    if kind == "pending":
        customers = await db.customers.find({"status": {"$ne": "disabled"}}).to_list(5000)
        if customer_id:
            customers = [c for c in customers if c.get("id") == customer_id]
        rows = []
        total_qty = 0
        total_value = 0.0
        for c in customers:
            summary = await _customer_incentive_summary(c)
            for row in summary.get("categories", []):
                if row.get("pending_qty", 0) <= 0: continue
                if category_id and row.get("category_id") != category_id: continue
                rec = {
                    "id": f"{c.get('id')}::{row.get('category_id')}",
                    "customer_id": c.get("id"),
                    "customer_name": c.get("name", ""),
                    "customer_type": c.get("customer_type", "customer"),
                    "category_id": row.get("category_id"),
                    "category_name": row.get("category_name"),
                    "qty": row.get("pending_qty"),
                    "bought": row.get("bought"),
                    "buy_qty": row.get("buy_qty"),
                    "reward_qty": row.get("reward_qty"),
                    "unit_value": row.get("unit_value"),
                    "redeemed_value": float(row.get("unit_value") or 0) * int(row.get("pending_qty") or 0),
                    "status": "pending",
                    "status_text": row.get("status_text"),
                    "redeemed_by": None,
                    "redeemed_at": None,
                }
                rows.append(rec)
                total_qty += int(row.get("pending_qty") or 0)
                total_value += rec["redeemed_value"]
        return {"items": rows, "total_qty": total_qty, "total_value": total_value, "count": len(rows), "kind": "pending"}

    q: Dict[str, Any] = {"status": {"$in": ["redeemed_card", "redeemed_credit"]}}
    if customer_id: q["customer_id"] = customer_id
    if category_id: q["category_id"] = category_id
    if status_filter: q["status"] = status_filter
    if start or end:
        rng: Dict[str, Any] = {}
        if start: rng["$gte"] = f"{start}T00:00:00+03:00"
        if end: rng["$lte"] = f"{end}T23:59:59+03:00"
        q["redeemed_at"] = rng
    items = await db.incentive_earnings.find(q).sort("redeemed_at", -1).limit(5000).to_list(5000)
    total_qty = sum(int(x.get("qty") or 0) for x in items)
    total_value = sum(float(x.get("redeemed_value") or (x.get("unit_value") or 0) * (x.get("qty") or 0)) for x in items)
    return {"items": [clean_doc(x) for x in items], "total_qty": total_qty, "total_value": total_value, "count": len(items), "kind": "redeemed"}


@api.post("/sales")
async def create_sale(data: SaleIn, user=Depends(require_perm("sales"))):
    # Idempotency
    if data.idempotency_key:
        existing = await db.sales.find_one({"idempotency_key": data.idempotency_key})
        if existing:
            return clean_doc(existing)
    # Mandatory validations
    if not data.customer_id:
        raise HTTPException(status_code=400, detail="يرجى اختيار العميل قبل حفظ الفاتورة.")
    if data.sale_type not in ("cash", "credit"):
        raise HTTPException(status_code=400, detail="يرجى اختيار نوع الفاتورة: نقد أو آجل.")

    # Compute totals & validate stock
    subtotal = 0.0
    items_final = []
    for item in data.items:
        line_total = item.quantity * item.price
        subtotal += line_total
        items_final.append({**item.model_dump(), "total": line_total})

    total = subtotal - (data.discount or 0)
    paid = total if data.sale_type == "cash" else min(max(float(data.paid or 0), 0), total)
    remaining = 0.0 if data.sale_type == "cash" else max(total - paid, 0)

    # Customer limit check
    customer = None
    if data.customer_id:
        customer = await db.customers.find_one({"id": data.customer_id})

    # Auto-pricing based on customer_type if price not set explicitly per item.
    # Precedence: customer.special_prices (if enabled) > cat.sale_price_pos/customer > cat.sale_price.
    if customer:
        ctype = customer.get("customer_type", "customer")
        sp_enabled = bool(customer.get("special_prices_enabled"))
        sp_map = { (sp.get("category_id")): float(sp.get("price") or 0)
                   for sp in (customer.get("special_prices") or [])
                   if sp.get("category_id") and sp.get("price") is not None }
        for i, item in enumerate(data.items):
            if item.price <= 0:
                p = None
                if sp_enabled and item.category_id in sp_map:
                    p = sp_map[item.category_id]
                if p is None:
                    cat = await db.card_categories.find_one({"id": item.category_id})
                    if cat:
                        p = cat.get("sale_price_pos") if ctype == "pos" else cat.get("sale_price_customer")
                        if p is None: p = cat.get("sale_price", 0)
                if p is not None:
                    items_final[i]["price"] = p
                    items_final[i]["total"] = items_final[i]["quantity"] * p

    subtotal = sum(float(item.get("total", 0) or 0) for item in items_final)
    total = subtotal - (data.discount or 0)
    paid = total if data.sale_type == "cash" else min(max(float(data.paid or 0), 0), total)
    remaining = 0.0 if data.sale_type == "cash" else max(total - paid, 0)
    if customer and data.sale_type == "credit" and remaining > 0:
        limit = customer.get("credit_limit", 0)
        new_balance = float(customer.get("balance", 0) or 0) + remaining
        if limit > 0 and new_balance > limit:
            raise HTTPException(status_code=400, detail=f"لا يمكن تنفيذ العملية لأنها تتجاوز سقف حساب العميل ({limit})")

    await _validate_sale_inventory(data.items)

    # Reserve/mark cards (numbered) and quantity stock
    for item in data.items:
        if item.use_numbered and item.card_numbers:
            # Ensure all requested cards are available
            for n in item.card_numbers:
                card = await db.cards.find_one({"number": n, "status": "available"})
                if not card:
                    raise HTTPException(status_code=400, detail=f"الكرت {n} غير متوفر")
            # Mark all as sold
            await db.cards.update_many(
                {"number": {"$in": item.card_numbers}, "status": "available"},
                {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": data.customer_id}},
            )
        else:
            # quantity stock decrement
            stock = await db.stock.find_one({"category_id": item.category_id})
            avail = (stock or {}).get("total", 0) - (stock or {}).get("sold", 0) if stock else 0
            # try to also decrement numbered available if requested via qty but no numbers
            numbered_avail = await db.cards.count_documents({"category_id": item.category_id, "status": "available"})
            if avail + numbered_avail < item.quantity:
                raise HTTPException(status_code=400, detail=f"الكمية غير متوفرة للفئة")
            take_from_qty = min(item.quantity, avail)
            if take_from_qty > 0:
                await db.stock.update_one({"category_id": item.category_id}, {"$inc": {"sold": take_from_qty}})
            take_from_numbered = item.quantity - take_from_qty
            if take_from_numbered > 0:
                pending = await db.cards.find({"category_id": item.category_id, "status": "available"}).limit(take_from_numbered).to_list(take_from_numbered)
                ids = [c["id"] for c in pending]
                await db.cards.update_many({"id": {"$in": ids}}, {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": data.customer_id}})

    number = await next_gwd_number()
    doc = {
        "id": str(uuid.uuid4()),
        "number": number,
        "type": "sale",
        "customer_id": data.customer_id,
        "customer_name": data.customer_name,
        "sale_type": data.sale_type,
        "items": items_final,
        "subtotal": subtotal,
        "discount": data.discount or 0,
        "total": total,
        "paid": paid,
        "remaining": remaining,
        "notes": data.notes,
        "user_id": user["id"],
        "username": user.get("username"),
        "status": "active",
        "idempotency_key": data.idempotency_key,
        "local_id": data.local_id,
        "device_id": data.device_id,
        "created_at": now_iso(),
    }
    await db.sales.insert_one(doc)

    # Incentive earnings (customer/pos) — best-effort, never blocks the sale
    try:
        await _apply_incentive_on_sale(doc, customer)
    except Exception as _e:
        logger.warning(f"incentive apply failed: {_e}")

    balance_after = float((customer or {}).get("balance", 0) or 0) if customer else None
    if data.sale_type == "credit" and data.customer_id and remaining > 0:
        balance_after = await _adjust_party_balance("customer", data.customer_id, remaining, number, f"فاتورة مبيعات {number}")

    await audit_log(user, "create", "sale", doc["id"], None, {"number": number, "total": total})
    await notify(f"فاتورة {number}", f"تم إنشاء فاتورة مبيعات بإجمالي {total}", "info")

    return clean_doc({**doc, "balance_after": balance_after})


@api.get("/sales")
async def list_sales(q: Optional[str] = None, user=Depends(require_perm("sales"))):
    query: Dict[str, Any] = {}
    if q: query["number"] = {"$regex": q, "$options": "i"}
    items = await db.sales.find(query).sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(s) for s in items]

@api.get("/sales/{sid}")
async def get_sale(sid: str, user=Depends(require_perm("sales"))):
    doc = await db.sales.find_one({"$or": [{"id": sid}, {"number": sid}]})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    return clean_doc(doc)

@api.post("/sales/{sid}/cancel")
async def cancel_sale(sid: str, user=Depends(require_perm("delete_ops"))):
    doc = await db.sales.find_one({"id": sid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") == "cancelled":
        return clean_doc(doc)
    await db.sales.update_one({"id": sid}, {"$set": {"status": "cancelled", "cancelled_at": now_iso()}})
    # reverse balance
    if doc.get("customer_id") and doc.get("remaining", 0) > 0:
        await _adjust_party_balance("customer", doc["customer_id"], -doc["remaining"], doc["number"], f"إلغاء فاتورة {doc['number']}")
    await audit_log(user, "cancel", "sale", sid)
    return {"ok": True}

@api.delete("/sales/{sid}")
async def delete_sale(sid: str, user=Depends(require_perm("delete_ops"))):
    """Hard-delete a sale: remove original ledger entry (keeps statement clean),
    reverse inventory, then remove the document."""
    doc = await db.sales.find_one({"id": sid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") != "cancelled":
        if doc.get("customer_id") and doc.get("number"):
            await _remove_ledger_by_op("customer", doc["customer_id"], doc["number"])
        await _reverse_sale_inventory(doc.get("items", []))
        # Drop any pending incentive earnings from this sale (redeemed ones are kept)
        try:
            await db.incentive_earnings.delete_many({"source_sale_id": sid, "status": "pending"})
        except Exception:
            pass
    await db.sales.delete_one({"id": sid})
    await audit_log(user, f"حذف فاتورة مبيعات {doc.get('number','')}", "sale", sid, {"number": doc.get("number"), "total": doc.get("total")}, None)
    return {"ok": True}

@api.delete("/purchases/{pid}")
async def delete_purchase(pid: str, user=Depends(require_perm("delete_ops"))):
    doc = await db.purchases.find_one({"id": pid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") != "cancelled":
        if doc.get("supplier_id") and doc.get("number"):
            await _remove_ledger_by_op("supplier", doc["supplier_id"], doc["number"])
        for it in doc.get("items", []) or []:
            cards = it.get("card_numbers") or []
            if cards:
                await db.cards.delete_many({"number": {"$in": cards}, "category_id": it.get("category_id")})
            elif it.get("quantity"):
                await db.stock.update_one({"category_id": it["category_id"]}, {"$inc": {"total": -it["quantity"]}})
    await db.purchases.delete_one({"id": pid})
    await audit_log(user, f"حذف فاتورة مشتريات {doc.get('number','')}", "purchase", pid, {"number": doc.get("number"), "total": doc.get("total")}, None)
    return {"ok": True}

@api.delete("/receipts/{rid}")
async def delete_receipt(rid: str, user=Depends(require_perm("delete_ops"))):
    doc = await db.receipts.find_one({"id": rid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") != "cancelled":
        pty = doc.get("party_type"); pid = doc.get("party_id")
        if pty in ("customer","supplier") and pid and doc.get("number"):
            await _remove_ledger_by_op(pty, pid, doc["number"])
    kind_ar = "قبض" if doc.get("kind") == "receipt" else "صرف"
    await db.receipts.delete_one({"id": rid})
    await audit_log(user, f"حذف سند {kind_ar} {doc.get('number','')}", "receipt", rid, {"number": doc.get("number"), "amount": doc.get("amount"), "kind": doc.get("kind")}, None)
    return {"ok": True}


class SaleEditIn(BaseModel):
    # legacy quick edit (still supported for partial updates)
    discount: Optional[float] = None
    paid: Optional[float] = None
    notes: Optional[str] = None
    # full edit (optional). When provided we reverse the old inventory/balance
    # effect and re-apply the new one atomically.
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    sale_type: Optional[str] = None
    items: Optional[List[SaleItemIn]] = None


async def _reverse_sale_inventory(items: list):
    for it in items or []:
        cards = it.get("card_numbers") or []
        if cards:
            await db.cards.update_many(
                {"number": {"$in": cards}},
                {"$set": {"status": "available", "sold_at": None, "sold_to": None}},
            )
        residual = int(it.get("quantity", 0)) - len(cards)
        if residual > 0:
            await db.stock.update_one(
                {"category_id": it.get("category_id")},
                {"$inc": {"sold": -residual}},
            )


@api.put("/sales/{sid}")
async def edit_sale(sid: str, data: SaleEditIn, user=Depends(require_perm("edit_ops"))):
    doc = await db.sales.find_one({"id": sid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") != "active":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل فاتورة ملغاة")

    # --------- FULL EDIT PATH (items provided) ---------
    if data.items is not None:
        new_customer_id = data.customer_id or doc.get("customer_id")
        new_sale_type = data.sale_type or doc.get("sale_type", "credit")
        if new_sale_type not in ("cash", "credit"):
            raise HTTPException(status_code=400, detail="نوع الفاتورة غير صحيح")
        await _validate_sale_inventory(data.items, doc.get("items") or [])
        # 1) remove OLD ledger entries + revert balance (keeps statement clean of reversal noise)
        await _reverse_sale_inventory(doc.get("items") or [])
        if doc.get("customer_id") and doc.get("number"):
            await _remove_ledger_by_op("customer", doc["customer_id"], doc["number"])
        # 2) compute new totals
        subtotal = 0.0
        items_final = []
        for it in data.items:
            line_total = it.quantity * it.price
            subtotal += line_total
            items_final.append({**it.model_dump(), "total": line_total})
        new_discount = float(data.discount if data.discount is not None else doc.get("discount", 0) or 0)
        requested_paid = float(data.paid if data.paid is not None else doc.get("paid", 0) or 0)
        new_total = subtotal - new_discount
        new_paid = new_total if new_sale_type == "cash" else min(max(requested_paid, 0), new_total)
        new_remaining = 0.0 if new_sale_type == "cash" else max(new_total - new_paid, 0)
        # 3) credit limit check on new customer
        if new_sale_type == "credit" and new_customer_id and new_remaining > 0:
            cust = await db.customers.find_one({"id": new_customer_id})
            if cust:
                limit = cust.get("credit_limit", 0)
                if limit and cust.get("balance", 0) + new_remaining > limit:
                    # rollback the reversal we just did to keep DB consistent
                    if doc.get("customer_id") and doc.get("remaining", 0):
                        await _adjust_party_balance(
                            "customer", doc["customer_id"], float(doc.get("remaining") or 0),
                            doc["number"], f"استرجاع تأثير الفاتورة {doc['number']} بعد فشل التعديل",
                        )
                    # restore inventory
                    for it in doc.get("items") or []:
                        cards = it.get("card_numbers") or []
                        if cards:
                            await db.cards.update_many(
                                {"number": {"$in": cards}},
                                {"$set": {"status": "sold", "sold_to": doc.get("customer_id")}},
                            )
                        residual = int(it.get("quantity", 0)) - len(cards)
                        if residual > 0:
                            await db.stock.update_one({"category_id": it.get("category_id")}, {"$inc": {"sold": residual}})
                    raise HTTPException(status_code=400, detail=f"لا يمكن تنفيذ التعديل لأنه يتجاوز سقف حساب العميل ({limit})")
        # 4) apply NEW inventory (same rules as create_sale)
        for item in data.items:
            if item.use_numbered and item.card_numbers:
                for n in item.card_numbers:
                    card = await db.cards.find_one({"number": n, "status": "available"})
                    if not card:
                        raise HTTPException(status_code=400, detail=f"الكرت {n} غير متوفر")
                await db.cards.update_many(
                    {"number": {"$in": item.card_numbers}, "status": "available"},
                    {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": new_customer_id}},
                )
            else:
                stock = await db.stock.find_one({"category_id": item.category_id})
                avail = (stock or {}).get("total", 0) - (stock or {}).get("sold", 0) if stock else 0
                numbered_avail = await db.cards.count_documents({"category_id": item.category_id, "status": "available"})
                if avail + numbered_avail < item.quantity:
                    raise HTTPException(status_code=400, detail=f"الكمية غير متوفرة للفئة")
                take_from_qty = min(item.quantity, avail)
                if take_from_qty > 0:
                    await db.stock.update_one({"category_id": item.category_id}, {"$inc": {"sold": take_from_qty}})
                take_from_numbered = item.quantity - take_from_qty
                if take_from_numbered > 0:
                    pending = await db.cards.find({"category_id": item.category_id, "status": "available"}).limit(take_from_numbered).to_list(take_from_numbered)
                    ids = [c["id"] for c in pending]
                    await db.cards.update_many({"id": {"$in": ids}}, {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": new_customer_id}})
        # 5) apply NEW balance
        balance_after = None
        if new_sale_type == "credit" and new_customer_id and new_remaining > 0:
            balance_after = await _adjust_party_balance(
                "customer", new_customer_id, new_remaining,
                doc["number"], f"تعديل فاتورة {doc['number']}",
            )
        # 6) update the doc, keep same id + number + created_at
        cust_name = data.customer_name
        if new_customer_id and not cust_name:
            _c = await db.customers.find_one({"id": new_customer_id})
            cust_name = (_c or {}).get("name", doc.get("customer_name") or "")
        update = {
            "customer_id": new_customer_id, "customer_name": cust_name or doc.get("customer_name"),
            "sale_type": new_sale_type, "items": items_final,
            "subtotal": subtotal, "discount": new_discount, "total": new_total,
            "paid": new_paid, "remaining": new_remaining,
            "notes": data.notes if data.notes is not None else doc.get("notes"),
            "edited_at": now_iso(), "edited_by": user.get("username"),
        }
        await db.sales.update_one({"id": sid}, {"$set": update})
        await audit_log(user, "edit", "sale", sid,
                        {"customer_id": doc.get("customer_id"), "total": doc.get("total"), "items": doc.get("items")},
                        {"customer_id": new_customer_id, "total": new_total, "items": items_final})
        updated_doc = await db.sales.find_one({"id": sid})
        return clean_doc({**updated_doc, "balance_after": balance_after})

    # --------- LEGACY QUICK EDIT PATH (discount/paid/notes only) ---------
    subtotal = doc.get("subtotal", 0)
    new_discount = data.discount if data.discount is not None else doc.get("discount", 0)
    requested_paid = data.paid if data.paid is not None else doc.get("paid", 0)
    new_total = subtotal - new_discount
    is_cash = doc.get("sale_type") == "cash"
    new_paid = new_total if is_cash else min(max(float(requested_paid or 0), 0), new_total)
    new_remaining = 0.0 if is_cash else max(new_total - new_paid, 0)
    old_remaining = doc.get("remaining", 0)
    diff = new_remaining - old_remaining
    if not is_cash and doc.get("customer_id") and diff != 0:
        customer = await db.customers.find_one({"id": doc["customer_id"]})
        if customer:
            limit = customer.get("credit_limit", 0)
            if limit > 0 and customer.get("balance", 0) + diff > limit:
                raise HTTPException(status_code=400, detail="التعديل يتجاوز سقف حساب العميل")
        # Replace old ledger entry in place (no extra "تعديل" row in statement)
        await _remove_ledger_by_op("customer", doc["customer_id"], doc["number"])
        if new_remaining > 0:
            await _adjust_party_balance("customer", doc["customer_id"], new_remaining, doc["number"], f"فاتورة مبيعات {doc['number']}")
    update = {"discount": new_discount, "paid": new_paid, "total": new_total, "remaining": new_remaining,
              "notes": data.notes if data.notes is not None else doc.get("notes"),
              "edited_at": now_iso(), "edited_by": user.get("username")}
    await db.sales.update_one({"id": sid}, {"$set": update})
    await audit_log(user, "edit", "sale", sid, {"old": {"discount": doc.get("discount"), "paid": doc.get("paid")}}, update)
    updated_doc = await db.sales.find_one({"id": sid})
    return clean_doc(updated_doc)


class ReceiptEditIn(BaseModel):
    amount: Optional[float] = None
    description: Optional[str] = None

@api.put("/receipts/{rid}")
async def edit_receipt(rid: str, data: ReceiptEditIn, user=Depends(require_perm("edit_ops"))):
    doc = await db.receipts.find_one({"id": rid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    old_amount = doc.get("amount", 0)
    new_amount = data.amount if data.amount is not None else old_amount
    diff = new_amount - old_amount
    if diff != 0:
        # Rewrite the receipt's ledger entry in place (no extra "تعديل سند" row).
        pty = doc.get("party_type"); pid = doc.get("party_id")
        await _remove_ledger_by_op(pty, pid, doc.get("number",""))
        sign = -1 if doc.get("kind") in ("receipt", "payment") else 1
        kind_ar = "قبض" if doc.get("kind") == "receipt" else "صرف"
        await _adjust_party_balance(pty, pid, sign * new_amount, doc["number"], f"سند {kind_ar} {doc['number']}")
    update = {"amount": new_amount,
              "description": data.description if data.description is not None else doc.get("description"),
              "edited_at": now_iso(), "edited_by": user.get("username")}
    await db.receipts.update_one({"id": rid}, {"$set": update})
    await audit_log(user, "edit", "receipt", rid, {"old_amount": old_amount}, {"new_amount": new_amount})
    return {"ok": True}


# List customers with blocked info
@api.get("/customers/blocked/list")
async def blocked_customers(user=Depends(require_perm("customers"))):
    now = now_iso()
    blocks = await db.public_blocks.find({"blocked_until": {"$gt": now}}).to_list(1000)
    result = []
    for b in blocks:
        cust = await db.customers.find_one({"phone": b.get("phone")})
        result.append({
            "phone": b.get("phone"),
            "customer_name": (cust or {}).get("name", "غير معروف"),
            "customer_id": (cust or {}).get("id"),
            "failed_before_block": 5,
            "blocked_at": b.get("blocked_at"),
            "blocked_until": b.get("blocked_until"),
        })
    return result


# ================= PURCHASES =================
@api.post("/purchases")
async def create_purchase(data: PurchaseIn, user=Depends(require_perm("purchases"))):
    if data.idempotency_key:
        existing = await db.purchases.find_one({"idempotency_key": data.idempotency_key})
        if existing:
            return clean_doc(existing)
    if data.purchase_type not in ("cash", "credit"):
        raise HTTPException(status_code=400, detail="يرجى اختيار نوع الفاتورة: نقد أو آجل.")

    subtotal = 0.0
    items_final = []
    for item in data.items:
        line_total = item.quantity * item.price
        subtotal += line_total
        items_final.append({**item.model_dump(), "total": line_total})
        cat = await db.card_categories.find_one({"id": item.category_id})
        if not cat: continue
        # If numbered cards provided, insert them into inventory
        if item.use_numbered and item.card_numbers:
            for n in item.card_numbers:
                n = (n or "").strip()
                if not n: continue
                exists = await db.cards.find_one({"number": n})
                if exists: continue  # skip duplicates silently
                await db.cards.insert_one({
                    "id": str(uuid.uuid4()), "number": n,
                    "category_id": item.category_id, "category_name": cat.get("name"),
                    "status": "available", "type": "numbered",
                    "purchase_price": item.price,
                    "supplier_id": data.supplier_id,
                    "created_at": now_iso(), "created_by": user.get("username"),
                })
        else:
            stock = await db.stock.find_one({"category_id": item.category_id})
            if stock:
                await db.stock.update_one({"category_id": item.category_id}, {"$inc": {"total": item.quantity}})
            else:
                await db.stock.insert_one({
                    "id": str(uuid.uuid4()), "category_id": item.category_id,
                    "category_name": cat.get("name"),
                    "total": item.quantity, "sold": 0, "used": 0, "created_at": now_iso(),
                })
    total = subtotal - (data.discount or 0)
    paid = total if data.purchase_type == "cash" else min(max(float(data.paid or 0), 0), total)
    remaining = 0.0 if data.purchase_type == "cash" else max(total - paid, 0)
    number = await next_gwd_number()
    doc = {
        "id": str(uuid.uuid4()),
        "number": number, "type": "purchase",
        "supplier_id": data.supplier_id, "supplier_name": data.supplier_name,
        "purchase_type": data.purchase_type,
        "items": items_final, "subtotal": subtotal, "discount": data.discount or 0,
        "total": total, "paid": paid, "remaining": remaining,
        "notes": data.notes, "user_id": user["id"], "username": user.get("username"),
        "status": "active", "idempotency_key": data.idempotency_key,
        "local_id": data.local_id, "device_id": data.device_id,
        "created_at": now_iso(),
    }
    await db.purchases.insert_one(doc)
    balance_after = None
    if data.purchase_type == "credit" and data.supplier_id and remaining > 0:
        # فاتورة آجلة: المورد دائن (له). القيمة المستحقة تُسجَّل كقيد دائن => رصيد سالب.
        balance_after = await _adjust_party_balance("supplier", data.supplier_id, -remaining, number, f"فاتورة مشتريات آجلة {number}")
    await audit_log(user, "create", "purchase", doc["id"])
    await notify(f"مشتريات {number}", f"تم تسجيل فاتورة مشتريات بإجمالي {total}", "info")
    return clean_doc({**doc, "balance_after": balance_after})

class PurchaseEditIn(BaseModel):
    discount: Optional[float] = None
    paid: Optional[float] = None
    notes: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    purchase_type: Optional[str] = None
    items: Optional[List[SaleItemIn]] = None


async def _reverse_purchase_inventory(items: list, purchase_id: str):
    for it in items or []:
        cards = it.get("card_numbers") or []
        if it.get("use_numbered") and cards:
            # Delete cards that came from this purchase AND are still available
            await db.cards.delete_many({"number": {"$in": cards}, "status": "available"})
        else:
            # decrement stock.total by qty (but never below current sold)
            stock = await db.stock.find_one({"category_id": it.get("category_id")})
            if stock:
                new_total = max(stock.get("sold", 0), stock.get("total", 0) - int(it.get("quantity", 0)))
                await db.stock.update_one({"category_id": it.get("category_id")}, {"$set": {"total": new_total}})


@api.put("/purchases/{pid}")
async def edit_purchase(pid: str, data: PurchaseEditIn, user=Depends(require_perm("edit_ops"))):
    doc = await db.purchases.find_one({"id": pid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    if doc.get("status") != "active":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل فاتورة ملغاة")

    # --------- FULL EDIT PATH ---------
    if data.items is not None:
        new_supplier_id = data.supplier_id or doc.get("supplier_id")
        new_purchase_type = data.purchase_type or doc.get("purchase_type", "credit")
        if new_purchase_type not in ("cash", "credit"):
            raise HTTPException(status_code=400, detail="نوع الفاتورة غير صحيح")
        # 1) reverse OLD inventory + supplier balance
        await _reverse_purchase_inventory(doc.get("items") or [], pid)
        if doc.get("supplier_id") and doc.get("number"):
            await _remove_ledger_by_op("supplier", doc["supplier_id"], doc["number"])
        # 2) compute new totals + apply new inventory
        subtotal = 0.0
        items_final = []
        for it in data.items:
            line_total = it.quantity * it.price
            subtotal += line_total
            items_final.append({**it.model_dump(), "total": line_total})
            cat = await db.card_categories.find_one({"id": it.category_id})
            if not cat:
                continue
            if it.use_numbered and it.card_numbers:
                for n in it.card_numbers:
                    n = (n or "").strip()
                    if not n: continue
                    exists = await db.cards.find_one({"number": n})
                    if exists: continue
                    await db.cards.insert_one({
                        "id": str(uuid.uuid4()), "number": n,
                        "category_id": it.category_id, "category_name": cat.get("name"),
                        "status": "available", "type": "numbered",
                        "purchase_price": it.price,
                        "supplier_id": new_supplier_id,
                        "source_purchase_id": pid,
                        "created_at": now_iso(), "created_by": user.get("username"),
                    })
            else:
                stock = await db.stock.find_one({"category_id": it.category_id})
                if stock:
                    await db.stock.update_one({"category_id": it.category_id}, {"$inc": {"total": it.quantity}})
                else:
                    await db.stock.insert_one({
                        "id": str(uuid.uuid4()), "category_id": it.category_id,
                        "category_name": cat.get("name"),
                        "total": it.quantity, "sold": 0, "used": 0, "created_at": now_iso(),
                    })
        new_discount = float(data.discount if data.discount is not None else doc.get("discount", 0) or 0)
        requested_paid = float(data.paid if data.paid is not None else doc.get("paid", 0) or 0)
        new_total = subtotal - new_discount
        new_paid = new_total if new_purchase_type == "cash" else min(max(requested_paid, 0), new_total)
        new_remaining = 0.0 if new_purchase_type == "cash" else max(new_total - new_paid, 0)
        # 3) apply new supplier balance
        balance_after = None
        if new_purchase_type == "credit" and new_supplier_id and new_remaining > 0:
            balance_after = await _adjust_party_balance(
                "supplier", new_supplier_id, new_remaining,
                doc["number"], f"تعديل فاتورة مشتريات {doc['number']}",
            )
        # 4) update the doc
        sup_name = data.supplier_name
        if new_supplier_id and not sup_name:
            _s = await db.suppliers.find_one({"id": new_supplier_id})
            sup_name = (_s or {}).get("name", doc.get("supplier_name") or "")
        update = {
            "supplier_id": new_supplier_id, "supplier_name": sup_name or doc.get("supplier_name"),
            "purchase_type": new_purchase_type,
            "items": items_final,
            "subtotal": subtotal, "discount": new_discount, "total": new_total,
            "paid": new_paid, "remaining": new_remaining,
            "notes": data.notes if data.notes is not None else doc.get("notes"),
            "edited_at": now_iso(), "edited_by": user.get("username"),
        }
        await db.purchases.update_one({"id": pid}, {"$set": update})
        await audit_log(user, "edit", "purchase", pid,
                        {"supplier_id": doc.get("supplier_id"), "total": doc.get("total"), "items": doc.get("items")},
                        {"supplier_id": new_supplier_id, "total": new_total, "items": items_final})
        updated_doc = await db.purchases.find_one({"id": pid})
        return clean_doc({**updated_doc, "balance_after": balance_after})

    # --------- LEGACY QUICK EDIT ---------
    subtotal = doc.get("subtotal", 0)
    new_discount = data.discount if data.discount is not None else doc.get("discount", 0)
    requested_paid = data.paid if data.paid is not None else doc.get("paid", 0)
    new_total = subtotal - new_discount
    is_cash = doc.get("purchase_type", "credit") == "cash"
    new_paid = new_total if is_cash else min(max(float(requested_paid or 0), 0), new_total)
    new_remaining = 0.0 if is_cash else max(new_total - new_paid, 0)
    if doc.get("supplier_id") and doc.get("number"):
        await _remove_ledger_by_op("supplier", doc["supplier_id"], doc["number"])
        if not is_cash and new_remaining > 0:
            await _adjust_party_balance("supplier", doc["supplier_id"], new_remaining, doc["number"], f"فاتورة مشتريات {doc['number']}")
    update = {"discount": new_discount, "paid": new_paid, "total": new_total, "remaining": new_remaining,
              "notes": data.notes if data.notes is not None else doc.get("notes"),
              "edited_at": now_iso(), "edited_by": user.get("username")}
    await db.purchases.update_one({"id": pid}, {"$set": update})
    await audit_log(user, "edit", "purchase", pid, {"old_total": doc.get("total")}, {"new_total": new_total})
    updated_doc = await db.purchases.find_one({"id": pid})
    return clean_doc(updated_doc)


@api.get("/purchases")
async def list_purchases(user=Depends(require_perm("purchases"))):
    items = await db.purchases.find().sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(p) for p in items]

@api.get("/purchases/{pid}")
async def get_purchase(pid: str, user=Depends(require_perm("purchases"))):
    doc = await db.purchases.find_one({"$or": [{"id": pid}, {"number": pid}]})
    if not doc: raise HTTPException(status_code=404)
    return clean_doc(doc)


# ================= RECEIPTS =================
@api.post("/receipts")
async def create_receipt(data: ReceiptIn, user=Depends(require_perm("receipts"))):
    if data.idempotency_key:
        existing = await db.receipts.find_one({"idempotency_key": data.idempotency_key})
        if existing: return clean_doc(existing)
    number = await next_gwd_number()
    # kind=receipt (قبض): reduce customer debt (-) or supplier balance
    # kind=payment (صرف): reduce supplier debt / customer prepay
    if data.party_type == "supplier":
        # المورد دائن (رصيد سالب = له). صرف/سداد للمورد يقلل ما علينا => يزيد الرصيد نحو الصفر (+).
        # قبض من المورد (استرجاع/تسبيق) => يزيد ما علينا => يقلل الرصيد (-).
        amount_sign = data.amount if data.kind == "payment" else -data.amount
    else:
        # عميل/نقطة بيع: قبض يقلل مديونيته (-) ، صرف (دفع له) يزيد رصيده الدائن (-).
        amount_sign = -data.amount
    balance_after = await _adjust_party_balance(data.party_type, data.party_id, amount_sign, number, data.description or ("سند قبض" if data.kind=="receipt" else "سند صرف"))
    doc = {
        "id": str(uuid.uuid4()), "number": number,
        "type": "receipt_voucher" if data.kind == "receipt" else "payment_voucher",
        "kind": data.kind,
        "party_type": data.party_type, "party_id": data.party_id, "party_name": data.party_name,
        "amount": data.amount, "description": data.description,
        "user_id": user["id"], "username": user.get("username"),
        "status": "active", "idempotency_key": data.idempotency_key,
        "balance_after": balance_after,
        "created_at": now_iso(),
    }
    await db.receipts.insert_one(doc)
    await audit_log(user, "create", "receipt", doc["id"])
    return clean_doc(doc)

@api.get("/receipts")
async def list_receipts(user=Depends(require_perm("receipts"))):
    items = await db.receipts.find().sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(r) for r in items]


# ================= EXPENSES =================
@api.get("/expense-accounts")
async def list_expense_accounts(user=Depends(require_perm("expenses"))):
    items = await db.expense_accounts.find().sort("name", 1).to_list(500)
    return [clean_doc(x) for x in items]

@api.post("/expense-accounts")
async def create_expense_account(data: ExpenseAccountIn, user=Depends(require_perm("expenses"))):
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="اسم الحساب مطلوب")
    if await db.expense_accounts.find_one({"name": data.name.strip()}):
        raise HTTPException(status_code=400, detail="الاسم مستخدم بالفعل")
    doc = {
        "id": str(uuid.uuid4()), "name": data.name.strip(),
        "notes": (data.notes or "").strip(),
        "created_at": now_iso(), "created_by": user.get("username"),
    }
    await db.expense_accounts.insert_one(doc)
    await audit_log(user, "create", "expense_account", doc["id"])
    return clean_doc(doc)

@api.delete("/expense-accounts/{acc_id}")
async def delete_expense_account(acc_id: str, user=Depends(require_perm("expenses"))):
    used = await db.expenses.count_documents({"account_id": acc_id, "status": {"$ne": "deleted"}})
    if used:
        raise HTTPException(status_code=400, detail=f"لا يمكن الحذف — الحساب مستخدم في {used} مصروف")
    r = await db.expense_accounts.delete_one({"id": acc_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="غير موجود")
    await audit_log(user, "delete", "expense_account", acc_id)
    return {"ok": True}

@api.get("/expenses")
async def list_expenses(user=Depends(require_perm("expenses"))):
    items = await db.expenses.find().sort("created_at", -1).limit(2000).to_list(2000)
    return [clean_doc(x) for x in items]

@api.post("/expenses")
async def create_expense(data: ExpenseIn, user=Depends(require_perm("expenses"))):
    if data.amount is None or data.amount <= 0:
        raise HTTPException(status_code=400, detail="المبلغ غير صالح")
    if data.idempotency_key:
        existing = await db.expenses.find_one({"idempotency_key": data.idempotency_key})
        if existing:
            return clean_doc(existing)
    acc = await db.expense_accounts.find_one({"id": data.account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="حساب المصروف غير موجود")
    number = await next_gwd_number()
    when = f"{data.date}T00:00:00+03:00" if data.date else now_iso()
    doc = {
        "id": str(uuid.uuid4()), "number": number,
        "account_id": data.account_id, "account_name": acc.get("name", ""),
        "amount": float(data.amount),
        "description": (data.description or "").strip(),
        "user_id": user["id"], "username": user.get("username"),
        "idempotency_key": data.idempotency_key,
        "status": "active",
        "created_at": when,
    }
    await db.expenses.insert_one(doc)
    await audit_log(user, "create", "expense", doc["id"])
    return clean_doc(doc)

@api.delete("/expenses/{eid}")
async def delete_expense(eid: str, user=Depends(require_perm("delete_ops"))):
    doc = await db.expenses.find_one({"id": eid})
    if not doc:
        raise HTTPException(status_code=404, detail="غير موجود")
    await db.expenses.update_one({"id": eid}, {"$set": {"status": "deleted", "deleted_at": now_iso(), "deleted_by": user.get("username")}})
    await audit_log(user, f"حذف مصروف {doc.get('number','')}", "expense", eid, {"number": doc.get("number"), "amount": doc.get("amount")}, None)
    return {"ok": True}


# ================= CASH BOX =================
@api.get("/cash/summary")
async def cash_summary(
    start: Optional[str] = None,
    end: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Compute cash box totals from all sources:
    IN  = cash sales + receipt vouchers + transfers TO cash
    OUT = cash purchases + payment vouchers + expenses + transfers FROM cash"""
    s_iso = f"{start}T00:00:00+03:00" if start else None
    e_iso = f"{end}T23:59:59+03:00" if end else None

    def in_range(iso: str) -> bool:
        if s_iso and iso < s_iso: return False
        if e_iso and iso > e_iso: return False
        return True

    sales = await db.sales.find({"status": "active", "sale_type": "cash"}).to_list(20000)
    purchases = await db.purchases.find({"status": "active", "purchase_type": "cash"}).to_list(20000)
    recs = await db.receipts.find({"status": "active"}).to_list(20000)
    exps = await db.expenses.find({"status": "active"}).to_list(20000)
    trs = await db.transfers.find({"status": "active"}).to_list(20000)

    total_in_all = sum(s.get("total", 0) for s in sales) \
        + sum(r.get("amount", 0) for r in recs if r.get("kind") == "receipt") \
        + sum(t.get("amount", 0) for t in trs if t.get("dest_type") == "cash")
    total_out_all = sum(p.get("total", 0) for p in purchases) \
        + sum(r.get("amount", 0) for r in recs if r.get("kind") == "payment") \
        + sum(e.get("amount", 0) for e in exps) \
        + sum(t.get("amount", 0) for t in trs if t.get("source_type") == "cash")
    running_balance = total_in_all - total_out_all

    filt_in = sum(s.get("total", 0) for s in sales if in_range(s.get("created_at", ""))) \
              + sum(r.get("amount", 0) for r in recs if r.get("kind") == "receipt" and in_range(r.get("created_at", ""))) \
              + sum(t.get("amount", 0) for t in trs if t.get("dest_type") == "cash" and in_range(t.get("created_at", "")))
    filt_out = sum(p.get("total", 0) for p in purchases if in_range(p.get("created_at", ""))) \
               + sum(r.get("amount", 0) for r in recs if r.get("kind") == "payment" and in_range(r.get("created_at", ""))) \
               + sum(e.get("amount", 0) for e in exps if in_range(e.get("created_at", ""))) \
               + sum(t.get("amount", 0) for t in trs if t.get("source_type") == "cash" and in_range(t.get("created_at", "")))

    return {
        "range": {"start": start, "end": end},
        "balance": running_balance,
        "total_in": filt_in,
        "total_out": filt_out,
        "net": filt_in - filt_out,
        "counts": {
            "cash_sales": sum(1 for s in sales if in_range(s.get("created_at", ""))),
            "cash_purchases": sum(1 for p in purchases if in_range(p.get("created_at", ""))),
            "receipts": sum(1 for r in recs if r.get("kind") == "receipt" and in_range(r.get("created_at", ""))),
            "payments": sum(1 for r in recs if r.get("kind") == "payment" and in_range(r.get("created_at", ""))),
            "expenses": sum(1 for e in exps if in_range(e.get("created_at", ""))),
            "transfers_in": sum(1 for t in trs if t.get("dest_type") == "cash" and in_range(t.get("created_at", ""))),
            "transfers_out": sum(1 for t in trs if t.get("source_type") == "cash" and in_range(t.get("created_at", ""))),
        },
    }

@api.get("/cash/statement")
async def cash_statement(
    start: Optional[str] = None,
    end: Optional[str] = None,
    user=Depends(require_perm("receipts")),
):
    """Returns every cash-affecting movement in the window, ordered by date."""
    s_iso = f"{start}T00:00:00+03:00" if start else None
    e_iso = f"{end}T23:59:59+03:00" if end else None
    def q(base):
        if s_iso or e_iso:
            base["created_at"] = {}
            if s_iso: base["created_at"]["$gte"] = s_iso
            if e_iso: base["created_at"]["$lte"] = e_iso
        return base
    sales = await db.sales.find(q({"status": "active", "sale_type": "cash"})).to_list(5000)
    purchases = await db.purchases.find(q({"status": "active", "purchase_type": "cash"})).to_list(5000)
    recs = await db.receipts.find(q({"status": "active"})).to_list(5000)
    exps = await db.expenses.find(q({"status": "active"})).to_list(5000)
    trs = await db.transfers.find(q({"status": "active"})).to_list(5000)
    entries = []
    for s in sales:
        entries.append({"created_at": s["created_at"], "type": "cash_sale", "number": s.get("number"),
                        "description": f"مبيعات نقدية — {s.get('customer_name') or 'نقدي'}",
                        "in": s.get("total", 0), "out": 0})
    for p in purchases:
        entries.append({"created_at": p["created_at"], "type": "cash_purchase", "number": p.get("number"),
                        "description": f"مشتريات نقدية — {p.get('supplier_name') or 'نقدي'}",
                        "in": 0, "out": p.get("total", 0)})
    for r in recs:
        if r.get("kind") == "receipt":
            entries.append({"created_at": r["created_at"], "type": "receipt", "number": r.get("number"),
                            "description": f"سند قبض — {r.get('party_name','')}",
                            "in": r.get("amount", 0), "out": 0})
        else:
            entries.append({"created_at": r["created_at"], "type": "payment", "number": r.get("number"),
                            "description": f"سند صرف — {r.get('party_name','')}",
                            "in": 0, "out": r.get("amount", 0)})
    for e in exps:
        entries.append({"created_at": e["created_at"], "type": "expense", "number": e.get("number"),
                        "description": f"مصروف — {e.get('account_name','')}" + (f" — {e.get('description')}" if e.get("description") else ""),
                        "in": 0, "out": e.get("amount", 0)})
    for t in trs:
        if t.get("dest_type") == "cash":
            entries.append({"created_at": t["created_at"], "type": "transfer_in", "number": t.get("number"),
                            "description": f"تحويل من {t.get('source_name','')}" + (f" — {t.get('description')}" if t.get("description") else ""),
                            "in": t.get("amount", 0), "out": 0})
        elif t.get("source_type") == "cash":
            entries.append({"created_at": t["created_at"], "type": "transfer_out", "number": t.get("number"),
                            "description": f"تحويل إلى {t.get('dest_name','')}" + (f" — {t.get('description')}" if t.get("description") else ""),
                            "in": 0, "out": t.get("amount", 0)})
    entries.sort(key=lambda x: x["created_at"])
    running = 0.0
    for e in entries:
        running += (e["in"] or 0) - (e["out"] or 0)
        e["balance"] = running
    return {"range": {"start": start, "end": end}, "entries": entries,
            "total_in": sum(e["in"] for e in entries), "total_out": sum(e["out"] for e in entries)}


# ================= TRANSFERS =================
@api.post("/transfers")
async def create_transfer(data: TransferIn, user=Depends(require_perm("receipts"))):
    if data.amount is None or data.amount <= 0:
        raise HTTPException(status_code=400, detail="المبلغ غير صالح")
    allowed = ("customer", "supplier", "cash")
    if data.source_type not in allowed or data.dest_type not in allowed:
        raise HTTPException(status_code=400, detail="نوع الحساب غير مدعوم")
    if data.source_type == data.dest_type and (data.source_id or "") == (data.dest_id or ""):
        raise HTTPException(status_code=400, detail="لا يمكن التحويل لنفس الحساب")
    if data.idempotency_key:
        existing = await db.transfers.find_one({"idempotency_key": data.idempotency_key})
        if existing: return clean_doc(existing)

    # Validate parties + fetch names
    source_name = data.source_name or ""
    dest_name = data.dest_name or ""
    if data.source_type in ("customer", "supplier"):
        col = db.customers if data.source_type == "customer" else db.suppliers
        src = await col.find_one({"id": data.source_id})
        if not src: raise HTTPException(status_code=404, detail="الحساب المصدر غير موجود")
        source_name = src.get("name", source_name)
        if data.block_negative:
            projected = src.get("balance", 0) - data.amount
            if projected < 0:
                raise HTTPException(status_code=400, detail=f"الرصيد غير كافٍ في {source_name}")
    else:
        source_name = source_name or "الصندوق"
    if data.dest_type in ("customer", "supplier"):
        col = db.customers if data.dest_type == "customer" else db.suppliers
        dst = await col.find_one({"id": data.dest_id})
        if not dst: raise HTTPException(status_code=404, detail="الحساب المستلم غير موجود")
        dest_name = dst.get("name", dest_name)
    else:
        dest_name = dest_name or "الصندوق"

    number = await next_gwd_number()
    desc_src = data.description or f"تحويل إلى {dest_name}"
    desc_dst = data.description or f"تحويل من {source_name}"

    # Apply balances / ledger
    if data.source_type in ("customer", "supplier"):
        await _adjust_party_balance(data.source_type, data.source_id, -data.amount, number, desc_src)
    if data.dest_type in ("customer", "supplier"):
        await _adjust_party_balance(data.dest_type, data.dest_id, data.amount, number, desc_dst)

    when = f"{data.date}T00:00:00+03:00" if data.date else now_iso()
    doc = {
        "id": str(uuid.uuid4()), "number": number,
        "source_type": data.source_type, "source_id": data.source_id, "source_name": source_name,
        "dest_type": data.dest_type, "dest_id": data.dest_id, "dest_name": dest_name,
        "amount": float(data.amount), "description": (data.description or "").strip(),
        "block_negative": bool(data.block_negative),
        "user_id": user["id"], "username": user.get("username"),
        "status": "active", "idempotency_key": data.idempotency_key,
        "created_at": when,
    }
    await db.transfers.insert_one(doc)
    await audit_log(user, "create", "transfer", doc["id"], None, {"amount": data.amount})
    return clean_doc(doc)

@api.get("/transfers")
async def list_transfers(user=Depends(require_perm("receipts"))):
    items = await db.transfers.find({"status": "active"}).sort("created_at", -1).limit(2000).to_list(2000)
    return [clean_doc(t) for t in items]


# ================= UNIFIED ACCOUNTS =================
# ================= CUSTOM ACCOUNT LISTS (قوائم حسابات مخصصة) =================
class AccountListIn(BaseModel):
    name: str

class MoveAccountIn(BaseModel):
    list_id: Optional[str] = None

@api.get("/account-lists")
async def list_account_lists(user=Depends(get_current_user)):
    items = await db.account_lists.find().sort("created_at", 1).to_list(500)
    return [clean_doc(l) for l in items]

@api.post("/account-lists")
async def create_account_list(data: AccountListIn, user=Depends(require_perm("receipts"))):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="أدخل اسم القائمة")
    if await db.account_lists.find_one({"name": name}):
        raise HTTPException(status_code=400, detail="يوجد قائمة بنفس الاسم")
    doc = {"id": str(uuid.uuid4()), "name": name, "created_at": now_iso()}
    await db.account_lists.insert_one(doc)
    await audit_log(user, "create", "account_list", doc["id"])
    return clean_doc(doc)

@api.delete("/account-lists/{lid}")
async def delete_account_list(lid: str, user=Depends(require_perm("receipts"))):
    """Remove a list. Accounts are only DETACHED (list_id cleared) — no account/data is deleted."""
    await db.customers.update_many({"list_id": lid}, {"$set": {"list_id": None}})
    await db.suppliers.update_many({"list_id": lid}, {"$set": {"list_id": None}})
    await db.expense_accounts.update_many({"list_id": lid}, {"$set": {"list_id": None}})
    await db.account_lists.delete_one({"id": lid})
    await audit_log(user, "delete", "account_list", lid)
    return {"ok": True}

@api.put("/accounts/{ptype}/{pid}/list")
async def move_account_to_list(ptype: str, pid: str, data: MoveAccountIn, user=Depends(require_perm("receipts"))):
    """Move an existing account to a custom list by ONLY updating its list_id field.
    No new account is created and no ledger/invoice/receipt/balance is touched."""
    coll = db.customers if ptype in ("customer", "pos") else db.suppliers if ptype == "supplier" else db.expense_accounts if ptype == "expense" else None
    if coll is None:
        raise HTTPException(status_code=400, detail="نوع حساب غير صالح")
    lid = data.list_id or None
    if lid and not await db.account_lists.find_one({"id": lid}):
        raise HTTPException(status_code=404, detail="القائمة غير موجودة")
    r = await coll.update_one({"id": pid}, {"$set": {"list_id": lid}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="الحساب غير موجود")
    await audit_log(user, "move_to_list", ptype, pid, None, {"list_id": lid})
    return {"ok": True, "list_id": lid}


@api.get("/accounts")
async def list_accounts(user=Depends(get_current_user)):
    """Unified party accounts (customers/POS/suppliers/expense accounts) with balances.
    Includes a virtual cash account computed on the fly."""
    out: List[Dict[str, Any]] = []
    lists = await db.account_lists.find().to_list(500)
    lists_map = {l["id"]: l.get("name") for l in lists}
    cust = await db.customers.find().to_list(10000)
    for c in cust:
        c = clean_doc(c)
        out.append({
            "id": c["id"], "type": ("pos" if c.get("customer_type") == "pos" else "customer"),
            "name": c.get("name",""), "phone": c.get("phone","") or "",
            "balance": c.get("balance", 0), "opening_balance": c.get("opening_balance", 0),
            "credit_limit": c.get("credit_limit", 0),
            "list_id": c.get("list_id"), "list_name": lists_map.get(c.get("list_id")),
            "status": c.get("status","active"),
        })
    sup = await db.suppliers.find().to_list(10000)
    for s in sup:
        s = clean_doc(s)
        out.append({
            "id": s["id"], "type": "supplier",
            "name": s.get("name",""), "phone": s.get("phone","") or "",
            "balance": s.get("balance", 0), "opening_balance": s.get("opening_balance", 0),
            "credit_limit": s.get("credit_limit", 0),
            "list_id": s.get("list_id"), "list_name": lists_map.get(s.get("list_id")),
            "status": s.get("status","active"),
        })
    accs = await db.expense_accounts.find().to_list(500)
    # expense accounts don't hold balances but we surface total spent
    for a in accs:
        a = clean_doc(a)
        spent_docs = await db.expenses.find({"account_id": a["id"], "status": "active"}).to_list(20000)
        spent = sum(x.get("amount", 0) for x in spent_docs)
        out.append({
            "id": a["id"], "type": "expense",
            "name": a.get("name",""), "phone": "",
            "balance": -spent, "opening_balance": 0,
            "credit_limit": 0,
            "list_id": a.get("list_id"), "list_name": lists_map.get(a.get("list_id")),
            "status": "active",
        })
    # Cash summary as a virtual account
    cash_all = 0.0
    sales = await db.sales.find({"status": "active", "sale_type": "cash"}).to_list(20000)
    purchases = await db.purchases.find({"status": "active", "purchase_type": "cash"}).to_list(20000)
    recs = await db.receipts.find({"status": "active"}).to_list(20000)
    exps = await db.expenses.find({"status": "active"}).to_list(20000)
    trs = await db.transfers.find({"status": "active"}).to_list(20000)
    cash_all = (sum(s.get("total",0) for s in sales)
                - sum(p.get("total",0) for p in purchases)
                + sum(r.get("amount",0) for r in recs if r.get("kind")=="receipt")
                + sum(t.get("amount",0) for t in trs if t.get("dest_type")=="cash")
                - sum(r.get("amount",0) for r in recs if r.get("kind")=="payment")
                - sum(e.get("amount",0) for e in exps)
                - sum(t.get("amount",0) for t in trs if t.get("source_type")=="cash"))
    out.insert(0, {"id": "cash", "type": "cash", "name": "الصندوق", "phone": "",
                   "balance": cash_all, "opening_balance": 0, "credit_limit": 0, "status": "active"})
    return out


# ================= OPENING BALANCES REPORT =================
@api.get("/reports/opening-balances")
async def report_opening_balances(user=Depends(require_perm("reports"))):
    rows: List[Dict[str, Any]] = []
    for c in await db.customers.find({"opening_balance": {"$ne": 0}}).to_list(10000):
        c = clean_doc(c)
        rows.append({
            "id": c["id"], "type": ("pos" if c.get("customer_type") == "pos" else "customer"),
            "name": c.get("name",""), "phone": c.get("phone","") or "",
            "opening_balance": c.get("opening_balance", 0),
            "current_balance": c.get("balance", 0),
        })
    for s in await db.suppliers.find({"opening_balance": {"$ne": 0}}).to_list(10000):
        s = clean_doc(s)
        rows.append({
            "id": s["id"], "type": "supplier",
            "name": s.get("name",""), "phone": s.get("phone","") or "",
            "opening_balance": s.get("opening_balance", 0),
            "current_balance": s.get("balance", 0),
        })
    return rows


# ================= ITEM MOVEMENT REPORT =================
@api.get("/reports/item-movement")
async def report_item_movement(
    category_id: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    user=Depends(require_perm("reports")),
):
    """Return every inventory movement for a category, sorted chronologically,
    with running balance (available stock = numbered available + qty available - qty sold).
    Movements: purchases (+), sales (-), card additions (+)."""
    cat = await db.card_categories.find_one({"id": category_id})
    if not cat: raise HTTPException(status_code=404, detail="الفئة غير موجودة")
    s_iso = f"{start}T00:00:00+03:00" if start else None
    e_iso = f"{end}T23:59:59+03:00" if end else None

    entries: List[Dict[str, Any]] = []
    # 1) Purchases (+)
    async for p in db.purchases.find({"status": "active"}):
        for it in p.get("items", []):
            if it.get("category_id") == category_id:
                entries.append({
                    "created_at": p.get("created_at",""),
                    "type": "purchase", "number": p.get("number",""),
                    "description": f"شراء من {p.get('supplier_name','')}",
                    "in": it.get("quantity", 0), "out": 0,
                })
    # 2) Sales (-)
    async for s in db.sales.find({"status": "active"}):
        for it in s.get("items", []):
            if it.get("category_id") == category_id:
                entries.append({
                    "created_at": s.get("created_at",""),
                    "type": "sale", "number": s.get("number",""),
                    "description": f"مبيعات — {s.get('customer_name','') or 'نقدي'}",
                    "in": 0, "out": it.get("quantity", 0),
                })
    # 3) Direct card additions (numbered + quantity) — count as "in"
    async for op in db.stock_ops.find({"category_id": category_id}):
        entries.append({
            "created_at": op.get("created_at",""),
            "type": op.get("kind","add"), "number": "-",
            "description": op.get("description") or "إضافة مخزون بدون فاتورة",
            "in": op.get("quantity", 0), "out": 0,
        })
    # 4) Legacy cards without stock_ops entry — one row per legacy insert date
    # Detect legacy numbered cards not covered by stock_ops (cards created before we started logging)
    logged_dates = set()
    async for op in db.stock_ops.find({"category_id": category_id, "kind": "add_numbered"}):
        logged_dates.add(op.get("created_at",""))
    legacy_by_date: Dict[str, int] = {}
    async for c in db.cards.find({"category_id": category_id}):
        ca = c.get("created_at","")
        if ca and ca not in logged_dates:
            legacy_by_date[ca] = legacy_by_date.get(ca, 0) + 1
    for dt, qty in legacy_by_date.items():
        entries.append({
            "created_at": dt, "type": "add_numbered_legacy", "number": "-",
            "description": f"إضافة {qty} كرت مرقم (سجل سابق)",
            "in": qty, "out": 0,
        })

    entries.sort(key=lambda x: x.get("created_at",""))
    running = 0.0
    filtered: List[Dict[str, Any]] = []
    for e in entries:
        # opening (before window) accumulates but is not shown
        running += (e["in"] or 0) - (e["out"] or 0)
        e["balance"] = running
        if s_iso and e.get("created_at","") < s_iso: continue
        if e_iso and e.get("created_at","") > e_iso: continue
        filtered.append(e)

    # Balance BEFORE window
    balance_before = 0.0
    if s_iso:
        for e in entries:
            if e.get("created_at","") < s_iso:
                balance_before += (e["in"] or 0) - (e["out"] or 0)

    total_in = sum(e["in"] for e in filtered)
    total_out = sum(e["out"] for e in filtered)
    return {
        "category": {"id": category_id, "name": cat.get("name","")},
        "range": {"start": start, "end": end},
        "balance_before": balance_before,
        "balance_after": running,
        "total_in": total_in, "total_out": total_out,
        "entries": filtered,
    }


# ================= CURRENCIES =================
class CurrencyIn(BaseModel):
    name: str
    symbol: str
    rate_to_yer: float  # 1 unit of this currency = X YER
    active: Optional[bool] = True

@api.get("/currencies")
async def list_currencies(user=Depends(get_current_user)):
    items = await db.currencies.find().to_list(200)
    return [clean_doc(c) for c in items]

@api.post("/currencies")
async def create_currency(data: CurrencyIn, user=Depends(require_perm("settings"))):
    if data.rate_to_yer <= 0:
        raise HTTPException(status_code=400, detail="سعر الصرف غير صالح")
    dup = await db.currencies.find_one({"symbol": data.symbol})
    if dup: raise HTTPException(status_code=400, detail="العملة موجودة مسبقاً")
    doc = {
        "id": str(uuid.uuid4()), "name": data.name.strip(),
        "symbol": data.symbol.strip(), "rate_to_yer": float(data.rate_to_yer),
        "active": bool(data.active), "created_at": now_iso(),
        "user_id": user["id"],
    }
    await db.currencies.insert_one(doc)
    return clean_doc(doc)

@api.put("/currencies/{cid}")
async def update_currency(cid: str, data: CurrencyIn, user=Depends(require_perm("settings"))):
    if data.rate_to_yer <= 0:
        raise HTTPException(status_code=400, detail="سعر الصرف غير صالح")
    await db.currencies.update_one({"id": cid}, {"$set": {
        "name": data.name.strip(), "symbol": data.symbol.strip(),
        "rate_to_yer": float(data.rate_to_yer), "active": bool(data.active),
        "updated_at": now_iso(),
    }})
    return clean_doc(await db.currencies.find_one({"id": cid}))

@api.delete("/currencies/{cid}")
async def delete_currency(cid: str, user=Depends(require_perm("settings"))):
    cur = await db.currencies.find_one({"id": cid})
    if not cur: raise HTTPException(status_code=404, detail="العملة غير موجودة")
    # Check if currency was used anywhere → soft-disable instead of hard delete
    used = (await db.sales.count_documents({"currency_symbol": cur.get("symbol")})
            + await db.purchases.count_documents({"currency_symbol": cur.get("symbol")})
            + await db.receipts.count_documents({"currency_symbol": cur.get("symbol")})
            + await db.transfers.count_documents({"currency_symbol": cur.get("symbol")})
            + await db.expenses.count_documents({"currency_symbol": cur.get("symbol")}))
    if used > 0:
        await db.currencies.update_one({"id": cid}, {"$set": {"active": False}})
        return {"ok": True, "action": "disabled", "used_in": used,
                "reason": "العملة مستخدمة في عمليات سابقة، تم تعطيلها بدلاً من الحذف"}
    await db.currencies.delete_one({"id": cid})
    return {"ok": True, "action": "deleted"}


# ================= UNIFIED ACCOUNT STATEMENT =================
@api.get("/accounts/{ptype}/{pid}/statement")
async def account_statement(
    ptype: str, pid: str,
    start: Optional[str] = None, end: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Statement for any party: customer / pos / supplier / expense / cash.
    Returns account metadata, entries (with running balance), and totals."""
    s_iso = f"{start}T00:00:00+03:00" if start else None
    e_iso = f"{end}T23:59:59+03:00" if end else None

    account: Dict[str, Any] = {}
    entries: List[Dict[str, Any]] = []

    if ptype in ("customer", "pos"):
        doc = await db.customers.find_one({"id": pid})
        if not doc: raise HTTPException(status_code=404, detail="الحساب غير موجود")
        account = {"id": doc["id"], "type": ("pos" if doc.get("customer_type")=="pos" else "customer"),
                   "name": doc.get("name",""), "phone": doc.get("phone","") or "",
                   "balance": doc.get("balance", 0), "opening_balance": doc.get("opening_balance", 0),
                   "credit_limit": doc.get("credit_limit", 0), "status": doc.get("status","active")}
        ledger = await db.ledger.find({"party_type": "customer", "party_id": pid}).sort("created_at", 1).to_list(20000)
        for e in ledger:
            entries.append({"created_at": e.get("created_at",""), "number": e.get("op_number",""),
                            "description": e.get("description",""),
                            "debit": e.get("debit", 0), "credit": e.get("credit", 0)})
    elif ptype == "supplier":
        doc = await db.suppliers.find_one({"id": pid})
        if not doc: raise HTTPException(status_code=404, detail="الحساب غير موجود")
        account = {"id": doc["id"], "type": "supplier",
                   "name": doc.get("name",""), "phone": doc.get("phone","") or "",
                   "balance": doc.get("balance", 0), "opening_balance": doc.get("opening_balance", 0),
                   "credit_limit": doc.get("credit_limit", 0), "status": doc.get("status","active")}
        ledger = await db.ledger.find({"party_type": "supplier", "party_id": pid}).sort("created_at", 1).to_list(20000)
        for e in ledger:
            entries.append({"created_at": e.get("created_at",""), "number": e.get("op_number",""),
                            "description": e.get("description",""),
                            "debit": e.get("debit", 0), "credit": e.get("credit", 0)})
    elif ptype == "expense":
        doc = await db.expense_accounts.find_one({"id": pid})
        if not doc: raise HTTPException(status_code=404, detail="الحساب غير موجود")
        exps = await db.expenses.find({"account_id": pid, "status": "active"}).sort("created_at", 1).to_list(20000)
        total = sum(e.get("amount",0) for e in exps)
        account = {"id": doc["id"], "type": "expense", "name": doc.get("name",""),
                   "phone": "", "balance": -total, "opening_balance": 0,
                   "credit_limit": 0, "status": "active"}
        for e in exps:
            entries.append({"created_at": e.get("created_at",""), "number": e.get("number",""),
                            "description": e.get("description") or f"مصروف {e.get('account_name','')}",
                            "debit": 0, "credit": e.get("amount", 0)})
    elif ptype == "cash":
        # Cash box statement — mimic /cash/statement
        sales = await db.sales.find({"status": "active", "sale_type": "cash"}).to_list(20000)
        purchases = await db.purchases.find({"status": "active", "purchase_type": "cash"}).to_list(20000)
        recs = await db.receipts.find({"status": "active"}).to_list(20000)
        exps = await db.expenses.find({"status": "active"}).to_list(20000)
        trs = await db.transfers.find({"status": "active"}).to_list(20000)
        for s in sales:
            entries.append({"created_at": s.get("created_at",""), "number": s.get("number",""),
                            "description": f"مبيعات نقدية — {s.get('customer_name','') or 'نقدي'}",
                            "debit": s.get("total", 0), "credit": 0})
        for p in purchases:
            entries.append({"created_at": p.get("created_at",""), "number": p.get("number",""),
                            "description": f"مشتريات نقدية — {p.get('supplier_name','') or 'نقدي'}",
                            "debit": 0, "credit": p.get("total", 0)})
        for r in recs:
            if r.get("kind") == "receipt":
                entries.append({"created_at": r.get("created_at",""), "number": r.get("number",""),
                                "description": f"سند قبض — {r.get('party_name','')}",
                                "debit": r.get("amount",0), "credit": 0})
            else:
                entries.append({"created_at": r.get("created_at",""), "number": r.get("number",""),
                                "description": f"سند صرف — {r.get('party_name','')}",
                                "debit": 0, "credit": r.get("amount",0)})
        for e in exps:
            entries.append({"created_at": e.get("created_at",""), "number": e.get("number",""),
                            "description": f"مصروف — {e.get('account_name','')}" + (f" — {e.get('description')}" if e.get('description') else ""),
                            "debit": 0, "credit": e.get("amount",0)})
        for t in trs:
            if t.get("dest_type") == "cash":
                entries.append({"created_at": t.get("created_at",""), "number": t.get("number",""),
                                "description": f"تحويل من {t.get('source_name','')}",
                                "debit": t.get("amount",0), "credit": 0})
            elif t.get("source_type") == "cash":
                entries.append({"created_at": t.get("created_at",""), "number": t.get("number",""),
                                "description": f"تحويل إلى {t.get('dest_name','')}",
                                "debit": 0, "credit": t.get("amount",0)})
        total_all_debit = sum(x["debit"] for x in entries)
        total_all_credit = sum(x["credit"] for x in entries)
        account = {"id": "cash", "type": "cash", "name": "الصندوق", "phone": "",
                   "balance": total_all_debit - total_all_credit, "opening_balance": 0,
                   "credit_limit": 0, "status": "active"}
    else:
        raise HTTPException(status_code=400, detail="نوع الحساب غير مدعوم")

    entries.sort(key=lambda x: x.get("created_at",""))
    # Compute running balance for ALL entries first
    running = 0.0
    for e in entries:
        running += e.get("debit", 0) - e.get("credit", 0)
        e["balance"] = running

    # Balance BEFORE filter window
    balance_before = 0.0
    if s_iso:
        for e in entries:
            if e.get("created_at","") < s_iso:
                balance_before += e.get("debit", 0) - e.get("credit", 0)

    filtered: List[Dict[str, Any]] = []
    for e in entries:
        if s_iso and e.get("created_at","") < s_iso: continue
        if e_iso and e.get("created_at","") > e_iso: continue
        filtered.append(e)

    total_debit = sum(e["debit"] for e in filtered)
    total_credit = sum(e["credit"] for e in filtered)
    return {
        "account": account,
        "range": {"start": start, "end": end},
        "balance_before": balance_before,
        "balance_after": running,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "entries": filtered,
    }


# ================= PAYMENT REQUESTS =================
class PaymentRequestIn(BaseModel):
    party_type: str  # customer / pos / supplier
    party_id: str
    amount: float
    method: Optional[str] = "sms"  # sms / whatsapp / manual
    message: Optional[str] = ""
    idempotency_key: Optional[str] = None

@api.get("/payment-requests")
async def list_payment_requests(party_type: Optional[str] = None, party_id: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if party_type: q["party_type"] = party_type
    if party_id: q["party_id"] = party_id
    items = await db.payment_requests.find(q).sort("created_at", -1).limit(2000).to_list(2000)
    return [clean_doc(x) for x in items]

@api.post("/payment-requests")
async def create_payment_request(data: PaymentRequestIn, user=Depends(require_perm("receipts"))):
    if data.amount is None or data.amount <= 0:
        raise HTTPException(status_code=400, detail="المبلغ غير صالح")
    if data.party_type not in ("customer","pos","supplier"):
        raise HTTPException(status_code=400, detail="نوع الحساب غير مدعوم")
    if data.idempotency_key:
        existing = await db.payment_requests.find_one({"idempotency_key": data.idempotency_key})
        if existing: return clean_doc(existing)
    # Fetch party
    col = db.customers if data.party_type in ("customer","pos") else db.suppliers
    party = await col.find_one({"id": data.party_id})
    if not party: raise HTTPException(status_code=404, detail="الحساب غير موجود")
    doc = {
        "id": str(uuid.uuid4()),
        "number": await next_gwd_number(),
        "party_type": data.party_type, "party_id": data.party_id,
        "party_name": party.get("name",""), "party_phone": party.get("phone","") or "",
        "amount": float(data.amount),
        "method": data.method or "sms",
        "message": (data.message or "").strip(),
        "status": "sent",
        "user_id": user["id"], "username": user.get("username"),
        "idempotency_key": data.idempotency_key,
        "created_at": now_iso(),
    }
    # Compose message: user's note (if any) + debt + payment request + bank blocks
    balance = float(party.get("balance", 0) or 0)
    header = doc["message"] or ""
    body_parts = []
    body_parts.append(f"إجمالي المديونية: {balance:,.0f}")
    body_parts.append(f"المبلغ المطلوب سداده: {float(data.amount):,.0f}")
    banks = await db.bank_accounts.find({"active": True, "show_in": "payment_requests"}).to_list(50)
    if banks:
        body_parts.append("")
        body_parts.append("بيانات السداد:")
        for b in banks:
            body_parts.append("")
            body_parts.append(f"{b.get('bank_name','')}")
            body_parts.append(f"اسم الحساب: {b.get('holder_name','')}")
            body_parts.append(f"رقم الحساب: {b.get('account_number','')}")
            if b.get("details"): body_parts.append(f"{b.get('details')}")
    body_parts.append("")
    body_parts.append("شبكة جواد نت اللاسلكية")
    doc["message"] = ((header + "\n\n") if header else "") + "\n".join(body_parts)
    await db.payment_requests.insert_one(doc)
    await audit_log(user, "create", "payment_request", doc["id"], None, {"amount": data.amount})
    return clean_doc(doc)

@api.post("/payment-requests/{rid}/status")
async def set_payment_request_status(rid: str, new_status: str, user=Depends(require_perm("receipts"))):
    if new_status not in ("new","sent","paid","cancelled"):
        raise HTTPException(status_code=400, detail="حالة غير صحيحة")
    await db.payment_requests.update_one({"id": rid}, {"$set": {"status": new_status, "updated_at": now_iso()}})
    doc = await db.payment_requests.find_one({"id": rid})
    if not doc: raise HTTPException(status_code=404, detail="الطلب غير موجود")
    return clean_doc(doc)


# ================= CARD ORDERS (PUBLIC) =================
@api.post("/public/card-order/login")
async def public_login(data: CardOrderPublicLogin):
    # Rate limit: 5 failed in 24h => block
    blocks = await db.public_blocks.find_one({"phone": data.phone})
    if blocks and blocks.get("blocked_until") and blocks["blocked_until"] > now_iso():
        raise HTTPException(status_code=429, detail=f"تم حظر الإدخال بسبب تجاوز عدد المحاولات الفاشلة. مدة الحظر: 24 ساعة")
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "phone": data.phone, "status": "rejected_not_found",
            "reason": "العميل غير موجود", "created_at": now_iso(),
        })
        # Count non-existent-phone attempts toward the same rate limit
        cur = await db.public_blocks.find_one({"phone": data.phone}) or {}
        failed = cur.get("failed", 0) + 1
        update = {"phone": data.phone, "failed": failed, "last_failed_at": now_iso()}
        if failed >= 5:
            block_until = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
            update["blocked_until"] = block_until
            update["blocked_at"] = now_iso()
            update["failed"] = 0
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "title": "تم حظر رقم غير مسجل",
                "message": f"تم حظر الرقم {data.phone} بسبب تجاوز عدد المحاولات الفاشلة (رقم غير مسجل). مدة الحظر: 24 ساعة.",
                "type": "warning", "read": False, "created_at": now_iso(),
            })
        await db.public_blocks.update_one({"phone": data.phone}, {"$set": update}, upsert=True)
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم، عليك بانشاء حساب أولاً")
    if customer.get("password") != data.password:
        # increment failed counter
        cur = await db.public_blocks.find_one({"phone": data.phone}) or {}
        failed = cur.get("failed", 0) + 1
        update = {"phone": data.phone, "failed": failed, "last_failed_at": now_iso()}
        if failed >= 5:
            block_until = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
            update["blocked_until"] = block_until
            update["blocked_at"] = now_iso()
            update["failed"] = 0
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()), "title": "تم حظر عميل",
                "message": f"تم حظر العميل {customer.get('name','')} ({data.phone}) بسبب تجاوز عدد المحاولات الفاشلة. مدة الحظر: 24 ساعة.",
                "type": "warning", "read": False, "created_at": now_iso(),
            })
        await db.public_blocks.update_one({"phone": data.phone}, {"$set": update}, upsert=True)
        raise HTTPException(status_code=401, detail="كلمة السر غير صحيحة")
    if customer.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")
    # Device binding check (single field, no extra query). First-time binds silently.
    bound = customer.get("bound_device")
    incoming = (data.device_id or "").strip()
    if bound and incoming and bound != incoming:
        # Do NOT count as a password-failed attempt; the password was correct.
        raise HTTPException(
            status_code=403,
            detail="الهاتف غير مرتبط بالحساب. إذا قمت باستبدال هاتفك القديم، يرجى التواصل مع خدمة العملاء لطلب كلمة المرور.",
        )
    if not bound and incoming:
        await db.customers.update_one(
            {"id": customer["id"]},
            {"$set": {"bound_device": incoming, "bound_device_at": now_iso()}},
        )
    # reset failed counter on success
    await db.public_blocks.update_one({"phone": data.phone}, {"$set": {"failed": 0}}, upsert=True)
    return {
        "id": customer["id"], "name": customer["name"], "phone": customer["phone"],
        "credit_limit": customer.get("credit_limit", 0), "balance": customer.get("balance", 0),
        "customer_type": customer.get("customer_type", "customer"),
        "available": max(0, customer.get("credit_limit", 0) - customer.get("balance", 0)),
    }

@api.post("/public/card-order/request")
async def public_order(data: CardOrderRequest):
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "phone": data.phone, "status": "rejected_not_found",
            "reason": "العميل غير موجود", "created_at": now_iso(),
        })
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم، عليك بانشاء حساب أولاً")
    if customer.get("password") != data.password:
        raise HTTPException(status_code=401, detail="كلمة السر غير صحيحة")
    if customer.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")
    cat = await db.card_categories.find_one({"id": data.category_id})
    if not cat: raise HTTPException(status_code=404, detail="الفئة غير موجودة")
    # Normalize recipient phone (keep only digits/+). If it equals sender's phone, treat as None.
    recipient = (data.recipient_phone or "").strip()
    if recipient:
        digits = "".join(ch for ch in recipient if ch.isdigit() or ch == "+")
        if len(digits) < 6:
            raise HTTPException(status_code=400, detail="رقم الهاتف المستلم غير صالح")
        recipient = digits
        if recipient == (customer.get("phone") or "").strip():
            recipient = ""  # same as sender; ignore
    # Pick price according to customer type (POS vs regular customer)
    ctype = customer.get("customer_type", "customer")
    unit_price = cat.get("sale_price_pos") if ctype == "pos" else cat.get("sale_price_customer")
    if unit_price is None:
        unit_price = cat.get("sale_price", 0)
    total = unit_price * data.quantity
    limit = customer.get("credit_limit", 0)
    balance = customer.get("balance", 0)
    if limit > 0 and balance + total > limit:
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
            "phone": customer["phone"], "category_id": data.category_id, "category_name": cat.get("name"),
            "quantity": data.quantity, "total": total, "status": "rejected_over_limit",
            "reason": "تجاوز السقف المسموح", "created_at": now_iso(),
        })
        raise HTTPException(status_code=400, detail=OVER_LIMIT_MSG)
    # Reserve NUMBERED cards ONLY. This endpoint never falls back to quantity stock.
    numbered_avail = await db.cards.count_documents({"category_id": data.category_id, "status": "available"})
    if numbered_avail < data.quantity:
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
            "phone": customer["phone"], "category_id": data.category_id, "category_name": cat.get("name"),
            "quantity": data.quantity, "total": total, "status": "rejected_no_stock",
            "reason": "لا تتوفر كمية الكروت المطلوبة", "created_at": now_iso(),
        })
        raise HTTPException(status_code=400, detail="لا تتوفر كمية الكروت المطلوبة")

    cards_reserved = []
    numbered = await db.cards.find({"category_id": data.category_id, "status": "available"}).limit(data.quantity).to_list(data.quantity)
    for c in numbered:
        r = await db.cards.update_one({"id": c["id"], "status": "available"}, {"$set": {"status": "sold", "sold_at": now_iso(), "sold_to": customer["id"]}})
        if r.modified_count == 1:
            cards_reserved.append(c["number"])
    if len(cards_reserved) < data.quantity:
        # Race condition — someone else consumed cards concurrently. Rollback and reject.
        if cards_reserved:
            await db.cards.update_many({"number": {"$in": cards_reserved}}, {"$set": {"status": "available", "sold_at": None, "sold_to": None}})
        await db.card_order_attempts.insert_one({
            "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
            "phone": customer["phone"], "category_id": data.category_id, "category_name": cat.get("name"),
            "quantity": data.quantity, "total": total, "status": "rejected_no_stock",
            "reason": "لا تتوفر كمية الكروت المطلوبة", "created_at": now_iso(),
        })
        raise HTTPException(status_code=400, detail="لا تتوفر كمية الكروت المطلوبة")

    number = await next_gwd_number()
    # Create sale invoice
    sale_doc = {
        "id": str(uuid.uuid4()), "number": number, "type": "sale",
        "customer_id": customer["id"], "customer_name": customer["name"],
        "sale_type": "credit", "source": "public_order",
        "items": [{"category_id": data.category_id, "category_name": cat.get("name"),
                   "quantity": data.quantity, "price": unit_price,
                   "total": total, "card_numbers": cards_reserved, "use_numbered": True}],
        "subtotal": total, "discount": 0, "total": total, "paid": 0, "remaining": total,
        "notes": ("طلب عبر رابط طلب الكرت" + (f" — تحويل إلى: {recipient}" if recipient else "")),
        "recipient_phone": recipient or None,
        "status": "active", "created_at": now_iso(),
    }
    await db.sales.insert_one(sale_doc)
    balance_after = await _adjust_party_balance("customer", customer["id"], total, number, f"مبيعات إلكترونية - طلب كرت {number}")

    # Log attempt as success
    await db.card_order_attempts.insert_one({
        "id": str(uuid.uuid4()), "customer_id": customer["id"], "customer_name": customer["name"],
        "phone": customer["phone"], "category_id": data.category_id, "category_name": cat.get("name"),
        "quantity": data.quantity, "total": total, "cards": cards_reserved,
        "invoice_number": number, "recipient_phone": recipient or None,
        "status": "success", "reason": "",
        "created_at": now_iso(),
    })

    # Create order record
    order_doc = {
        "id": str(uuid.uuid4()), "number": number, "customer_id": customer["id"],
        "customer_name": customer["name"], "phone": customer["phone"],
        "category_id": data.category_id, "category_name": cat.get("name"),
        "quantity": data.quantity, "total": total, "cards": cards_reserved,
        "recipient_phone": recipient or None,
        "quantity_stock_taken": 0,
        "status": "delivered", "created_at": now_iso(),
    }
    await db.orders.insert_one(order_doc)
    notify_msg = f"طلب كرت جديد من {customer['name']}" + (f" — تحويل إلى {recipient}" if recipient else "")
    await notify(f"طلب كرت {number}", notify_msg, "success")
    return {
        "success": True, "cards": cards_reserved,
        "quantity_from_stock": 0, "total": total,
        "recipient_phone": recipient or None,
        "balance_after": balance_after, "message": "تم تنفيذ طلبك بنجاح",
    }

@api.get("/public/card-order/categories")
async def public_categories():
    items = await db.card_categories.find({"status": "active", "show_in_public": {"$ne": False}}).to_list(500)
    result = []
    for c in items:
        numbered_avail = await db.cards.count_documents({"category_id": c["id"], "status": "available"})
        result.append({
            "id": c["id"], "name": c["name"],
            "sale_price": c.get("sale_price", 0),
            "sale_price_customer": c.get("sale_price_customer", c.get("sale_price", 0)),
            "sale_price_pos": c.get("sale_price_pos", c.get("sale_price", 0)),
            "available_numbered": numbered_avail,
        })
    return result


@api.post("/public/card-order/my-orders")
async def public_my_orders(data: CardOrderHistoryIn):
    """Return the authenticated customer's past card orders, optionally within a date range.
    Auth is done via phone+password (same credentials used to place orders)."""
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم")
    if customer.get("password") != data.password:
        raise HTTPException(status_code=401, detail="كلمة السر غير صحيحة")
    if customer.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")

    query: Dict[str, Any] = {"customer_id": customer["id"]}
    if data.start or data.end:
        rng: Dict[str, Any] = {}
        if data.start:
            rng["$gte"] = f"{data.start}T00:00:00+03:00"
        if data.end:
            rng["$lte"] = f"{data.end}T23:59:59+03:00"
        query["created_at"] = rng
    docs = await db.orders.find(query).sort("created_at", -1).limit(500).to_list(500)
    return [clean_doc(o) for o in docs]


@api.post("/public/card-order/my-transfers")
async def public_my_transfers(data: CardOrderHistoryIn):
    """Return transfers where the authenticated customer is the sender."""
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم")
    if customer.get("password") != data.password:
        raise HTTPException(status_code=401, detail="كلمة السر غير صحيحة")
    if customer.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")

    query: Dict[str, Any] = {"sender_id": customer["id"], "status": {"$ne": "cancelled"}}
    if data.start or data.end:
        rng: Dict[str, Any] = {}
        if data.start:
            rng["$gte"] = f"{data.start}T00:00:00+03:00"
        if data.end:
            rng["$lte"] = f"{data.end}T23:59:59+03:00"
        query["created_at"] = rng
    docs = await db.transfers.find(query).sort("created_at", -1).limit(500).to_list(500)
    return [clean_doc(t) for t in docs]


class QuickRechargeListIn(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None

@api.post("/admin/quick-recharge/list")
async def admin_quick_recharge_list(data: QuickRechargeListIn, user=Depends(require_perm("receipts"))):
    """List previous quick-recharge operations (stored as receipts with channel=admin_quick_recharge)."""
    query: Dict[str, Any] = {"channel": "admin_quick_recharge", "status": "active"}
    if data.start or data.end:
        rng: Dict[str, Any] = {}
        if data.start:
            rng["$gte"] = f"{data.start}T00:00:00+03:00"
        if data.end:
            rng["$lte"] = f"{data.end}T23:59:59+03:00"
        query["created_at"] = rng
    docs = await db.receipts.find(query).sort("created_at", -1).limit(500).to_list(500)
    return [clean_doc(r) for r in docs]

class StatementIn(BaseModel):
    phone: str
    password: str
    start: Optional[str] = None  # YYYY-MM-DD
    end: Optional[str] = None    # YYYY-MM-DD

@api.post("/public/card-order/statement")
async def public_customer_statement(data: StatementIn):
    """Return customer + ledger entries for the customer portal statement print.
    Auth via phone+password. Optional date range with correct opening balance."""
    customer = await db.customers.find_one({"phone": data.phone})
    if not customer:
        raise HTTPException(status_code=404, detail="لاتمتلك حساب بهذا الرقم")
    if customer.get("password") != data.password:
        raise HTTPException(status_code=401, detail="كلمة السر غير صحيحة")
    if customer.get("status") == "disabled":
        raise HTTPException(status_code=403, detail="الحساب معطل")

    base_q: Dict[str, Any] = {"party_type": "customer", "party_id": customer["id"]}
    opening_balance = 0.0
    start_iso = f"{data.start}T00:00:00+03:00" if data.start else None
    end_iso = f"{data.end}T23:59:59+03:00" if data.end else None

    if start_iso:
        # Compute opening balance from ALL entries before the start date
        prior = await db.ledger.find({**base_q, "created_at": {"$lt": start_iso}}).sort("created_at", 1).to_list(100000)
        for e in prior:
            opening_balance += (e.get("debit") or 0) - (e.get("credit") or 0)

    rng: Dict[str, Any] = {}
    if start_iso: rng["$gte"] = start_iso
    if end_iso: rng["$lte"] = end_iso
    q = {**base_q, "created_at": rng} if rng else base_q
    entries_raw = await db.ledger.find(q).sort("created_at", 1).to_list(10000)

    entries: List[Dict[str, Any]] = []
    if start_iso and opening_balance != 0:
        entries.append({
            "id": "opening", "op_number": "-",
            "description": f"رصيد افتتاحي حتى {data.start}",
            "debit": opening_balance if opening_balance > 0 else 0,
            "credit": abs(opening_balance) if opening_balance < 0 else 0,
            "balance": opening_balance,
            "created_at": f"{data.start}T00:00:00+03:00",
        })
    # Re-compute running balance across the returned window starting from opening_balance
    running = opening_balance
    for e in entries_raw:
        running += (e.get("debit") or 0) - (e.get("credit") or 0)
        d = clean_doc(e)
        d["balance"] = running
        entries.append(d)

    c = clean_doc(customer)
    c.pop("password", None)
    return {
        "customer": c,
        "entries": entries,
        "range": {"start": data.start, "end": data.end},
        "opening_balance": opening_balance,
        "closing_balance": running,
    }

@api.get("/orders")
async def list_orders(user=Depends(require_perm("card_orders"))):
    items = await db.orders.find().sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(o) for o in items]


# ================= NOTIFICATIONS =================
@api.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    # Admin/staff inbox: system notifications only. Exclude per-customer docs
    # (broadcast messages targeted at customers carry a customer_id / admin_broadcast kind).
    items = await db.notifications.find({
        "customer_id": {"$exists": False},
        "kind": {"$ne": "admin_broadcast"},
    }).sort("created_at", -1).limit(200).to_list(200)
    return [clean_doc(n) for n in items]

@api.get("/notifications/summary")
async def notifications_summary(user=Depends(get_current_user)):
    """Per-user unread counters for the header bells.
    - general_unread: system notifications created after this user last opened the
      notifications page (stored per-user as `notifications_seen_at`). New items make
      it reappear; opening the page clears it — independently for every user.
    - request_unread: pending account-creation requests (shared task queue).
    """
    seen_at = user.get("notifications_seen_at") or ""
    general_q: Dict[str, Any] = {
        "customer_id": {"$exists": False},
        "kind": {"$ne": "admin_broadcast"},
        "category": {"$ne": "account_request"},
    }
    if seen_at:
        general_q["created_at"] = {"$gt": seen_at}
    general_unread = await db.notifications.count_documents(general_q)
    request_unread = await db.notifications.count_documents(
        {"category": "account_request", "read": False}
    )
    return {"general_unread": general_unread, "request_unread": request_unread}

@api.post("/notifications/mark-seen")
async def notifications_mark_seen(user=Depends(get_current_user)):
    """Marks all current system notifications as seen for THIS user (per-user state,
    persisted in the DB) so the general bell counter clears immediately and does not
    reappear on refresh/re-login until a newer notification arrives."""
    await db.users.update_one({"id": user["id"]}, {"$set": {"notifications_seen_at": now_iso()}})
    return {"ok": True}

@api.post("/notifications/{nid}/read")
async def mark_read(nid: str, user=Depends(get_current_user)):
    await db.notifications.update_one({"id": nid}, {"$set": {"read": True}})
    return {"ok": True}

@api.post("/notifications/mark-category-read")
async def mark_category_read(category: str, user=Depends(get_current_user)):
    """Marks all unread notifications of a category as read.
    Persists in DB so the counter does not come back after logout or refresh
    unless new items arrive."""
    if category not in ("account_request", "user_lock", "general"):
        raise HTTPException(status_code=400, detail="فئة غير صحيحة")
    r = await db.notifications.update_many(
        {"category": category, "read": False},
        {"$set": {"read": True, "read_at": now_iso(), "read_by": user.get("username")}},
    )
    return {"ok": True, "updated": r.modified_count}


# ================= STOCK ALERTS (header notifications bell) =================
@api.get("/stock/alerts")
async def stock_alerts(user=Depends(get_current_user)):
    """Low-stock alerts for the header notifications bell. Uses the SAME per-category
    threshold logic as the dashboard (numbered vs quantity, independent thresholds)."""
    cats = await db.card_categories.find().to_list(500)
    alerts = []
    for c in cats:
        avail = await db.cards.count_documents({"category_id": c["id"], "status": "available"})
        stock = await db.stock.find_one({"category_id": c["id"]})
        qty_avail = (stock or {}).get("total", 0) - (stock or {}).get("sold", 0) if stock else 0
        combined = c.get("low_stock_threshold", 20) or 0
        thr_num = c.get("low_stock_numbered")
        thr_qty = c.get("low_stock_quantity")
        if thr_num is None: thr_num = combined
        if thr_qty is None: thr_qty = combined
        if thr_num and thr_num > 0 and avail <= thr_num:
            alerts.append({
                "type": "numbered", "category_id": c["id"], "category_name": c.get("name", ""),
                "available": avail, "threshold": thr_num,
            })
        if thr_qty and thr_qty > 0 and max(0, qty_avail) <= thr_qty:
            alerts.append({
                "type": "quantity", "category_id": c["id"], "category_name": c.get("name", ""),
                "available": max(0, qty_avail), "threshold": thr_qty,
            })
    alerts.sort(key=lambda x: (x["available"], x["type"]))
    return {"count": len(alerts), "alerts": alerts}


# ================= AUDIT =================
@api.get("/audit")
async def list_audit(
    start: Optional[str] = None,
    end: Optional[str] = None,
    q: Optional[str] = None,
    user=Depends(require_perm("users")),
):
    """List audit entries. Optional YYYY-MM-DD `start`/`end` filter (Yemen TZ +03:00)
    and free-text `q` search over username/action/entity."""
    mongo_q: Dict[str, Any] = {}
    if start or end:
        rng: Dict[str, Any] = {}
        if start: rng["$gte"] = f"{start}T00:00:00+03:00"
        if end:   rng["$lte"] = f"{end}T23:59:59+03:00"
        mongo_q["created_at"] = rng
    if q and q.strip():
        rx = {"$regex": _re.escape(q.strip()), "$options": "i"}
        mongo_q["$or"] = [{"username": rx}, {"action": rx}, {"entity": rx}]
    items = await db.audit_logs.find(mongo_q).sort("created_at", -1).limit(1000).to_list(1000)
    return [clean_doc(a) for a in items]


# ================= REPORTS =================
@api.get("/reports/dashboard")
async def dashboard_stats(user=Depends(get_current_user)):
    # Use Yemen local date so operations from 00:00 to 23:59 local time count
    # in the correct day regardless of UTC crossovers.
    now_yem = datetime.now(timezone.utc) + timedelta(hours=3)
    today = now_yem.date().isoformat()
    month = now_yem.strftime("%Y-%m")
    day_start = f"{today}T00:00:00+03:00"
    day_end = f"{today}T23:59:59+03:00"
    # Sales today includes ALL types (cash + credit + electronic) — the sales
    # collection stores every kind, so a single created_at filter is enough.
    sales_all = await db.sales.find({"status": "active"}).to_list(10000)
    sales_today = sum(
        s["total"] for s in sales_all
        if s.get("created_at","") >= day_start and s.get("created_at","") <= day_end
    )
    sales_month = sum(s["total"] for s in sales_all if s["created_at"][:7] == month)
    purchases_all = await db.purchases.find({"status": "active"}).to_list(10000)
    purchases_total = sum(p["total"] for p in purchases_all)
    customers = await db.customers.find().to_list(10000)
    suppliers = await db.suppliers.find().to_list(10000)
    customer_debts = sum(max(0, c.get("balance", 0)) for c in customers if c.get("customer_type") != "pos")
    pos_debts = sum(c.get("balance", 0) for c in customers if c.get("customer_type") == "pos")
    supplier_debts = sum(max(0, -s.get("balance", 0)) for s in suppliers)
    cards_available = await db.cards.count_documents({"status": "available"})
    cards_sold = await db.cards.count_documents({"status": "sold"})
    cards_used = await db.cards.count_documents({"status": "used"})
    users_count = await db.users.count_documents({})
    # inventory value + low-stock alerts (reuse same loop, zero extra queries).
    # Numbered vs quantity are tracked INDEPENDENTLY using per-category thresholds
    # `low_stock_numbered` and `low_stock_quantity`. Falls back to
    # `low_stock_threshold` when either specific threshold is unset.
    cats = await db.card_categories.find().to_list(500)
    inventory_value = 0
    low_stock_alerts = []
    for c in cats:
        avail = await db.cards.count_documents({"category_id": c["id"], "status": "available"})
        stock = await db.stock.find_one({"category_id": c["id"]})
        qty_avail = (stock or {}).get("total", 0) - (stock or {}).get("sold", 0) if stock else 0
        inventory_value += (avail + max(0, qty_avail)) * c.get("purchase_price", 0)
        combined = c.get("low_stock_threshold", 20) or 0
        thr_num = c.get("low_stock_numbered")
        thr_qty = c.get("low_stock_quantity")
        if thr_num is None: thr_num = combined
        if thr_qty is None: thr_qty = combined
        if thr_num and thr_num > 0 and avail <= thr_num:
            low_stock_alerts.append({
                "type": "numbered",
                "category_id": c["id"], "category_name": c.get("name", ""),
                "available": avail, "threshold": thr_num,
            })
        if thr_qty and thr_qty > 0 and max(0, qty_avail) <= thr_qty:
            low_stock_alerts.append({
                "type": "quantity",
                "category_id": c["id"], "category_name": c.get("name", ""),
                "available": max(0, qty_avail), "threshold": thr_qty,
            })
    low_stock_alerts.sort(key=lambda x: (x["available"], x["type"]))
    # recent
    recent_sales = await db.sales.find().sort("created_at", -1).limit(5).to_list(5)
    recent_receipts = await db.receipts.find().sort("created_at", -1).limit(5).to_list(5)
    recent_orders = await db.orders.find().sort("created_at", -1).limit(5).to_list(5)
    # daily chart last 7 days
    daily = {}
    for s in sales_all:
        d = s["created_at"][:10]
        daily[d] = daily.get(d, 0) + s["total"]
    chart = sorted([{"date": k, "value": v} for k, v in daily.items()], key=lambda x: x["date"])[-14:]
    return {
        "sales_today": sales_today,
        "sales_month": sales_month,
        "purchases_total": purchases_total,
        "customer_debts": customer_debts,
        "pos_debts": pos_debts,
        "supplier_debts": supplier_debts,
        "inventory_value": inventory_value,
        "cards_available": cards_available,
        "cards_sold": cards_sold,
        "cards_used": cards_used,
        "low_stock_alerts": low_stock_alerts,
        "customers_count": len(customers),
        "suppliers_count": len(suppliers),
        "users_count": users_count,
        "recent_sales": [clean_doc(s) for s in recent_sales],
        "recent_receipts": [clean_doc(r) for r in recent_receipts],
        "recent_orders": [clean_doc(o) for o in recent_orders],
        "pending_register_requests": await db.register_requests.count_documents({"status": "pending"}),
        "chart": chart,
    }

@api.get("/reports/sales")
async def report_sales(start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_perm("reports"))):
    q: Dict[str, Any] = {"status": "active"}
    if start and end:
        q["created_at"] = {"$gte": start, "$lte": end + "T23:59:59"}
    items = await db.sales.find(q).sort("created_at", -1).to_list(5000)
    return [clean_doc(s) for s in items]

@api.get("/reports/purchases")
async def report_purchases(start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_perm("reports"))):
    q: Dict[str, Any] = {"status": "active"}
    if start and end:
        q["created_at"] = {"$gte": start, "$lte": end + "T23:59:59"}
    items = await db.purchases.find(q).sort("created_at", -1).to_list(5000)
    return [clean_doc(p) for p in items]

@api.get("/reports/customer-debts")
async def report_customer_debts(user=Depends(require_perm("reports"))):
    items = await db.customers.find().to_list(10000)
    return [clean_doc(c) for c in items if c.get("balance", 0) > 0]

@api.get("/reports/supplier-debts")
async def report_supplier_debts(user=Depends(require_perm("reports"))):
    items = await db.suppliers.find().to_list(10000)
    # المورد دائن عندما نكون مدينين له (رصيد سالب). نعرض المديونية كقيمة موجبة.
    return [{**clean_doc(s), "balance": -s.get("balance", 0)} for s in items if s.get("balance", 0) < 0]


# ================= REGISTER REQUESTS =================
@api.get("/register-requests")
async def list_register_requests(user=Depends(require_perm("customers"))):
    items = await db.register_requests.find().sort("created_at", -1).to_list(1000)
    return [clean_doc(r) for r in items]

class ApproveRegisterIn(BaseModel):
    credit_limit: float = 0
    customer_type: str = "customer"
    password: Optional[str] = None

@api.post("/register-requests/{rid}/approve")
async def approve_register(rid: str, data: ApproveRegisterIn, user=Depends(require_perm("customers"))):
    req = await db.register_requests.find_one({"id": rid})
    if not req: raise HTTPException(status_code=404, detail="غير موجود")
    if req.get("status") == "approved":
        raise HTTPException(status_code=400, detail="تمت الموافقة مسبقاً")
    exists = await db.customers.find_one({"phone": req["phone"]}, {"_id": 1})
    if exists:
        await db.register_requests.update_one({"id": rid}, {"$set": {"status": "duplicate", "approved_at": now_iso()}})
        raise HTTPException(status_code=400, detail="رقم الهاتف مرتبط بحساب عميل آخر.")
    pwd = data.password or random_password()
    doc = {
        "id": str(uuid.uuid4()), "name": req["full_name"], "phone": req["phone"],
        "address": req.get("address", ""), "password": pwd,
        "credit_limit": data.credit_limit, "opening_balance": 0, "balance": 0,
        "notes": f"تمت الموافقة على طلب #{rid[:8]}", "status": "active",
        "customer_type": data.customer_type,
        "created_at": now_iso(), "created_by": user.get("username"),
    }
    await db.customers.insert_one(doc)
    await db.register_requests.update_one({"id": rid}, {"$set": {"status": "approved", "approved_at": now_iso(), "customer_id": doc["id"]}})
    await audit_log(user, "approve_register_request", "customer", doc["id"], None, {"name": doc["name"]})
    # WhatsApp welcome message ready for the frontend to open
    phone_digits = "".join(ch for ch in req["phone"] if ch.isdigit() or ch == "+")
    wa_phone = phone_digits.lstrip("+").lstrip("0")
    if not wa_phone.startswith("967"):
        wa_phone = "967" + wa_phone
    body = (
        f"مرحباً بك {req['full_name']} 👋\n\n"
        f"تم إنشاء حسابك بنجاح في شبكة جواد نت اللاسلكية.\n\n"
        f"📱 رقم الهاتف: {req['phone']}\n"
        f"🔑 كلمة المرور: {pwd}\n\n"
        f"يمكنك الآن تسجيل الدخول وطلب الكروت مباشرة.\n"
        f"نرحب بك في عائلة جواد نت — نتمنى لك تجربة رائعة."
    )
    from urllib.parse import quote
    wa_url = f"https://wa.me/{wa_phone}?text={quote(body)}"
    return {"ok": True, "customer": clean_doc(doc), "whatsapp_url": wa_url, "phone": req["phone"], "password": pwd}

@api.post("/register-requests/{rid}/reject")
async def reject_register(rid: str, user=Depends(require_perm("customers"))):
    await db.register_requests.update_one({"id": rid}, {"$set": {"status": "rejected", "rejected_at": now_iso()}})
    return {"ok": True}


# ================= USER LOCK / DEVICE MGMT (ADMIN) =================
@api.post("/users/{uid}/unlock")
async def user_unlock(uid: str, user=Depends(require_perm("users"))):
    u = await db.users.find_one({"id": uid})
    if not u: raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    await db.users.update_one({"id": uid}, {"$set": {"failed_attempts": 0, "locked_until": None, "unlocked_at": now_iso(), "unlocked_by": user.get("username")}})
    await audit_log(user, "unlock", "user", uid)
    return {"ok": True}

@api.post("/users/{uid}/reset-attempts")
async def user_reset_attempts(uid: str, user=Depends(require_perm("users"))):
    await db.users.update_one({"id": uid}, {"$set": {"failed_attempts": 0}})
    await audit_log(user, "reset_attempts", "user", uid)
    return {"ok": True}

@api.post("/users/{uid}/unbind-device")
async def user_unbind_device(uid: str, user=Depends(require_perm("users"))):
    u = await db.users.find_one({"id": uid})
    if not u: raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    await db.users.update_one({"id": uid}, {"$unset": {"bound_device": "", "bound_device_at": ""}, "$set": {"unbound_at": now_iso(), "unbound_by": user.get("username")}})
    await audit_log(user, "unbind_device", "user", uid)
    return {"ok": True}


# ================= BLOCK MGMT =================
@api.get("/public-blocks")
async def list_blocks(user=Depends(require_perm("customers"))):
    items = await db.public_blocks.find().to_list(1000)
    return [clean_doc(b) for b in items]

@api.post("/public-blocks/{phone}/unblock")
async def unblock(phone: str, user=Depends(require_perm("customers"))):
    await db.public_blocks.update_one({"phone": phone}, {"$set": {"failed": 0, "blocked_until": None, "unblocked_at": now_iso(), "unblocked_by": user.get("username")}})
    await audit_log(user, f"فك الحظر: {phone}", "customer", phone)
    # WhatsApp URL
    from urllib.parse import quote
    cust = await db.customers.find_one({"phone": phone})
    name = (cust or {}).get("name", "")
    phone_digits = "".join(ch for ch in phone if ch.isdigit()).lstrip("0")
    wa_phone = "967" + phone_digits if (phone_digits and not phone_digits.startswith("967")) else phone_digits
    body = (
        f"مرحباً {name} 👋\n\n"
        f"تم فك الحظر عن حسابك في شبكة جواد نت اللاسلكية.\n\n"
        f"📱 رقم الهاتف: {phone}\n\n"
        f"يمكنك الآن تسجيل الدخول إلى حسابك."
    )
    wa_url = f"https://wa.me/{wa_phone}?text={quote(body)}" if wa_phone else ""
    return {"ok": True, "whatsapp_url": wa_url}


# ================= RESET DATA =================
class ResetDataIn(BaseModel):
    username: str
    password: str
    confirm: bool = False

@api.post("/settings/reset-data")
async def reset_data(data: ResetDataIn, user=Depends(require_perm("settings"))):
    if not data.confirm:
        raise HTTPException(status_code=400, detail="يجب التأكيد")
    verify = await db.users.find_one({"username": data.username})
    if not verify or not verify_password(data.password, verify.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="بيانات الاعتماد غير صحيحة")
    if verify.get("role") != "admin":
        raise HTTPException(status_code=403, detail="يتطلب صلاحية المدير")
    # Wipe everything except users, settings, invoice_sequences
    collections_to_wipe = [
        "customers", "suppliers", "card_categories", "cards", "stock",
        "sales", "purchases", "receipts", "ledger", "orders", "notifications",
        "audit_logs", "register_requests", "card_order_attempts", "public_blocks",
    ]
    for c in collections_to_wipe:
        await db[c].delete_many({})
    # Reset GWD counter
    await db.settings.update_one({"key": "gwd_sequence"}, {"$set": {"value": 0}}, upsert=True)
    await audit_log(user, "reset_all_data", "system", "", None, {"by": data.username})
    return {"ok": True, "message": "تم مسح جميع البيانات"}


# ================= BACKUP =================
@api.get("/backup/export")
async def backup_export(user=Depends(require_perm("backup"))):
    from fastapi.encoders import jsonable_encoder
    collections = ["customers","suppliers","card_categories","cards","stock","sales","purchases","receipts","ledger","orders","notifications","audit_logs","register_requests","card_order_attempts","public_blocks","users","settings"]
    def _deep(v):
        if isinstance(v, dict):
            return {k: _deep(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_deep(x) for x in v]
        return v
    dump = {}
    for c in collections:
        docs = await db[c].find().to_list(50000)
        dump[c] = [_deep(clean_doc(d)) for d in docs]
    dump["_exported_at"] = now_iso()
    return jsonable_encoder(dump, custom_encoder={bytes: lambda b: b.decode(errors="replace")})

class BackupRestoreIn(BaseModel):
    data: Dict[str, Any]

@api.post("/backup/restore")
async def backup_restore(payload: BackupRestoreIn, user=Depends(require_perm("backup"))):
    # Snapshot current before restore
    snapshot_id = str(uuid.uuid4())
    snapshot = {}
    collections = ["customers","suppliers","card_categories","cards","stock","sales","purchases","receipts","ledger","orders","notifications","audit_logs"]
    for c in collections:
        docs = await db[c].find().to_list(50000)
        snapshot[c] = [clean_doc(d) for d in docs]
    await db.backup_snapshots.insert_one({"id": snapshot_id, "data": snapshot, "created_at": now_iso(), "reason": "pre_restore"})
    # Wipe & restore
    data = payload.data
    for c in collections:
        if c in data:
            await db[c].delete_many({})
            if data[c]:
                await db[c].insert_many(data[c])
    await audit_log(user, "restore_backup", "system", snapshot_id)
    return {"ok": True, "snapshot_id": snapshot_id}


# ================= AUTOMATED CLOUD BACKUP =================
BACKUP_COLLECTIONS = [
    "customers","suppliers","card_categories","cards","stock","sales","purchases",
    "receipts","ledger","orders","notifications","audit_logs","register_requests",
    "card_order_attempts","public_blocks","users","settings","files",
]

async def _build_backup_snapshot() -> Dict[str, Any]:
    from fastapi.encoders import jsonable_encoder
    def _deep(v):
        if isinstance(v, dict):
            return {k: _deep(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_deep(x) for x in v]
        return v
    dump: Dict[str, Any] = {}
    for c in BACKUP_COLLECTIONS:
        docs = await db[c].find().to_list(100000)
        dump[c] = [_deep(clean_doc(d)) for d in docs]
    dump["_exported_at"] = now_iso()
    dump["_company"] = COMPANY_NAME
    return jsonable_encoder(dump, custom_encoder={bytes: lambda b: b.decode(errors="replace")})

async def _run_backup_job(trigger: str = "manual") -> Dict[str, Any]:
    """Create a snapshot, gzip-compress, upload to object storage, save metadata,
    and (best-effort) email the download link to the configured backup_email."""
    snapshot = await _build_backup_snapshot()
    raw = json.dumps(snapshot, ensure_ascii=False).encode("utf-8")
    gz = gzip.compress(raw, compresslevel=6)

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    file_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    storage_path = f"{APP_NAME}/backups/{day}/{file_id}.json.gz"

    # Upload to Emergent Object Storage
    result = _put_object(storage_path, gz, "application/gzip")

    rec = {
        "id": file_id,
        "storage_path": result.get("path", storage_path),
        "original_filename": f"jawad-backup-{day}.json.gz",
        "size": result.get("size", len(gz)),
        "raw_size": len(raw),
        "content_type": "application/gzip",
        "download_token": token,
        "token_expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
        "trigger": trigger,
        "collections": list(snapshot.keys()),
        "created_at": now_iso(),
    }
    await db.backup_files.insert_one(rec)

    # Retain only last 14 backup records + delete their objects (best-effort)
    old = await db.backup_files.find().sort("created_at", -1).skip(14).to_list(500)
    for o in old:
        try:
            await db.backup_files.delete_one({"id": o["id"]})
        except Exception:
            pass

    # Send email (best-effort — do not fail the whole job if email fails)
    email_id = None
    email_error = None
    settings_doc = await db.settings.find_one({"key": "app_settings"}) or {}
    to_addr = (settings_doc.get("backup_email") or "").strip()
    if to_addr and PUBLIC_BASE_URL:
        link = f"{PUBLIC_BASE_URL}/api/backup/download/{token}"
        subject = f"نسخة احتياطية جديدة — {EMAIL_FROM_NAME} — {day}"
        size_kb = f"{len(gz)/1024:.1f} KB"
        html = (
            '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#f6f6fb;padding:24px">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;'
            'box-shadow:0 2px 8px rgba(0,0,0,0.05);overflow:hidden">'
            '<tr><td style="background:#221340;padding:20px 24px;color:#fff">'
            f'<div style="font-size:18px;font-weight:bold">{_html_escape(EMAIL_FROM_NAME)}</div>'
            '<div style="font-size:13px;opacity:.85;margin-top:4px">النسخ الاحتياطي التلقائي</div>'
            '</td></tr>'
            '<tr><td style="padding:24px;color:#221340">'
            f'<p style="font-size:15px;line-height:1.7">تم إنشاء نسخة احتياطية جديدة من قاعدة بيانات {_html_escape(EMAIL_FROM_NAME)} بنجاح بتاريخ <strong>{_html_escape(day)}</strong>.</p>'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="background:#f6f4fb;border-radius:8px;padding:12px;margin:12px 0">'
            f'<tr><td style="padding:6px 10px;font-size:13px">حجم الملف المضغوط: <strong>{_html_escape(size_kb)}</strong></td></tr>'
            f'<tr><td style="padding:6px 10px;font-size:13px">عدد المجموعات: <strong>{len(BACKUP_COLLECTIONS)}</strong></td></tr>'
            f'<tr><td style="padding:6px 10px;font-size:13px">مصدر التشغيل: <strong>{_html_escape(trigger)}</strong></td></tr>'
            '</table>'
            f'<p style="font-size:14px;margin-top:20px">لتحميل الملف اضغط الزر أدناه (صالح لمدة 14 يوماً):</p>'
            f'<p style="margin:20px 0"><a href="{link}" style="background:#452480;color:#fff;text-decoration:none;'
            'padding:12px 24px;border-radius:6px;font-weight:bold;display:inline-block">تحميل النسخة الاحتياطية</a></p>'
            '<p style="font-size:12px;color:#666;margin-top:24px;padding-top:16px;border-top:1px solid #eee">'
            f'أُرسل بواسطة {_html_escape(EMAIL_FROM_NAME)}. لن نطلب منك كلمة المرور أو أي بيانات حساسة عبر البريد.'
            '</p>'
            '</td></tr></table></div>'
        )
        try:
            email_id = await send_email(to=to_addr, subject=subject, html=html)
        except HTTPException as e:
            email_error = f"{e.status_code}: {e.detail}"
            logger.error(f"Backup email failed: {email_error}")
        except Exception as e:
            email_error = str(e)
            logger.error(f"Backup email failed: {e}")

    await db.backup_files.update_one(
        {"id": file_id},
        {"$set": {"email_sent_to": to_addr or None, "email_id": email_id, "email_error": email_error}},
    )

    return {
        "ok": True,
        "backup_id": file_id,
        "size": len(gz),
        "raw_size": len(raw),
        "email_sent": bool(email_id),
        "email_error": email_error,
        "email_to": to_addr or None,
        "download_link": f"{PUBLIC_BASE_URL}/api/backup/download/{token}" if PUBLIC_BASE_URL else None,
    }

@api.post("/backup/run-now")
async def backup_run_now(user=Depends(require_perm("backup"))):
    """Admin-triggered manual cloud backup (upload + email)."""
    res = await _run_backup_job(trigger=f"manual:{user.get('username')}")
    await audit_log(user, "run_backup", "system", res["backup_id"])
    return res

@api.get("/backup/latest")
async def backup_latest(user=Depends(require_perm("backup"))):
    """Return metadata of the most recent cloud backup (no download token)."""
    rec = await db.backup_files.find().sort("created_at", -1).limit(1).to_list(1)
    if not rec:
        return {"exists": False}
    d = clean_doc(rec[0])
    d.pop("download_token", None)
    d["exists"] = True
    return d

class RestoreLatestIn(BaseModel):
    confirm: bool = False

@api.post("/backup/restore-latest")
async def backup_restore_latest(payload: RestoreLatestIn, user=Depends(require_perm("backup"))):
    """Restore the most recent cloud backup. Creates a pre-restore safety snapshot first."""
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="التأكيد مطلوب")
    rec = await db.backup_files.find().sort("created_at", -1).limit(1).to_list(1)
    if not rec:
        raise HTTPException(status_code=404, detail="لا توجد نسخة احتياطية سحابية")
    meta = rec[0]
    try:
        data_gz, _ = _get_object(meta["storage_path"])
        raw = gzip.decompress(data_gz)
        snapshot = json.loads(raw.decode("utf-8"))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل قراءة النسخة: {e}")

    # Safety: snapshot current data before wipe
    safety_id = str(uuid.uuid4())
    safety: Dict[str, Any] = {}
    for c in BACKUP_COLLECTIONS:
        docs = await db[c].find().to_list(100000)
        safety[c] = [clean_doc(d) for d in docs]
    await db.backup_snapshots.insert_one({
        "id": safety_id, "data": safety, "created_at": now_iso(),
        "reason": "pre_restore_latest", "source_backup_id": meta.get("id"),
    })

    # Skip restoring users so the admin session survives; also skip settings key
    protected = {"users"}
    restored: Dict[str, int] = {}
    for c in BACKUP_COLLECTIONS:
        if c in protected: continue
        if c in snapshot and isinstance(snapshot[c], list):
            await db[c].delete_many({})
            if snapshot[c]:
                # strip Mongo _id if any leaked
                docs = [{k: v for k, v in d.items() if k != "_id"} for d in snapshot[c]]
                await db[c].insert_many(docs)
                restored[c] = len(docs)
            else:
                restored[c] = 0
    await audit_log(user, "restore_latest_cloud", "system", meta.get("id", ""))
    return {
        "ok": True,
        "source_backup_id": meta.get("id"),
        "source_created_at": meta.get("created_at"),
        "safety_snapshot_id": safety_id,
        "restored": restored,
        "total_docs": sum(restored.values()),
    }

@api.get("/backup/list")
async def backup_list(user=Depends(require_perm("backup"))):
    docs = await db.backup_files.find().sort("created_at", -1).limit(30).to_list(30)
    out = []
    for d in docs:
        c = clean_doc(d)
        c.pop("download_token", None)
        out.append(c)
    return out

@api.get("/backup/download/{token}")
async def backup_download(token: str):
    """Time-limited public download using an unguessable token embedded in the
    email link (first-party HTTPS magic link). Token is stored server-side."""
    if not token or len(token) < 16:
        raise HTTPException(status_code=404, detail="رابط غير صالح")
    rec = await db.backup_files.find_one({"download_token": token})
    if not rec:
        raise HTTPException(status_code=404, detail="النسخة الاحتياطية غير موجودة")
    exp = rec.get("token_expires_at")
    if exp:
        try:
            if datetime.fromisoformat(exp) < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="انتهت صلاحية الرابط")
        except HTTPException:
            raise
        except Exception:
            pass
    data, ct = _get_object(rec["storage_path"])
    fname = rec.get("original_filename") or "backup.json.gz"
    return Response(
        content=data,
        media_type=rec.get("content_type") or ct,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )

# --- Cron webhook (Emergent platform crons) ---
def _verify_cron_auth(authorization: Optional[str]) -> None:
    if not WEBHOOK_CRON_SECRET:
        raise HTTPException(status_code=503, detail="Cron secret not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    got = authorization.split(" ", 1)[1].strip()
    if not hmac.compare_digest(got, WEBHOOK_CRON_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")

async def _cron_backup_worker():
    """Runs in the background so the webhook can 2xx immediately."""
    try:
        settings_doc = await db.settings.find_one({"key": "app_settings"}) or {}
        if not bool(settings_doc.get("backup_auto", False)):
            logger.info("Daily backup skipped: backup_auto=False")
            return
        res = await _run_backup_job(trigger="cron:daily")
        logger.info(f"Daily backup done: {res.get('backup_id')} email_sent={res.get('email_sent')}")
    except Exception as e:
        logger.error(f"Daily backup worker error: {e}")

@api.post("/cron/daily-backup")
async def cron_daily_backup(
    background_tasks: BackgroundTasks,
    request: Request,
    authorization: Optional[str] = Header(None),
    x_webhook_id: Optional[str] = Header(None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _verify_cron_auth(authorization)
    run_id = x_webhook_id or ""
    if run_id:
        try:
            # Idempotency: skip if we've already handled this run id
            existing = await db.cron_runs.find_one({"run_id": run_id})
            if existing:
                return {"ok": True, "duplicate": True}
            await db.cron_runs.insert_one({"run_id": run_id, "at": now_iso(), "name": "daily-backup"})
        except Exception:
            pass
    background_tasks.add_task(_cron_backup_worker)
    return {"ok": True, "queued": True}


# ================= CUSTOMER PASSWORD REVEAL =================
@api.post("/customers/{cid}/unbind-device")
async def unbind_customer_device(cid: str, user=Depends(require_perm("customers"))):
    """Clear the customer's bound device so the next successful login (with the
    new/reset password) binds the new phone automatically."""
    doc = await db.customers.find_one({"id": cid})
    if not doc: raise HTTPException(status_code=404, detail="غير موجود")
    old_device = doc.get("bound_device")
    await db.customers.update_one(
        {"id": cid},
        {"$set": {"bound_device": None, "bound_device_at": None},
         "$push": {"device_history": {"unbound_at": now_iso(), "unbound_by": user.get("username"), "was": old_device}}},
    )
    await audit_log(user, "unbind_customer_device", "customer", cid, {"name": doc.get("name",""), "phone": doc.get("phone","")}, None)
    # Prepare WhatsApp notification the admin can send to the customer
    from urllib.parse import quote
    phone_digits = "".join(ch for ch in (doc.get("phone") or "") if ch.isdigit()).lstrip("0")
    wa_phone = "967" + phone_digits if (phone_digits and not phone_digits.startswith("967")) else phone_digits
    body = (
        f"مرحباً {doc.get('name','')} 👋\n\n"
        f"تم فك ربط جهازك السابق عن حسابك في شبكة جواد نت اللاسلكية.\n\n"
        f"📱 رقم الهاتف: {doc.get('phone','')}\n\n"
        f"يمكنك الآن تسجيل الدخول من جهاز جديد وسيتم ربطه تلقائياً بعد أول دخول ناجح.\n"
        f"إذا لم تطلب هذه العملية فتواصل معنا فوراً."
    )
    wa_url = f"https://wa.me/{wa_phone}?text={quote(body)}" if wa_phone else ""
    return {"ok": True, "whatsapp_url": wa_url}


@api.get("/customers/{cid}/password")
async def get_customer_password(cid: str, user=Depends(require_perm("customers"))):
    c = await db.customers.find_one({"id": cid})
    if not c: raise HTTPException(status_code=404)
    return {"password": c.get("password", "")}


# ================= SEARCH =================
@api.get("/search")
async def global_search(q: str, user=Depends(get_current_user)):
    result = {}
    result["sales"] = [clean_doc(s) for s in await db.sales.find({"number": {"$regex": q, "$options": "i"}}).limit(10).to_list(10)]
    result["purchases"] = [clean_doc(s) for s in await db.purchases.find({"number": {"$regex": q, "$options": "i"}}).limit(10).to_list(10)]
    result["receipts"] = [clean_doc(s) for s in await db.receipts.find({"number": {"$regex": q, "$options": "i"}}).limit(10).to_list(10)]
    result["customers"] = [clean_doc(c) for c in await db.customers.find({"$or": [{"name": {"$regex": q, "$options": "i"}}, {"phone": {"$regex": q, "$options": "i"}}]}).limit(10).to_list(10)]
    result["cards"] = [clean_doc(c) for c in await db.cards.find({"number": {"$regex": q, "$options": "i"}}).limit(10).to_list(10)]
    return result


# ================= SETTINGS =================
@api.get("/settings")
async def get_settings(user=Depends(get_current_user)):
    doc = await db.settings.find_one({"key": "app_settings"}) or {}
    return {
        "company_name": COMPANY_NAME,
        "company_phone": COMPANY_PHONE,
        "currency": doc.get("currency", "ريال"),
        "logo_url": doc.get("logo_url", ""),
        "low_stock_default": doc.get("low_stock_default", 20),
        "backup_email": doc.get("backup_email", ""),
        "backup_time": doc.get("backup_time", "02:00"),
        "backup_auto": bool(doc.get("backup_auto", False)),
        "install_allowed_emails": doc.get("install_allowed_emails", ["mofeedaldhlaa@gmail.com"]),
    }

@api.post("/settings")
async def update_settings(data: SettingsIn, user=Depends(require_perm("settings"))):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    # Validate backup_email format at the API boundary
    if "backup_email" in update:
        v = (update["backup_email"] or "").strip()
        if v:
            import re
            if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", v):
                raise HTTPException(status_code=400, detail="البريد الإلكتروني غير صحيح")
        update["backup_email"] = v
    if "install_allowed_emails" in update:
        emails = [str(e).strip().lower() for e in (update["install_allowed_emails"] or []) if str(e).strip()]
        import re
        rx = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
        bad = [e for e in emails if not rx.match(e)]
        if bad:
            raise HTTPException(status_code=400, detail=f"إيميل غير صحيح: {bad[0]}")
        update["install_allowed_emails"] = emails
    await db.settings.update_one({"key": "app_settings"}, {"$set": update}, upsert=True)
    return {"ok": True}


# ================= FILES (Object storage) =================
MAX_UPLOAD_MB = 25

@api.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"حجم الملف أكبر من {MAX_UPLOAD_MB} ميجابايت")
    name = (file.filename or "file").strip()
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "bin"
    path = f"{APP_NAME}/uploads/{user.get('id') or user.get('username')}/{uuid.uuid4()}.{ext}"
    ct = file.content_type or "application/octet-stream"
    result = _put_object(path, data, ct)
    doc = {
        "id": str(uuid.uuid4()),
        "storage_path": result.get("path", path),
        "original_filename": name,
        "content_type": ct,
        "size": result.get("size", len(data)),
        "entity_type": entity_type or "general",
        "entity_id": entity_id,
        "uploaded_by": user.get("username"),
        "is_deleted": False,
        "created_at": now_iso(),
    }
    await db.files.insert_one(doc)
    return clean_doc(doc)

@api.get("/files")
async def list_files(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    q: Dict[str, Any] = {"is_deleted": False}
    if entity_type: q["entity_type"] = entity_type
    if entity_id: q["entity_id"] = entity_id
    docs = await db.files.find(q).sort("created_at", -1).limit(500).to_list(500)
    return [clean_doc(d) for d in docs]

@api.get("/files/{fid}/download")
async def download_file(fid: str, authorization: Optional[str] = Header(None), auth: Optional[str] = Query(None)):
    # Accept auth via header OR ?auth=<jwt> so <img src> / <a href> can work without JS wrappers.
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    elif auth:
        token = auth
    if not token: raise HTTPException(status_code=401, detail="مطلوب مصادقة")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        u = await db.users.find_one({"id": payload.get("sub")})
        if not u or u.get("status") == "disabled": raise Exception()
    except Exception:
        raise HTTPException(status_code=401, detail="جلسة غير صالحة")
    rec = await db.files.find_one({"id": fid, "is_deleted": False})
    if not rec: raise HTTPException(status_code=404, detail="الملف غير موجود")
    data, ct = _get_object(rec["storage_path"])
    return Response(content=data, media_type=rec.get("content_type") or ct,
                    headers={"Content-Disposition": f'inline; filename="{rec.get("original_filename","file")}"'})

@api.delete("/files/{fid}")
async def delete_file(fid: str, user=Depends(get_current_user)):
    rec = await db.files.find_one({"id": fid, "is_deleted": False})
    if not rec: raise HTTPException(status_code=404, detail="الملف غير موجود")
    await db.files.update_one({"id": fid}, {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": user.get("username")}})
    return {"ok": True}


# ================= STARTUP =================
@app.on_event("startup")
async def startup():
    # Object storage
    try:
        if init_storage():
            logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    # Indexes
    await db.users.create_index("username", unique=True)
    await db.customers.create_index("phone")
    await db.cards.create_index("number", unique=True)
    await db.sales.create_index("number", unique=True)
    await db.sales.create_index("idempotency_key")
    await db.purchases.create_index("number", unique=True)
    await db.purchases.create_index("idempotency_key")
    await db.transfers.create_index("number")
    await db.transfers.create_index("idempotency_key")
    await db.stock_ops.create_index("category_id")
    await db.stock_ops.create_index("created_at")
    await db.currencies.create_index("symbol", unique=True)
    await db.payment_requests.create_index("party_id")
    await db.payment_requests.create_index("idempotency_key")
    await db.receipts.create_index("number", unique=True)
    await db.receipts.create_index("idempotency_key")
    # Seed admin — per-deploy default admin
    # A brand-new default admin is created on every code update / redeploy.
    # We identify a deploy by the SHA-256 of the running server.py file
    # (changes on every code change). The `deployments` collection remembers
    # which release_ids we have already seeded so restart within the same
    # release does NOT create duplicates.
    # Existing admins are NEVER modified, downgraded, deleted, or reset.
    import hashlib, secrets as _secrets
    try:
        _server_path = os.path.abspath(__file__)
        with open(_server_path, "rb") as _fh:
            _server_bytes = _fh.read()
        release_id = hashlib.sha256(_server_bytes).hexdigest()[:16]
    except Exception:
        release_id = os.environ.get("RELEASE_ID") or "unknown"

    already_seeded = await db.deployments.find_one({"release_id": release_id})
    if not already_seeded:
        short = release_id[:6]
        # Random unique username per deploy — prefix keeps them recognisable
        while True:
            candidate = f"admin_r{short}_{_secrets.token_hex(2)}"
            if not await db.users.find_one({"username": candidate}):
                break
        # Fresh strong password (12 chars). Password_hash goes to DB; plaintext
        # is written to server logs only (never returned to any client) so the
        # operator can retrieve it from the log stream.
        plain_pwd = _secrets.token_urlsafe(9)
        new_admin_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": new_admin_id,
            "name": f"مدير النظام (إصدار {short})",
            "username": candidate,
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(plain_pwd),
            "role": "admin",
            "status": "active",
            "permissions": ALL_PERMS,
            "created_at": now_iso(),
            "created_by": "system-deploy-seed",
            "release_id": release_id,
        })
        # Detach any test-only bindings on the new admin (fresh account so
        # nothing should be bound, but we normalise the state to be safe):
        await db.users.update_one(
            {"id": new_admin_id},
            {"$unset": {"bound_device": "", "bound_device_at": "", "locked_until": ""},
             "$set": {"failed_attempts": 0}},
        )
        await db.deployments.insert_one({
            "release_id": release_id,
            "seeded_at": now_iso(),
            "admin_username": candidate,
            "admin_user_id": new_admin_id,
        })
        logger.warning(
            f"[DEPLOY-SEED] release={release_id} created new default admin "
            f"username={candidate}  password={plain_pwd}  "
            f"(stored securely as bcrypt in DB; use once, then rotate)"
        )
    else:
        logger.info(f"[DEPLOY-SEED] release={release_id} admin already seeded — skipping.")

    _existing_admin_any = await db.users.find_one({"role": "admin"})
    if not _existing_admin_any:
        logger.info("No admin user present; the FIRST user created via /api/users will become the system admin.")
    # Seed default categories if empty
    cats_count = await db.card_categories.count_documents({})
    if cats_count == 0:
        defaults = [
            {"name": "200 ريال", "value": 200, "sale_price": 200, "purchase_price": 180, "validity_days": 30, "data_size": "5GB"},
            {"name": "300 ريال", "value": 300, "sale_price": 300, "purchase_price": 270, "validity_days": 30, "data_size": "10GB"},
            {"name": "500 ريال", "value": 500, "sale_price": 500, "purchase_price": 450, "validity_days": 30, "data_size": "20GB"},
            {"name": "1000 ريال", "value": 1000, "sale_price": 1000, "purchase_price": 900, "validity_days": 30, "data_size": "50GB"},
            {"name": "3000 ريال", "value": 3000, "sale_price": 3000, "purchase_price": 2700, "validity_days": 90, "data_size": "200GB"},
            {"name": "5000 ريال", "value": 5000, "sale_price": 5000, "purchase_price": 4500, "validity_days": 180, "data_size": "unlimited"},
        ]
        for d in defaults:
            await db.card_categories.insert_one({
                **d, "id": str(uuid.uuid4()), "status": "active",
                "notes": "", "low_stock_threshold": 20, "created_at": now_iso(),
            })

@app.on_event("shutdown")
async def shutdown():
    client.close()

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)

# deploy marker 1789146047.5735972
