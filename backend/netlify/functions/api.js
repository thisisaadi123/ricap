require("dotenv/config");
const serverless = require("serverless-http");
const { app, ensureSchema } = require("../../app.js");

const wrapped = serverless(app, { basePath: "/.netlify/functions/api" });

exports.handler = async (event, context) => {
  await ensureSchema();
  return wrapped(event, context);
};
