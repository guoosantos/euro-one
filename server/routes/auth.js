import express from "express";
import jwt from "jsonwebtoken";

import { config } from "../config.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

function sanitize(user) {
  if (!user) return null;
  const { traccar, ...rest } = user;
  return rest;
}

router.post("/login", (req, res, next) => {
  try {
    const { email, username, login, password } = req.body || {};
    const userLogin = email || username || login;

    if (!userLogin || !password) {
      return res.status(400).json({
        message: "E-mail e senha são obrigatórios",
        details: "E-mail e senha são obrigatórios",
      });
    }

    if (userLogin !== "admin" || password !== "admin") {
      return res.status(401).json({
        message: "Credenciais inválidas",
        details: "E-mail ou senha incorretos",
      });
    }

    const user = {
      id: 1,
      email: "admin",
      name: "Admin",
      role: "admin",
    };

    const tokenPayload = {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    };

    const token = jwt.sign(tokenPayload, config.jwt.secret, {
      expiresIn: "7d",
    });

    return res.json({
      token,
      user,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/session", authenticate, (req, res) => {
  res.json({
    user: sanitize(req.user),
  });
});

router.post("/logout", authenticate, (req, res) => {
  res.clearCookie("token");
  res.status(204).send();
});

export default router;
