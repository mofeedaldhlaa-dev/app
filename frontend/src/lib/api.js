import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwd_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Determine if a request/URL belongs to the isolated customer portal (public/*)
const isPublicRequest = (error) => {
  const url = error?.config?.url || "";
  return url.includes("/public/");
};

// Determine if the current page is the customer portal, so we never redirect
// customers to the admin login on auth errors.
const isCustomerPortalPage = () => {
  const p = window.location.pathname || "";
  return p === "/order" || p === "/order-card" || p.startsWith("/order/") || p.startsWith("/order-card/");
};

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      // Only redirect to admin login for ADMIN requests from ADMIN pages.
      // Customer-portal requests (/public/*) and pages (/order, /order-card)
      // must handle errors locally without any redirect.
      if (!isPublicRequest(error) && !isCustomerPortalPage() && !window.location.pathname.includes("/mof30")) {
        localStorage.removeItem("jwd_token");
        window.location.href = "/mof30";
      }
    }
    return Promise.reject(error);
  }
);

export const errText = (e) => {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || "حدث خطأ";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join(" - ");
  return JSON.stringify(d);
};

export default api;
