import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const COOKIE_NAME = "pkl_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) return [part, ""];
        return [
          decodeURIComponent(part.slice(0, index)),
          decodeURIComponent(part.slice(index + 1)),
        ];
      }),
  );
}

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function encodeToken(payload, secret) {
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${value}.${signature(value, secret)}`;
}

function decodeToken(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [value, provided] = token.split(".");
  const expected = signature(value, secret);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!payload.id || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieOptions(secure) {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function createAuth({ store, secret, secure = false }) {
  function setLoginCookie(res, userId) {
    const token = encodeToken(
      {
        id: userId,
        exp: Date.now() + MAX_AGE_SECONDS * 1000,
        nonce: randomBytes(8).toString("hex"),
      },
      secret,
    );
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions(secure)}`,
    );
  }

  function clearLoginCookie(res) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
    );
  }

  function middleware(req, res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const payload = decodeToken(token, secret);
    const user = payload ? store.userById(payload.id) : null;
    req.user = user?.active ? user : null;
    res.locals.currentUser = req.user;
    next();
  }

  function requireAuth(req, res, next) {
    if (!req.user) {
      return res.redirect(
        `/login?next=${encodeURIComponent(req.originalUrl)}&error=${encodeURIComponent("Silakan masuk terlebih dahulu.")}`,
      );
    }
    next();
  }

  function allowRoles(...roles) {
    return (req, res, next) => {
      if (!req.user) return requireAuth(req, res, next);
      if (!roles.includes(req.user.role)) {
        return res.status(403).render("error", {
          title: "Akses ditolak",
          status: 403,
          detail: "Akun Anda tidak memiliki izin untuk membuka halaman ini.",
        });
      }
      next();
    };
  }

  return {
    middleware,
    requireAuth,
    allowRoles,
    setLoginCookie,
    clearLoginCookie,
  };
}

export function safeNext(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/dashboard";
}
