const express = require("express");

const accessControlAllowOrigin = (request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Max-Age", "1800");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader(
    "Access-Control-Allow-Methods",
    "PUT, POST, GET, DELETE, PATCH, OPTIONS"
  );
  next();
};

module.exports = accessControlAllowOrigin;
