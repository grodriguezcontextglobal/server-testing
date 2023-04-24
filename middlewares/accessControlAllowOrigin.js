const express = require("express");

const accessControlAllowOrigin = (request, response, next) => {
  response.header("Access-Control-Allow-Origin", "*"); // Allow any origin
  next();
};

module.exports = accessControlAllowOrigin;
