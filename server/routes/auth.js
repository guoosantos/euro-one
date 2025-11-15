import express from "express";
import { authenticate, signSession } from "../middleware/auth.js";
import { getUserById, sanitizeUser, verifyUserCredentials } from "../models/user.js";

const router = express.Router();

router.post("/login", async (req, res, next) => {
  try {
    const { email, username, login, password } = req.body || {};
    const userLogin = email || username || login;
    const user = await verifyUserCredentials(userLogin, password);
    const tokenPayload = {
      id: user.id,
      role: user.role,
      clientId: user.clientId ?? null,
      name: user.name,
      email: user.email,
      username: user.username ?? null,
    };
    const token = signSession(tokenPayload);
    return res.json({
      token,
      user,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/session", authenticate, (req, res, next) => {
  try {
    const stored = getUserById(req.user.id);
    if (!stored) {
      return res.status(404).json({ message: "Usuário não encontrado" });
    }
    return res.json({ user: sanitizeUser(stored) });
  } catch (error) {
    return next(error);
  }
});

router.post("/logout", authenticate, (req, res) => {
  res.clearCookie("token");
  res.status(204).send();
});

export default router;
