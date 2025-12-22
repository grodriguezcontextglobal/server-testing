const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const AdminUser = require("../models/AdminUser");
const { generateJWT } = require("../helpers/jwt");
const StripeTransaction = require("../models/StripeTransaction");
const { clientRedis } = require("../database/cacheMemoryConfig");
const { loginActivityNotification } = require("../nodeMailer/notifications");
const logger = require("../helpers/logger");
const crypto = require("crypto");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { logStaffActivity } = require("./staffActivityLog");

const createAdminUser = async (request, response = express.response) => {
  const { email, password } = request.body;

  try {
    let adminUser = await AdminUser.findOne({ email });
    if (adminUser) {
      return response.status(400).json({
        ok: false,
        msg: `${email} is already in our record. Please use a different email address to create a new account.`,
      });
    }
    adminUser = new AdminUser(request.body);

    //encrypt password
    const salt = bcrypt.genSaltSync();
    adminUser.password = bcrypt.hashSync(password, salt);

    await adminUser.save();

    //generate JWT
    const token = await generateJWT(
      adminUser.id,
      adminUser.name,
      adminUser.tokenVersion
    );

    // Store JWT in a cookie
    response.cookie("token", token, {
      httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
      secure: process.env.NODE_ENV === "production", // Ensure cookies are only sent over HTTPS in production
      sameSite: "strict", // Prevent CSRF attacks
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    return response.status(201).json({
      ok: true,
      message: "registered",
      entire: adminUser,
      uid: adminUser.id,
      name: adminUser.name,
      lastName: adminUser.lastName,
      email: adminUser.email,
      phone: adminUser.phone,
      role: adminUser.role,
      company: adminUser.company,
      token,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error.message || error,
    });
  }
};

const loginUser = async (request, response) => {
  const { email, password, rememberMe, forceLogin, mfaCode } = request.body;
  try {
    let adminUser = await AdminUser.findOne({ email });
    if (!adminUser) {
      return response.status(400).json({
        ok: false,
        msg: "User is not found",
      });
    }
    //confirm password
    const validPassword = bcrypt.compareSync(password, adminUser.password);
    if (!validPassword) {
      return response.status(400).json({
        ok: false,
        msg: "You have entered an invalid username or password",
      });
    }

    // MFA Check
    if (adminUser.mfaEnabled) {
      if (!mfaCode) {
        return response.status(403).json({
          ok: false,
          msg: "MFA code required",
          mfaRequired: true,
        });
      }

      const userWithSecret = await AdminUser.findById(adminUser.id).select(
        "+mfaSecret"
      );

      const verified = speakeasy.totp.verify({
        secret: userWithSecret.mfaSecret.base32,
        encoding: "base32",
        token: mfaCode,
      });

      if (!verified) {
        return response.status(400).json({
          ok: false,
          msg: "Invalid MFA code",
        });
      }
    }

    // Enforce single active session using Redis, with reclaim/force-login
    const redis = await clientRedis();
    const sessionKey = `staff_session:${adminUser.id ?? adminUser.uid}`;
    const ownerKey = `${sessionKey}:owner`;
    const ttlSeconds = rememberMe ? 30 * 24 * 60 * 60 : 12 * 60 * 60;

    // Build a simple fingerprint (UA + IP + user ID)
    const userAgent = request.headers["user-agent"] || "Unknown";
    const ipAddress =
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      request.headers["x-real-ip"] ||
      request.headers["x-client-ip"] ||
      request.ip ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      "Unknown";
    const fingerprint = crypto
      .createHash("sha256")
      .update(`${userAgent}|${ipAddress}|${adminUser.id ?? adminUser.uid}`)
      .digest("hex");

    // Try to claim; if it exists, allow reclaim for same owner or forceLogin
    const claimed = await redis.set(sessionKey, "active", {
      EX: ttlSeconds,
      NX: true,
    });

    if (!claimed) {
      const currentOwner = await redis.get(ownerKey);
      const isSameOwner = currentOwner && currentOwner === fingerprint;

      if (isSameOwner || Boolean(forceLogin)) {
        // Reclaim or force takeover: clear the existing session before proceeding
        try {
          await redis.del(sessionKey);
          await redis.del(ownerKey);
        } catch {}
      } else {
        return response.status(409).json({
          ok: false,
          msg:
            "Active session already exists for this account. " +
            "If this is you, please use 'Force Login' to end the previous session.",
        });
      }
    }

    //generate jwt (json web token)
    let token;
    try {
      token = await generateJWT(
        adminUser.id,
        adminUser.name,
        adminUser.tokenVersion,
        rememberMe
      );
    } catch (e) {
      // Rollback the claim if token generation fails
      try {
        await redis.del(sessionKey);
        await redis.del(ownerKey);
      } catch {}
      throw e;
    }

    // Store token and owner fingerprint with TTL
    try {
      await redis.set(sessionKey, token, { EX: ttlSeconds });
      await redis.set(ownerKey, fingerprint, { EX: ttlSeconds });
    } catch {}

    // Prepare login information for email notification with better header extraction
    const loginInfo = {
      timestamp: new Date().toLocaleString("en-US", {
        timeZone:
          request.headers["x-timezone"] || request.headers["timezone"] || "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }),
      ipAddress:
        request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        request.headers["x-real-ip"] ||
        request.headers["x-client-ip"] ||
        request.ip ||
        request.connection?.remoteAddress ||
        request.socket?.remoteAddress ||
        "Unknown",
      userAgent: request.headers["user-agent"] || "Unknown Browser",
      browser: request.headers["user-agent"]
        ? request.headers["user-agent"].split(" ")[0]
        : "Unknown",
      location:
        request.headers["x-location"] ||
        request.headers["cf-ipcountry"] ||
        request.headers["accept-language"]?.split(",")[0] ||
        "Unknown",
      timezone:
        request.headers["x-timezone"] || request.headers["timezone"] || "UTC",
      requestId:
        request.headers["x-request-id"] ||
        request.headers["x-request-timestamp"] ||
        Date.now().toString(),
    };

    // Send login activity notification (async)
    try {
      setImmediate(async () => {
        try {
          const result = await loginActivityNotification(adminUser, loginInfo);
          if (result.success) {
            logger.info("Login activity email sent successfully", {
              userId: adminUser.id,
              email: adminUser.email,
              requestId: loginInfo.requestId,
            });
          } else {
            logger.error("Failed to send login activity email", {
              userId: adminUser.id,
              email: adminUser.email,
              error: result.error,
              requestId: loginInfo.requestId,
            });
          }
        } catch (emailError) {
          logger.error("Error sending login activity email", {
            userId: adminUser.id,
            email: adminUser.email,
            error: emailError,
            requestId: loginInfo.requestId,
          });
        }
      });
    } catch (emailError) {
      logger.error("Error preparing login activity email", {
        userId: adminUser.id,
        email: adminUser.email,
        error: emailError,
        requestId: loginInfo.requestId,
      });
    }

    // Log successful login
    logger.info("Admin user login successful", {
      userId: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      company: adminUser.company,
      loginInfo,
      requestId: loginInfo.requestId,
    });

    await logStaffActivity({
      staff_member_id: adminUser.id,
      company_id: adminUser.company,
      action: "LOGIN",
      target_model: "AdminUser",
      target_id: adminUser.id,
      details: { email: adminUser.email },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.status(200).json({
      ok: true,
      entire: adminUser,
      uid: adminUser.id,
      name: adminUser.name,
      lastName: adminUser.lastName,
      email: adminUser.email,
      phone: adminUser.phone,
      role: adminUser.role,
      company: adminUser.company,
      token,
    });
  } catch (error) {
    logger.error("Admin login error", {
      email,
      error: error,
      stack: error.stack,
      requestId: request.headers["x-request-id"],
    });

    return response.status(500).json({
      ok: false,
      msg: "Please contact Administrator",
      err: error.message || error,
    });
  }
};

const logoutUser = async (request, response) => {
  try {
    const redis = await clientRedis();
    // Safely read token from cookies or fall back to header
    const token = request.cookies?.token || request.headers["x-token"];
    const staffID = request.body.uid;
    let decoded = {};
    if (token) {
      decoded = jwt.decode(token);
      const sessionKey = `staff_session:${decoded.id ?? decoded.uid}`;
      redis.del(sessionKey);
      // Clear cookie if it existed (name is required)
      response.clearCookie("token", {
        httpOnly: true,
        sameSite: "none",
        secure: true,
      });

      return response.status(201).json({
        ok: true,
        msg: "user logged out",
      });
    }
    if (staffID) {
      const sessionKey = `staff_session:${staffID}`;
      redis.del(sessionKey);
      // Clear cookie if it existed (name is required)
      response.clearCookie("token", {
        httpOnly: true,
        sameSite: "none",
        secure: true,
      });

      return response.status(201).json({
        ok: true,
        msg: "user logged out",
      });
    }
    response.status(401).json({
      ok: false,
      msg: "No token/Staff Member UID provided",
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
    });
  }
};

const manuallyLogoutUser = async (request, response) => {
  try {
    const redis = await clientRedis();
    logger.info("request", request.body);
    // Safely read token from cookies or fall back to header
    const sessionKey = `staff_session:${request.body.uid}`;
    redis.del(sessionKey);

    // Clear cookie if it existed (name is required)
    response.clearCookie("token", {
      httpOnly: true,
      sameSite: "none",
      secure: true,
    });

    return response.status(201).json({
      ok: true,
      msg: "user logged out",
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
    });
  }
};

const editAdminUser = async (request, response = response) => {
  const adminUserId = request.params.id;
  try {
    const adminUser = await AdminUser.findById(adminUserId);
    if (!adminUser) {
      return response.status(404).json({
        ok: false,
        msg: "Admin user/id do not match",
      });
    }
    const adminUserEdited = {
      ...request.body,
    };
    //generate JWT
    // const token = await generateJWT(adminUserId, adminUser.name);
    const adminUserUpdated = await AdminUser.findByIdAndUpdate(
      adminUserId,
      adminUserEdited,
      {
        new: true,
      }
    );

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: adminUserUpdated.company,
      action: "UPDATE",
      target_model: "AdminUser",
      target_id: adminUserUpdated.id,
      details: { updates: request.body, self_update: true },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.json({
      msg: "admin user updated",
      ok: true,
      entire: adminUserUpdated,
      uid: adminUserUpdated.id,
      name: adminUserUpdated.name,
      lastName: adminUserUpdated.lastName,
      email: adminUserUpdated.email,
      phone: adminUserUpdated.phone,
      company: adminUserUpdated.company,
      role: adminUserUpdated.role,
      // token,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
      err: error,
    });
  }
};

const editOtherAdminUser = async (request, response = response) => {
  const adminUserId = request.params.id;

  try {
    const adminUserEdited = {
      ...request.body,
    };
    const adminUserUpdated = await AdminUser.findByIdAndUpdate(
      adminUserId,
      adminUserEdited,
      {
        new: true,
      }
    );

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: adminUserUpdated.company,
      action: "UPDATE",
      target_model: "AdminUser",
      target_id: adminUserUpdated.id,
      details: { updates: request.body, self_update: false },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.json({
      msg: "admin user updated",
      ok: true,
      adminUpdated: adminUserUpdated,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: "Contact Administrator",
      err: error,
    });
  }
};

const deleteAdminUser = async (request, response) => {
  try {
    const adminUserId = await request.params.id;
    const adminUser = await AdminUser.findByIdAndDelete(adminUserId);
    if (!adminUser) {
      return response.status(404).json({
        ok: false,
        msg: "Admin user/id do not match",
      });
    }

    await logStaffActivity({
      staff_member_id: request.uid,
      company_id: adminUser.company,
      action: "DELETE",
      target_model: "AdminUser",
      target_id: adminUser.id,
      details: { email: adminUser.email },
      ip_address: request.ip,
      device_info: request.headers["user-agent"],
    });

    return response.status(201).json({
      ok: true,
      adminUser,
      msg: "admin user deleted",
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const renewToken = async (request, response = express.response) => {
  const { uid, name } = request;

  //genrate a new jwt and return it in this request
  const token = await generateJWT(uid, name);

  return response.json({
    ok: true,
    name,
    uid,
    token,
  });
};

const updatePassword = async (request, response) => {
  const { email, password } = request.body;

  try {
    let adminUser = await AdminUser.findOne({ email });

    if (!adminUser) {
      return response.status(400).json({
        ok: false,
        msg: "Email/User was not found",
      });
    }

    const id = adminUser.id;
    ///encrypt password
    const salt = bcrypt.genSaltSync();
    adminUser.password = bcrypt.hashSync(password, salt);

    //generate JWT
    // const token = await generateJWT(id, adminUser.name);

    //update password in adminUser object
    const updateAdminUserPassword = await AdminUser.findByIdAndUpdate(
      id,
      adminUser,
      {
        new: true,
      }
    );
    return response.status(201).json({
      ok: true,
      message: "register",
      uid: updateAdminUserPassword.id,
      name: updateAdminUserPassword.name,
      email: updateAdminUserPassword.email,
      phone: updateAdminUserPassword.phone,
      role: updateAdminUserPassword.role,
      company: updateAdminUserPassword.company,
      // token,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const showAllUsers = async (request, response) => {
  const stripeTransactions = await StripeTransaction.find(
    request.body
  ).populate("user");

  try {
    return response.status(201).json({
      ok: true,
      stripeTransactions,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const showStaffs = async (request, response) => {
  const staff = await AdminUser.find(request.body);

  try {
    return response.status(201).json({
      ok: true,
      staff,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
    });
  }
};

const displayAllAdminUser = async (request, response) => {
  try {
    const adminUsers = await AdminUser.find(request.body);

    return response.status(201).json({
      ok: true,
      adminUsers,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const articleSetup = async (request, response) => {
  const { img, title, body } = request.body;
  const newArticle = new Article({
    img,
    title,
    body,
  });

  try {
    newArticle.adminUser = request.uid;
    await newArticle.save();

    return response.status(201).json({
      ok: true,
      message: "article created",
      newArticle,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error,
      err: error,
    });
  }
};

const displayArticles = async (request, response) => {
  try {
    const articles = await Article.find();
    return response.status(201).json({
      ok: true,
      articles,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.response.data,
      err: error,
    });
  }
};

const checkStatus = async (request, response) => {
  try {
    const cache_connection = await clientRedis();
    const email = request.params.email;
    const cachedStatus = await cache_connection.get(`admin_status=${email}`);
    if (cachedStatus) {
      cache_connection.del(`admin_status=${email}`);
      return response.status(201).json({
        ok: true,
        cached: true,
        online: JSON.parse(cachedStatus),
      });
    }
    const checkOnlineStatus = await AdminUser.findOne({ email: email });
    cache_connection.set(
      `admin_status=${email}`,
      JSON.stringify(checkOnlineStatus.online)
    );
    cache_connection.expire(`admin_status=${email}`, 180);
    return response.status(201).json({
      ok: true,
      cached: false,
      online: checkOnlineStatus.online,
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      msg: error.message,
      err: error,
    });
  }
};

const generateMfaSecret = async (req, res) => {
  try {
    const adminUser = await AdminUser.findById(req.uid);
    if (!adminUser)
      return res.status(404).json({ ok: false, msg: "User not found" });

    const secret = speakeasy.generateSecret({
      name: `Devitrak:${adminUser.email}`,
    });

    adminUser.mfaSecret = secret;
    await adminUser.save();

    QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) throw err;
      res.json({
        ok: true,
        secret: secret.base32,
        qrCode: data_url,
      });
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ ok: false, msg: "Error generating MFA secret" });
  }
};

const verifyMfaSetup = async (req, res) => {
  const { token } = req.body;
  try {
    const adminUser = await AdminUser.findById(req.uid).select("+mfaSecret");
    if (!adminUser)
      return res.status(404).json({ ok: false, msg: "User not found" });

    const verified = speakeasy.totp.verify({
      secret: adminUser.mfaSecret.base32,
      encoding: "base32",
      token: token,
    });

    if (verified) {
      adminUser.mfaEnabled = true;
      await adminUser.save();
      res.json({ ok: true, msg: "MFA enabled successfully" });
    } else {
      res.status(400).json({ ok: false, msg: "Invalid token" });
    }
  } catch (error) {
    logger.error(error);
    res.status(500).json({ ok: false, msg: "Error verifying MFA" });
  }
};

const disableMfa = async (req, res) => {
  try {
    const adminUser = await AdminUser.findById(req.uid);
    adminUser.mfaEnabled = false;
    adminUser.mfaSecret = undefined;
    await adminUser.save();
    res.json({ ok: true, msg: "MFA disabled successfully" });
  } catch (error) {
    res.status(500).json({ ok: false, msg: "Error disabling MFA" });
  }
};

module.exports = {
  renewToken,
  loginUser,
  createAdminUser,
  editAdminUser,
  editOtherAdminUser,
  deleteAdminUser,
  updatePassword,
  showAllUsers,
  showStaffs,
  displayAllAdminUser,
  articleSetup,
  displayArticles,
  checkStatus,
  logoutUser,
  manuallyLogoutUser,
  generateMfaSecret,
  verifyMfaSetup,
  disableMfa,
};
