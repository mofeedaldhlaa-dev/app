import { createContext, useContext, useEffect, useState } from "react";
import api, { errText } from "./api";
import { deviceId } from "./utils";

const Ctx = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(undefined); // undefined=loading, null=guest, obj=user
  const [error, setError] = useState("");

  useEffect(() => {
    const tok = localStorage.getItem("jwd_token");
    if (!tok) { setUser(null); return; }
    api.get("/auth/me").then((r) => setUser(r.data)).catch(() => { localStorage.removeItem("jwd_token"); setUser(null); });
  }, []);

  const login = async (username, password) => {
    try {
      setError("");
      const r = await api.post("/auth/login", { username, password, device_id: deviceId() });
      localStorage.setItem("jwd_token", r.data.token);
      setUser(r.data.user);
      return true;
    } catch (e) { setError(errText(e)); return false; }
  };

  const logout = () => {
    localStorage.removeItem("jwd_token");
    setUser(null);
    window.location.href = "/mof30";
  };

  const hasPerm = (p) => user?.role === "admin" || (user?.permissions || []).includes(p);

  return <Ctx.Provider value={{ user, login, logout, error, hasPerm }}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);
